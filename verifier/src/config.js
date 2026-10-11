// Owner: Archit (frozen; ask before changing) | Pinned chain + contract the verifier trusts; never taken from proof.json
import deployment from '../../shared/deployment.json';

export const PINNED = Object.freeze({
  chainId: deployment.chainId,
  contract: deployment.address,
  abi: deployment.abi,
  rpcUrl: 'http://127.0.0.1:8545',
});
