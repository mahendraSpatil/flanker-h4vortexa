// Owner: Archit | Tests for proof.js: proof.json shape (vs CLAUDE.md), determinism, self-checks, validateProof
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProof, getProof, leafHash, validateProof } from '../src/index.js';
import { ANCHOR, ISSUED_AT, VECTORS, makeBatch, makeBatchV2 } from './fixtures.js';

// The proof.json example in CLAUDE.md is the reference for field order
function specExample() {
  const spec = readFileSync(new URL('../../CLAUDE.md', import.meta.url), 'utf8');
  const section = spec.slice(spec.indexOf('\n## proof.json'));
  const start = section.indexOf('```json\n') + '```json\n'.length;
  return JSON.parse(section.slice(start, section.indexOf('\n```', start)));
}

// Nested key order: objects -> their keys and children; arrays -> shape of the first item
function keyShape(value) {
  if (Array.isArray(value)) return [keyShape(value[0])];
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).map(([key, child]) => [key, keyShape(child)]);
  }
  return typeof value;
}

function argsFor(batch, leafIndex) {
  return {
    record: batch.records[leafIndex],
    batchId: VECTORS.batchId,
    leafIndex,
    leafCount: batch.records.length,
    siblings: getProof(batch.levels, leafIndex),
    root: batch.root,
    anchor: ANCHOR,
    fileNormalization: VECTORS.records[leafIndex].fileNormalization,
    issuedAt: ISSUED_AT,
  };
}

test('buildProof key order matches the CLAUDE.md proof.json example at every level', () => {
  // The example is v2; a v1 proof is the same shape without fieldsRoot and fields
  const example = specExample();
  assert.equal(example.v, 2);
  assert.deepEqual(keyShape(makeBatchV2().proofs[0]), keyShape(example));
  const { fieldsRoot, fields, ...v1Example } = example;
  assert.deepEqual(keyShape(makeBatch().proofs[2]), keyShape(v1Example));
});

test('buildProof is deterministic with a fixed issuedAt', () => {
  const batch = makeBatch();
  const first = JSON.stringify(buildProof(argsFor(batch, 2)));
  assert.equal(JSON.stringify(buildProof(argsFor(batch, 2))), first);
  assert.equal(first, JSON.stringify(VECTORS.proof));
});

test('buildProof computes the leaf itself and normalises hex case and issuer', () => {
  const batch = makeBatch();
  const args = argsFor(batch, 1);
  const upper = (hex) => '0x' + hex.slice(2).toUpperCase();
  const proof = buildProof({
    ...args,
    record: { ...args.record, issuer: `  ${args.record.issuer.replace(/ /g, '   ')} ` },
    siblings: args.siblings.map((s) => ({ ...s, hash: upper(s.hash) })),
    root: upper(args.root),
    anchor: { ...ANCHOR, txHash: upper(ANCHOR.txHash) },
  });
  assert.deepEqual(proof, buildProof(args));
  assert.equal(proof.leaf, leafHash(args.record));
});

test('buildProof defaults issuedAt to the current time in ISO 8601 UTC', () => {
  const args = argsFor(makeBatch(), 0);
  delete args.issuedAt;
  const before = Date.now();
  const proof = buildProof(args);
  const after = Date.now();
  assert.match(proof.issuedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const issued = Date.parse(proof.issuedAt);
  assert.ok(issued >= before && issued <= after);
});

test('buildProof rejects a bad record with INVALID_RECORD', () => {
  const args = argsFor(makeBatch(), 0);
  assert.throws(() => buildProof({ ...args, record: { ...args.record, docType: 'PASSPORT' } }), {
    code: 'INVALID_RECORD',
  });
  assert.throws(() => buildProof({ ...args, record: null }), { code: 'INVALID_RECORD' });
});

test('buildProof refuses to issue a proof that would not verify (INVALID_PROOF)', () => {
  const batch = makeBatch();
  const args = argsFor(batch, 2);
  const cases = {
    batchId: { batchId: 'BATCH-1' },
    'scheme.fileNormalization': { fileNormalization: 'gzip' },
    anchor: { anchor: undefined },
    'anchor.chainId': { anchor: { ...ANCHOR, chainId: 31337n } },
    leafIndex: { leafIndex: 5 },
    siblings: { siblings: getProof(batch.levels, 2).slice(1) }, // wrong length
    root: { root: batch.levels[1][0] }, // siblings do not fold to it
    issuedAt: { issuedAt: '11/10/2026' },
  };
  for (const [path, change] of Object.entries(cases)) {
    assert.throws(
      () => buildProof({ ...args, ...change }),
      (error) => error.code === 'INVALID_PROOF' && path in error.errors,
      path,
    );
  }
  // Right length, wrong sides: siblings for leaf 3 used for leaf 2
  assert.throws(() => buildProof({ ...args, siblings: getProof(batch.levels, 3) }), {
    code: 'INVALID_PROOF',
  });
});

test('validateProof accepts every proof in the batch', () => {
  for (const proof of makeBatch().proofs) {
    assert.deepEqual(validateProof(proof), { ok: true, errors: {} });
  }
});

test('validateProof never throws on junk and reports a path for each problem', () => {
  for (const junk of [undefined, null, 0, '', '{}', [], true]) {
    assert.deepEqual(validateProof(junk), {
      ok: false,
      errors: { proof: 'must be a JSON object' },
    });
  }
  const { errors } = validateProof({});
  assert.equal(Object.keys(errors).length, 13);
  assert.equal(errors.leaf, 'is required');

  const proof = makeBatch().proofs[2];
  proof.extra = 1;
  proof.scheme.hash = 'sha512';
  proof.metadata.issuer = ' Sahyadri Analytics Pvt Ltd';
  proof.siblings[1].pos = 'up';
  proof.anchor.contract = '0x1234';
  delete proof.issuedAt;
  assert.deepEqual(Object.keys(validateProof(proof).errors).sort(), [
    'anchor.contract',
    'extra',
    'issuedAt',
    'metadata.issuer',
    'scheme.hash',
    'siblings[1].pos',
  ]);
});

test('validateProof keeps an error for an extra "__proto__" key from JSON.parse', () => {
  const proof = JSON.parse(JSON.stringify(makeBatch().proofs[0]).replace('{', '{"__proto__":1,'));
  const { ok, errors } = validateProof(proof);
  assert.equal(ok, false);
  assert.ok(Object.hasOwn(errors, '__proto__'));
});
