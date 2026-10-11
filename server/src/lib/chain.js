// Owner: Archit | Provider, publisher wallet and RootRegistry contract, pinned by shared/deployment.json
import {
  Contract,
  JsonRpcProvider,
  Network,
  Wallet,
  ZeroHash,
  decodeBytes32String,
  encodeBytes32String,
} from 'ethers';
import deployment from '../../../shared/deployment.json' with { type: 'json' };
import { config } from '../config.js';
import { AppError } from './errors.js';

const REACHABILITY_TIMEOUT_MS = 2000;
const READ_TIMEOUT_MS = 10_000;
// Hardhat mines on send, so a publish normally takes milliseconds; this only bounds a hung node
const PUBLISH_TIMEOUT_MS = 30_000;
const RESET_HINT =
  'Run `npm run reset` (then `npm run seed`) to start the chain and database over.';

// Node fetch errors (connection refused, DNS, reset) and ethers' own transport failures
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'NETWORK_ERROR',
  'SERVER_ERROR',
  'TIMEOUT',
]);

const network = Network.from(deployment.chainId);

// staticNetwork: skip ethers' network auto-detection, which retries forever (and logs every second)
// while the node is down. Calls then fail fast instead.
// cacheTimeout -1: ethers otherwise shares identical calls for 250 ms, so a second seal right after
// the first reuses a stale nonce (NONCE_EXPIRED) and a read right after a publish can be stale.
export const provider = new JsonRpcProvider(config.rpcUrl, network, {
  staticNetwork: network,
  cacheTimeout: -1,
});
export const publisher = new Wallet(config.publisherPrivateKey, provider);
export const registry = new Contract(deployment.address, deployment.abi, publisher);
export { deployment };

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'TIMEOUT' })),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probeChain() {
  const [chainIdHex, code] = await Promise.all([
    provider.send('eth_chainId', []),
    provider.getCode(deployment.address),
  ]);
  return Number(chainIdHex) === deployment.chainId && code !== '0x';
}

/**
 * True when the node answers on the pinned chainId AND the pinned contract has code.
 * A restarted Hardhat node answers but has lost the contract, so reachability alone is not enough.
 * @returns {Promise<boolean>} never rejects
 */
export async function isChainReachable() {
  try {
    return await withTimeout(probeChain(), REACHABILITY_TIMEOUT_MS);
  } catch {
    return false;
  }
}

/**
 * Publish a batch root on RootRegistry and wait for 1 confirmation.
 * @param {string} batchId e.g. "BATCH-0001"
 * @param {string} rootHex "0x" + 64 hex
 * @param {number} leafCount >= 1
 * @returns {Promise<{ txHash: string, blockNumber: number }>}
 * @throws {AppError} CHAIN_UNREACHABLE (503), BATCH_ALREADY_PUBLISHED (409), CHAIN_REVERTED (502)
 */
export async function publishRoot(batchId, rootHex, leafCount) {
  return callChain(`publishRoot(${batchId})`, PUBLISH_TIMEOUT_MS, async () => {
    await requireRegistry();
    const tx = await registry.publishRoot(encodeBytes32String(batchId), rootHex, leafCount);
    const receipt = await tx.wait(1);
    return { txHash: receipt.hash.toLowerCase(), blockNumber: receipt.blockNumber };
  });
}

/**
 * Read one batch from RootRegistry.
 * @param {string} batchId e.g. "BATCH-0001"
 * @returns {Promise<{ root: string, leafCount: number, publishedAt: string } | null>} root lowercased,
 *   publishedAt = block timestamp as ISO 8601; null when the contract has no root for batchId
 * @throws {AppError} CHAIN_UNREACHABLE (503)
 */
export async function readBatch(batchId) {
  const [root, leafCount, publishedAt] = await callChain(
    `getBatch(${batchId})`,
    READ_TIMEOUT_MS,
    async () => {
      await requireRegistry();
      return registry.getBatch(encodeBytes32String(batchId));
    },
  );
  if (root === ZeroHash) return null;
  return {
    root: root.toLowerCase(),
    leafCount: Number(leafCount),
    publishedAt: new Date(Number(publishedAt) * 1000).toISOString(),
  };
}

/**
 * Every batchId that has a root on chain, from RootPublished events, oldest first.
 * @returns {Promise<string[]>} a batchId that is not a valid bytes32 string is returned as its hex
 * @throws {AppError} CHAIN_UNREACHABLE (503)
 */
export async function listPublishedBatchIds() {
  const events = await callChain('RootPublished events', READ_TIMEOUT_MS, async () => {
    await requireRegistry();
    return registry.queryFilter(registry.filters.RootPublished(), 0, 'latest');
  });
  return events.map((event) => decodeBatchId(event.args.batchId));
}

// A restarted node answers but has no contract: a publish would then "succeed" as a plain
// transfer to an empty address and reads would return garbage, so check for code first.
async function requireRegistry() {
  const code = await provider.getCode(deployment.address);
  if (code === '0x') {
    throw new AppError(
      'CHAIN_UNREACHABLE',
      503,
      `No RootRegistry at ${deployment.address} on ${config.rpcUrl} (was the node restarted?). ${RESET_HINT}`,
    );
  }
}

async function callChain(action, timeoutMs, fn) {
  try {
    return await withTimeout(fn(), timeoutMs);
  } catch (err) {
    throw toChainError(err, action);
  }
}

function toChainError(err, action) {
  if (err instanceof AppError) return err;
  const reason = revertReason(err);
  if (reason === 'Batch already published') {
    return new AppError(
      'BATCH_ALREADY_PUBLISHED',
      409,
      `${action} refused: the chain already has a root for this batch but the database does not, ` +
        `so the database and chain are out of sync. ${RESET_HINT}`,
      { reason },
    );
  }
  if (reason !== null) {
    return new AppError('CHAIN_REVERTED', 502, `RootRegistry reverted ${action}: ${reason}`, {
      reason,
    });
  }
  if (isUnreachable(err)) {
    return new AppError(
      'CHAIN_UNREACHABLE',
      503,
      `Cannot reach the chain at ${config.rpcUrl} (${action}: ${err.code}). ` +
        'Start it with `npm run chain`, then `npm run reset`.',
    );
  }
  return err;
}

// Reason string of a contract revert, or null when the error is not a revert
function revertReason(err) {
  if (err?.code !== 'CALL_EXCEPTION') return null;
  return err.reason ?? err.revert?.args?.[0] ?? err.shortMessage ?? 'execution reverted';
}

function isUnreachable(err) {
  return UNREACHABLE_CODES.has(err?.code) || UNREACHABLE_CODES.has(err?.cause?.code);
}

function decodeBatchId(bytes32) {
  try {
    return decodeBytes32String(bytes32);
  } catch {
    return bytes32;
  }
}
