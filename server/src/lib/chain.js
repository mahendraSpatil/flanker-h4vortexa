// Owner: Archit | Provider, publisher wallet and RootRegistry contract, pinned by shared/deployment.json
import { Contract, JsonRpcProvider, Network, Wallet } from 'ethers';
import deployment from '../../../shared/deployment.json' with { type: 'json' };
import { config } from '../config.js';

const REACHABILITY_TIMEOUT_MS = 2000;

const network = Network.from(deployment.chainId);

// staticNetwork: skip ethers' network auto-detection, which retries forever (and logs every second)
// while the node is down. Calls then fail fast instead.
export const provider = new JsonRpcProvider(config.rpcUrl, network, { staticNetwork: network });
export const publisher = new Wallet(config.publisherPrivateKey, provider);
export const registry = new Contract(deployment.address, deployment.abi, publisher);
export { deployment };

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
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
