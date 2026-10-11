// Owner: Archit (frozen; ask before changing) | Pinned chain + contract the verifier trusts; never taken from proof.json
import deployment from '../../shared/deployment.json';

// Only the RPC endpoint may come from the build env (VITE_RPC_URL, e.g. "/rpc" behind nginx).
// A relative value resolves against the page's origin. chainId and contract stay pinned below.
const DEFAULT_RPC_URL = 'http://127.0.0.1:8545';

function resolveRpcUrl() {
  const fromEnv = import.meta.env.VITE_RPC_URL;
  if (!fromEnv) return DEFAULT_RPC_URL;
  return new URL(fromEnv, window.location.origin).href;
}

export const PINNED = Object.freeze({
  chainId: deployment.chainId,
  contract: deployment.address,
  abi: deployment.abi,
  rpcUrl: resolveRpcUrl(),
});
