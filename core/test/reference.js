// Owner: Archit | Independent reference implementation for tests only (node:crypto; RFC 6962-style recursion)
import { createHash } from 'node:crypto';

/** SHA-256 over the concatenation of byte parts, as "0x" + lowercase hex. */
export function sha256(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return '0x' + hash.digest('hex');
}

const raw = (hex) => Buffer.from(hex.slice(2), 'hex');

/** Canonical record written out by hand (test issuers are plain ASCII, so no JSON escaping). */
export function refCanonical({ recordId, fileHash, docType, issuer, date }) {
  return (
    `{"date":"${date}","docType":"${docType}","fileHash":"${fileHash}",` +
    `"issuer":"${issuer}","recordId":"${recordId}","v":1}`
  );
}

export const refLeaf = (record) => sha256(Buffer.from([0x00]), Buffer.from(refCanonical(record)));

export const refNode = (left, right) => sha256(Buffer.from([0x01]), raw(left), raw(right));

// Largest power of two strictly below n (n >= 2): where the left subtree ends
function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/**
 * Root by recursive split (left = largest power of two below n). A different algorithm from
 * buildTree's bottom-up pairing, but it must produce the same tree as "promote the odd node".
 */
export function refRoot(leaves) {
  if (leaves.length === 1) return leaves[0];
  const k = splitPoint(leaves.length);
  return refNode(refRoot(leaves.slice(0, k)), refRoot(leaves.slice(k)));
}

/** Sibling path for leaves[index], bottom to top, with each sibling's side. */
export function refPath(leaves, index) {
  if (leaves.length === 1) return [];
  const k = splitPoint(leaves.length);
  return index < k
    ? [...refPath(leaves.slice(0, k), index), { hash: refRoot(leaves.slice(k)), pos: 'right' }]
    : [...refPath(leaves.slice(k), index - k), { hash: refRoot(leaves.slice(0, k)), pos: 'left' }];
}
