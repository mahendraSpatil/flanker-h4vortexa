// Owner: Archit | Test fixtures: the fixed 5-record batch from vectors.json, built with @proofchain/core
import { readFileSync } from 'node:fs';
import { buildProof, buildTree, getProof, leafHash } from '../src/index.js';

export const VECTORS = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

const { anchor, issuedAt } = VECTORS.proof;
export const ANCHOR = anchor;
export const ISSUED_AT = issuedAt;
export const PINNED = Object.freeze({ chainId: anchor.chainId, contract: anchor.contract });

export const utf8 = (text) => new TextEncoder().encode(text);
export const toText = (bytes) => new TextDecoder().decode(bytes);

/** Only the five fields that go into a leaf. */
export const recordOf = ({ recordId, fileHash, docType, issuer, date }) => ({
  recordId,
  fileHash,
  docType,
  issuer,
  date,
});

/**
 * Fresh copy of the batch on every call, so tests can tamper with it freely.
 * Index 2 is the salary slip (Rs 50,000); index 4 is a .txt registered under text-v1.
 */
export function makeBatch() {
  const records = VECTORS.records.map(recordOf);
  const files = VECTORS.records.map((entry) => utf8(entry.file));
  const { root, levels } = buildTree(records.map(leafHash));
  const proofs = records.map((record, leafIndex) =>
    buildProof({
      record,
      batchId: VECTORS.batchId,
      leafIndex,
      leafCount: records.length,
      siblings: getProof(levels, leafIndex),
      root,
      anchor: ANCHOR,
      fileNormalization: VECTORS.records[leafIndex].fileNormalization,
      issuedAt: ISSUED_AT,
    }),
  );
  return { records, files, root, levels, proofs, chainBatch: { root, leafCount: records.length } };
}
