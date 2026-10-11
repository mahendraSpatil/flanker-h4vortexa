// Owner: Archit | Recompute core/test/vectors.json from its inputs, with core and with the independent reference
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEME,
  buildProof,
  buildTree,
  canonicalJSON,
  fileHash,
  getProof,
  leafHash,
  normalizeTextFile,
  verify,
} from '../src/index.js';
import { refLeaf, refPath, refRoot, sha256 } from './reference.js';
import { PINNED, VECTORS, recordOf, toText, utf8 } from './fixtures.js';

test('vectors: the scheme is the one this code implements', () => {
  const { v, ...scheme } = SCHEME;
  assert.equal(VECTORS.v, v);
  assert.deepEqual(VECTORS.scheme, scheme);
  assert.equal(VECTORS.records.length, 5);
});

test('vectors: every fileHash, canonical record and leaf recomputes exactly', () => {
  VECTORS.records.forEach((entry, i) => {
    const bytes = utf8(entry.file);
    assert.equal(fileHash(bytes, { normalization: entry.fileNormalization }), entry.fileHash);
    if (entry.fileNormalization === 'none') {
      assert.equal(sha256(bytes), entry.fileHash);
    } else {
      assert.equal(toText(normalizeTextFile(bytes)), entry.normalizedFile);
      assert.equal(sha256(utf8(entry.normalizedFile)), entry.fileHash);
    }
    const record = recordOf(entry);
    assert.equal(canonicalJSON(record), entry.canonical);
    assert.equal(leafHash(record), VECTORS.leaves[i]);
    assert.equal(refLeaf(record), VECTORS.leaves[i]);
  });
});

test('vectors: tree levels and root recompute exactly', () => {
  const { root, levels } = buildTree(VECTORS.leaves);
  assert.deepEqual(levels, VECTORS.levels);
  assert.deepEqual(levels[0], VECTORS.leaves);
  assert.equal(root, VECTORS.root);
  assert.equal(refRoot(VECTORS.leaves), VECTORS.root);
});

test('vectors: the stored proof is rebuilt byte for byte and verifies VALID', () => {
  const { proof } = VECTORS;
  const entry = VECTORS.records[proof.leafIndex];
  const siblings = getProof(VECTORS.levels, proof.leafIndex);
  assert.deepEqual(siblings, refPath(VECTORS.leaves, proof.leafIndex));
  const rebuilt = buildProof({
    record: recordOf(entry),
    batchId: VECTORS.batchId,
    leafIndex: proof.leafIndex,
    leafCount: VECTORS.leaves.length,
    siblings,
    root: VECTORS.root,
    anchor: proof.anchor,
    fileNormalization: entry.fileNormalization,
    issuedAt: proof.issuedAt,
  });
  assert.equal(JSON.stringify(rebuilt), JSON.stringify(proof));
  const result = verify({
    fileBytes: utf8(entry.file),
    proof,
    chainBatch: { root: VECTORS.root, leafCount: VECTORS.leaves.length },
    pinned: PINNED,
  });
  assert.equal(result.verdict, 'VALID');
});
