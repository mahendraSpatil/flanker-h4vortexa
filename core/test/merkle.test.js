// Owner: Archit | Tests for merkle.js against an independent reference tree (test/reference.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTree,
  expectedPathLength,
  expectedPositions,
  foldProof,
  getProof,
} from '../src/index.js';
import { refNode, refPath, refRoot, sha256 } from './reference.js';

const leavesOf = (n) => Array.from({ length: n }, (_, i) => sha256(Buffer.from(`leaf ${i}`)));
const raw = (hex) => Buffer.from(hex.slice(2), 'hex');

for (let n = 1; n <= 9; n++) {
  test(`${n} leaves: root matches the reference; every proof matches it and folds back`, () => {
    const leaves = leavesOf(n);
    const { root, levels } = buildTree(leaves);
    assert.equal(root, refRoot(leaves));
    assert.deepEqual(levels[0], leaves);
    assert.deepEqual(levels[levels.length - 1], [root]);
    for (let i = 0; i < n; i++) {
      const siblings = getProof(levels, i);
      assert.deepEqual(siblings, refPath(leaves, i), `path of leaf ${i}`);
      assert.equal(foldProof(leaves[i], siblings), root, `fold of leaf ${i}`);
      assert.equal(siblings.length, expectedPathLength(i, n));
      assert.deepEqual(
        siblings.map((s) => s.pos),
        expectedPositions(i, n),
      );
    }
  });
}

test('roots and paths match the reference for 10 to 70 leaves', () => {
  for (let n = 10; n <= 70; n++) {
    const leaves = leavesOf(n);
    const { root, levels } = buildTree(leaves);
    assert.equal(root, refRoot(leaves), `${n} leaves`);
    for (const i of [0, n - 2, n - 1]) {
      assert.deepEqual(getProof(levels, i), refPath(leaves, i), `${n} leaves, leaf ${i}`);
    }
  }
});

test('1 leaf: the root is the leaf itself and the proof is empty', () => {
  const [leaf] = leavesOf(1);
  const { root, levels } = buildTree([leaf]);
  assert.equal(root, leaf);
  assert.deepEqual(levels, [[leaf]]);
  assert.deepEqual(getProof(levels, 0), []);
  assert.equal(foldProof(leaf, []), leaf);
  assert.equal(expectedPathLength(0, 1), 0);
});

test('5 leaves: leaf 4 is promoted unchanged twice; its proof is exactly [{ N0123, left }]', () => {
  const [l0, l1, l2, l3, l4] = leavesOf(5);
  const n0123 = refNode(refNode(l0, l1), refNode(l2, l3));
  const { root, levels } = buildTree([l0, l1, l2, l3, l4]);
  assert.deepEqual(getProof(levels, 4), [{ hash: n0123, pos: 'left' }]);
  assert.equal(levels[1][2], l4);
  assert.equal(levels[2][1], l4);
  assert.equal(root, refNode(n0123, l4));
});

test('odd node is promoted, never duplicated', () => {
  const [l0, l1, l2] = leavesOf(3);
  const { root } = buildTree([l0, l1, l2]);
  assert.equal(root, refNode(refNode(l0, l1), l2));
  assert.notEqual(root, refNode(refNode(l0, l1), refNode(l2, l2)));
});

test('root of [a, b] differs from SHA-256(a || b) without prefixes', () => {
  const [a, b] = leavesOf(2);
  const { root } = buildTree([a, b]);
  assert.equal(root, refNode(a, b));
  assert.notEqual(root, sha256(raw(a), raw(b)));
});

test('buildTree lowercases leaves, so input case never changes the root', () => {
  const leaves = leavesOf(3);
  const upper = leaves.map((leaf) => '0x' + leaf.slice(2).toUpperCase());
  const { root, levels } = buildTree(upper);
  assert.equal(root, buildTree(leaves).root);
  assert.deepEqual(levels[0], leaves);
});

test('buildTree rejects empty or invalid input', () => {
  const [leaf] = leavesOf(1);
  for (const bad of [[], null, undefined, leaf, [leaf, '0x1234'], [leaf, null], [leaf.slice(2)]]) {
    assert.throws(() => buildTree(bad), TypeError, JSON.stringify(bad));
  }
});

test('getProof rejects out-of-range indexes and malformed levels', () => {
  const { levels } = buildTree(leavesOf(5));
  for (const index of [-1, 5, 1.5, '1', undefined]) {
    assert.throws(() => getProof(levels, index), RangeError, String(index));
  }
  const malformed = [
    null,
    [],
    [[]],
    levels.slice(0, -1), // no single root
    [...levels, levels[levels.length - 1]], // redundant extra root level
    [levels[0], levels[2], levels[3]], // a level missing
  ];
  for (const bad of malformed) assert.throws(() => getProof(bad, 0), TypeError);
});

test('foldProof: changing any sibling hash or side changes the result', () => {
  const leaves = leavesOf(7);
  const { root, levels } = buildTree(leaves);
  const siblings = getProof(levels, 2);
  for (let i = 0; i < siblings.length; i++) {
    const flippedSide = siblings.map((s, j) =>
      j === i ? { ...s, pos: s.pos === 'left' ? 'right' : 'left' } : s,
    );
    assert.notEqual(foldProof(leaves[2], flippedSide), root);
    const otherHash = siblings.map((s, j) => (j === i ? { ...s, hash: leaves[6] } : s));
    assert.notEqual(foldProof(leaves[2], otherHash), root);
  }
  assert.notEqual(foldProof(leaves[3], siblings), root);
});

test('foldProof rejects malformed input', () => {
  const [leaf, other] = leavesOf(2);
  assert.throws(() => foldProof('0x12', []), TypeError);
  assert.throws(() => foldProof(leaf, null), TypeError);
  assert.throws(() => foldProof(leaf, [{ hash: other, pos: 'up' }]), TypeError);
  assert.throws(() => foldProof(leaf, [{ hash: '0x12', pos: 'left' }]), TypeError);
  assert.throws(() => foldProof(leaf, [null]), TypeError);
});

test('expectedPositions/expectedPathLength derive the path shape from index and count alone', () => {
  assert.deepEqual(expectedPositions(6, 7), ['left', 'left']); // promoted once at the bottom
  assert.deepEqual(expectedPositions(0, 8), ['right', 'right', 'right']);
  assert.equal(expectedPathLength(0, 1_000_000), 20); // CLAUDE.md: 20 siblings for 1,000,000 documents
  assert.equal(expectedPathLength(999_999, 1_000_000), 12); // last leaf: promoted at 8 levels
  assert.equal(expectedPathLength(0, 2 ** 32 - 1), 32);
  for (const [index, count] of [
    [0, 0],
    [3, 3],
    [-1, 3],
    [0.5, 3],
    [0, 1.5],
  ]) {
    assert.throws(() => expectedPositions(index, count), RangeError, `${index} of ${count}`);
  }
});
