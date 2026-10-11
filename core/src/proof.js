// Owner: Archit | Assemble proof.json for one anchored record (shape locked in CLAUDE.md "proof.json")

/**
 * Build the proof.json object for one record.
 *
 * Output fields, in order: v, scheme { hash, leafPrefix, nodePrefix, canonicalization, oddNode,
 * fileNormalization }, recordId, metadata { docType, issuer, date }, fileHash, leaf, batchId,
 * leafIndex, leafCount, siblings, root, anchor, issuedAt (ISO 8601 UTC).
 *
 * @param {object} args
 * @param {{ recordId: string, fileHash: string, docType: string, issuer: string, date: string }} args.record confirmed record
 * @param {string} args.batchId e.g. "BATCH-0007"
 * @param {number} args.leafIndex
 * @param {number} args.leafCount
 * @param {import('./merkle.js').Sibling[]} args.siblings from getProof
 * @param {string} args.root batch root
 * @param {{ chainId: number, contract: string, txHash: string, blockNumber: number }} args.anchor display only
 * @param {'none' | 'text-v1'} args.fileNormalization how fileHash was computed
 * @returns {object} proof.json object
 */
export function buildProof({
  record,
  batchId,
  leafIndex,
  leafCount,
  siblings,
  root,
  anchor,
  fileNormalization,
}) {
  throw new Error('NOT_IMPLEMENTED: buildProof');
}
