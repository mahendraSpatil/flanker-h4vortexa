// Owner: Archit | Merkle tree over record leaves: build, prove, fold (odd node promoted, never duplicated)

/**
 * @typedef {{ hash: string, pos: 'left' | 'right' }} Sibling
 * `pos` is the SIBLING's side, which fixes the concatenation order when folding.
 */

/**
 * Build the tree bottom-up. Leaves must already be ordered by recordId ascending.
 * An unpaired node at any level is promoted unchanged to the next level.
 * @param {string[]} leafHexes leaf hashes ("0x" + 64 hex), at least one
 * @returns {{ root: string, levels: string[][] }} levels[0] = leaves, levels[last] = [root]
 */
export function buildTree(leafHexes) {
  throw new Error('NOT_IMPLEMENTED: buildTree');
}

/**
 * Sibling path from a leaf up to the root. Levels where the node was promoted contribute no sibling.
 * @param {string[][]} levels as returned by buildTree
 * @param {number} leafIndex position of the leaf in levels[0]
 * @returns {Sibling[]} bottom to top
 */
export function getProof(levels, leafIndex) {
  throw new Error('NOT_IMPLEMENTED: getProof');
}

/**
 * Fold a leaf with its siblings: h = nodeHash(sibling, h) when pos is "left", nodeHash(h, sibling) when "right".
 * @param {string} leafHex
 * @param {Sibling[]} siblings bottom to top
 * @returns {string} computed root
 */
export function foldProof(leafHex, siblings) {
  throw new Error('NOT_IMPLEMENTED: foldProof');
}

/**
 * Number of siblings a valid proof must have for this position, accounting for promoted odd nodes.
 * Used by check 0 to reject padded or truncated paths.
 * @param {number} leafIndex 0-based, < leafCount
 * @param {number} leafCount >= 1
 * @returns {number}
 */
export function expectedPathLength(leafIndex, leafCount) {
  throw new Error('NOT_IMPLEMENTED: expectedPathLength');
}
