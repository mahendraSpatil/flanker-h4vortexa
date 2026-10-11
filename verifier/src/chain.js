// Owner: Archit | Read-only access to the pinned RootRegistry (the verifier's only external input)
import { Contract, JsonRpcProvider, Network, ZeroHash, encodeBytes32String } from 'ethers';
import { PINNED } from './config.js';

const network = Network.from(PINNED.chainId);
// staticNetwork: no auto-detection retry loop while the node is down; calls just fail.
const provider = new JsonRpcProvider(PINNED.rpcUrl, network, { staticNetwork: network });
const registry = new Contract(PINNED.contract, PINNED.abi, provider);

/**
 * Read a batch root straight from the pinned contract.
 * @param {string} batchId e.g. "BATCH-0007"
 * @returns {Promise<{ root: string, leafCount: number, publishedAt: number } | null>} null when unpublished
 * @throws when the chain is unreachable or batchId is longer than 31 bytes
 */
export async function getBatch(batchId) {
  const [root, leafCount, publishedAt] = await registry.getBatch(encodeBytes32String(batchId));
  if (root === ZeroHash) return null;
  return { root, leafCount: Number(leafCount), publishedAt: Number(publishedAt) };
}

/** Latest block number; rejects when the chain is unreachable. */
export function getBlockNumber() {
  return provider.getBlockNumber();
}
