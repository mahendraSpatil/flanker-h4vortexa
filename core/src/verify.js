// Owner: Archit | Independent verification: checks 0-4 over file + proof + on-chain batch

/**
 * @typedef {object} Check
 * @property {string} id '0' | '0b' | '1' | '2' | '3' | '4a' | '4b'
 * @property {string} name human-readable check name, e.g. "File hash"
 * @property {boolean} pass
 * @property {string} [computed] value the verifier computed
 * @property {string} [expected] value it was compared against
 */

/**
 * Run every check and report the first failure as the verdict. Never talks to the chain:
 * the caller reads getBatch(batchId) from the pinned contract and passes the result in.
 *
 * Checks: 0 FORMAT_INVALID, 0b REGISTRY_MISMATCH, 1 DOCUMENT_MODIFIED, 2 METADATA_MODIFIED,
 * 3 PROOF_INVALID, 4a BATCH_NOT_PUBLISHED, 4b ROOT_MISMATCH; all pass -> VALID.
 *
 * @param {object} args
 * @param {Uint8Array} args.fileBytes raw bytes of the uploaded document
 * @param {object} args.proof parsed proof.json (every field untrusted)
 * @param {{ root: string, leafCount: number } | null} args.chainBatch on-chain batch, null if unpublished
 * @param {{ chainId: number, contract: string }} args.pinned verifier's own pinned registry
 * @returns {{ verdict: string, checks: Check[] }} verdict is a RESULT value
 */
export function verify({ fileBytes, proof, chainBatch, pinned }) {
  throw new Error('NOT_IMPLEMENTED: verify');
}
