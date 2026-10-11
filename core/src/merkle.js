// Owner: Archit | Merkle tree over record leaves: build, prove, fold (odd node promoted, never duplicated)
import { nodeHash } from './hash.js';

const HASH_HEX_ANY_CASE = /^0x[0-9a-fA-F]{64}$/;

/**
 * @typedef {{ hash: string, pos: 'left' | 'right' }} Sibling
 * `pos` is the SIBLING's side, which fixes the concatenation order when folding.
 */

/**
 * Build the tree bottom-up. Leaves must already be ordered by recordId ascending.
 * An unpaired node at any level is promoted unchanged to the next level.
 * @param {string[]} leafHexes leaf hashes ("0x" + 64 hex), at least one
 * @returns {{ root: string, levels: string[][] }} levels[0] = leaves (lowercased), levels[last] = [root]
 * @throws {TypeError} on an empty array or a leaf that is not a 32-byte hex hash
 */
export function buildTree(leafHexes) {
  if (!Array.isArray(leafHexes) || leafHexes.length === 0) {
    throw new TypeError('buildTree: expected a non-empty array of leaf hashes');
  }
  const leaves = leafHexes.map((leaf, i) => {
    if (!isHashHex(leaf)) throw new TypeError(`buildTree: leaf ${i} is not 0x + 64 hex characters`);
    return leaf.toLowerCase();
  });
  const levels = [leaves];
  while (levels[levels.length - 1].length > 1) levels.push(parentLevel(levels[levels.length - 1]));
  return { root: levels[levels.length - 1][0], levels };
}

/**
 * Sibling path from a leaf up to the root. Levels where the node was promoted contribute no sibling.
 * @param {string[][]} levels as returned by buildTree
 * @param {number} leafIndex position of the leaf in levels[0]
 * @returns {Sibling[]} bottom to top
 * @throws {TypeError} when levels is not a tree shape; {RangeError} when leafIndex is out of range
 */
export function getProof(levels, leafIndex) {
  assertTreeShape(levels);
  assertIndex(leafIndex, levels[0].length);
  const siblings = [];
  let index = leafIndex;
  for (const level of levels.slice(0, -1)) {
    const isLeftChild = index % 2 === 0;
    const siblingIndex = isLeftChild ? index + 1 : index - 1;
    if (siblingIndex < level.length) {
      const hash = level[siblingIndex];
      if (!isHashHex(hash))
        throw new TypeError('getProof: tree contains a value that is not a hash');
      siblings.push({ hash: hash.toLowerCase(), pos: isLeftChild ? 'right' : 'left' });
    }
    index = Math.floor(index / 2);
  }
  return siblings;
}

/**
 * Fold a leaf with its siblings: h = nodeHash(sibling, h) when pos is "left", nodeHash(h, sibling) when "right".
 * @param {string} leafHex
 * @param {Sibling[]} siblings bottom to top
 * @returns {string} computed root
 * @throws {TypeError} on a malformed leaf or sibling
 */
export function foldProof(leafHex, siblings) {
  if (!isHashHex(leafHex)) throw new TypeError('foldProof: leaf must be 0x + 64 hex characters');
  if (!Array.isArray(siblings)) throw new TypeError('foldProof: siblings must be an array');
  return siblings.reduce((hash, sibling, i) => {
    if (sibling?.pos === 'left') return nodeHash(sibling.hash, hash);
    if (sibling?.pos === 'right') return nodeHash(hash, sibling.hash);
    throw new TypeError(`foldProof: siblings[${i}].pos must be "left" or "right"`);
  }, leafHex.toLowerCase());
}

/**
 * Sibling sides a valid proof must have for this position, derived from index and count alone
 * (a promoted odd node has no sibling at that level). Check 3 compares a proof's `pos` values to this.
 * @param {number} leafIndex 0-based, < leafCount
 * @param {number} leafCount >= 1
 * @returns {Array<'left' | 'right'>} bottom to top
 * @throws {RangeError} when leafIndex or leafCount is out of range
 */
export function expectedPositions(leafIndex, leafCount) {
  if (!Number.isSafeInteger(leafCount) || leafCount < 1) {
    throw new RangeError('leafCount must be an integer >= 1');
  }
  assertIndex(leafIndex, leafCount);
  const positions = [];
  let index = leafIndex;
  for (let width = leafCount; width > 1; width = Math.ceil(width / 2)) {
    if (index % 2 === 1) positions.push('left');
    else if (index + 1 < width) positions.push('right');
    // else: last node of an odd-width level, promoted with no sibling
    index = Math.floor(index / 2);
  }
  return positions;
}

/**
 * Number of siblings a valid proof must have for this position, accounting for promoted odd nodes.
 * Used by check 0 to reject padded or truncated paths.
 * @param {number} leafIndex 0-based, < leafCount
 * @param {number} leafCount >= 1
 * @returns {number}
 * @throws {RangeError} when leafIndex or leafCount is out of range
 */
export function expectedPathLength(leafIndex, leafCount) {
  return expectedPositions(leafIndex, leafCount).length;
}

function parentLevel(level) {
  const parents = [];
  for (let i = 0; i < level.length; i += 2) {
    parents.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
  }
  return parents;
}

// Each level must be half the one below (rounded up), and only the last may be a single node
function assertTreeShape(levels) {
  const ok =
    Array.isArray(levels) &&
    levels.length > 0 &&
    levels.every(Array.isArray) &&
    levels[levels.length - 1].length === 1 &&
    levels.slice(0, -1).every((level) => level.length > 1) &&
    levels.every((level, k) => k === 0 || level.length === Math.ceil(levels[k - 1].length / 2));
  if (!ok) throw new TypeError('getProof: levels must be the tree levels returned by buildTree');
}

function assertIndex(leafIndex, leafCount) {
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= leafCount) {
    throw new RangeError(`leafIndex must be an integer from 0 to ${leafCount - 1}`);
  }
}

function isHashHex(value) {
  return typeof value === 'string' && HASH_HEX_ANY_CASE.test(value);
}
