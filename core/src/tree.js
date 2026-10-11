// Owner: Archit | Internal: bottom-up tree and path folding for any node hash (batch tree 0x01, field tree 0x03)
// Not re-exported from index.js; merkle.js and fields.js wrap it with their own node hash.

/**
 * Every level from the leaves up to the single root. An unpaired node is promoted unchanged.
 * @param {string[]} leaves lowercase 0x hashes, at least one
 * @param {(left: string, right: string) => string} combine node hash
 * @returns {string[][]} levels[0] = leaves, levels[last] = [root]
 */
export function buildLevels(leaves, combine) {
  const levels = [leaves];
  while (levels[levels.length - 1].length > 1) {
    levels.push(parentLevel(levels[levels.length - 1], combine));
  }
  return levels;
}

/**
 * Fold a leaf up its path: combine(sibling, h) when the sibling is on the left, else combine(h, sibling).
 * @param {string} leaf lowercase 0x hash
 * @param {Array<{ hash: string, pos: 'left' | 'right' }>} siblings bottom to top
 * @param {(left: string, right: string) => string} combine node hash
 * @param {string} caller name used in error messages
 * @returns {string} the root this path reaches
 * @throws {TypeError} on a sibling whose pos is not "left" or "right"
 */
export function foldPath(leaf, siblings, combine, caller) {
  return siblings.reduce((hash, sibling, i) => {
    if (sibling?.pos === 'left') return combine(sibling.hash, hash);
    if (sibling?.pos === 'right') return combine(hash, sibling.hash);
    throw new TypeError(`${caller}: siblings[${i}].pos must be "left" or "right"`);
  }, leaf);
}

function parentLevel(level, combine) {
  const parents = [];
  for (let i = 0; i < level.length; i += 2) {
    parents.push(i + 1 < level.length ? combine(level[i], level[i + 1]) : level[i]);
  }
  return parents;
}
