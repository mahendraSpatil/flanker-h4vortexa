// Owner: Archit | verify() on v2 proofs: check 2b, registeredFields, fieldDiff (explanation only), v1 compatibility
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_RESULT,
  FIELD_DIFF_CONTENT_MATCH,
  FIELD_DIFF_NEEDS_TEXT,
  RESULT,
  buildFieldTree,
  buildProof,
  buildTree,
  fieldProof,
  fileHash,
  getProof,
  leafHash,
  validateProof,
  verify,
  verifyFieldProof,
} from '../src/index.js';
import {
  ANCHOR,
  ISSUED_AT,
  PINNED,
  SLIP_TEXT,
  TAMPERED_SLIP_TEXT,
  V2_BATCH_ID,
  V2_SLIP,
  V2_TXT_SLIP,
  makeBatch,
  makeBatchV2,
  utf8,
} from './fixtures.js';

const IDS = ['0', '0b', '1', '2', '2b', '3', '4a', '4b'];
const ALL_PASS = Object.fromEntries(IDS.map((id) => [id, true]));
const OPTIONAL_KEYS = ['registeredFields', 'fieldDiff'];

function argsFor(index = V2_SLIP, batch = makeBatchV2()) {
  return {
    fileBytes: batch.files[index],
    proof: batch.proofs[index],
    chainBatch: batch.chainBatch,
    pinned: PINNED,
  };
}

/** verify() plus the invariants every v2 result must satisfy. */
function check(args) {
  const result = verify(args);
  const keys = Object.keys(result);
  assert.deepEqual(keys.slice(0, 3), ['verdict', 'checks', 'computed']);
  assert.ok(
    keys.slice(3).every((key) => OPTIONAL_KEYS.includes(key)),
    keys.join(),
  );
  assert.deepEqual(
    result.checks.map((c) => c.id),
    IDS,
  );
  const failed = result.checks.find((c) => c.pass === false);
  assert.equal(result.verdict, failed ? CHECK_RESULT[failed.id] : RESULT.VALID);
  assert.equal('registeredFields' in result, byId(result, '2b').pass === true);
  assert.equal(
    'fieldDiff' in result,
    result.verdict === RESULT.DOCUMENT_MODIFIED && args.proof?.v === 2,
  );
  if (result.verdict === RESULT.VALID) assert.equal(result.computed.root, args.chainBatch.root);
  return result;
}

const passes = (result) => Object.fromEntries(result.checks.map((c) => [c.id, c.pass]));
const byId = (result, id) => result.checks.find((c) => c.id === id);
const changedRows = (result) =>
  result.fieldDiff.fields
    .filter((row) => row.status !== 'match')
    .map(({ name, registered, found, status }) => [name, registered, found, status]);

test('v1 proofs still verify VALID, with check 2b skipped and no field keys', () => {
  const batch = makeBatch();
  batch.proofs.forEach((proof, i) => {
    const result = verify({
      fileBytes: batch.files[i],
      proof,
      chainBatch: batch.chainBatch,
      pinned: PINNED,
    });
    assert.equal(result.verdict, RESULT.VALID);
    assert.equal(proof.v, 1);
    assert.equal(byId(result, '2b').pass, null);
    assert.match(byId(result, '2b').detail, /^Skipped: v1 proofs/);
    assert.deepEqual(Object.keys(result), ['verdict', 'checks', 'computed']);
  });
});

test('v2 proofs verify VALID with every check passing, for every record in the batch', () => {
  const batch = makeBatchV2();
  for (let i = 0; i < batch.proofs.length; i++) {
    const args = argsFor(i, batch);
    const result = check(args);
    assert.equal(result.verdict, RESULT.VALID, `record ${i}`);
    assert.deepEqual(passes(result), ALL_PASS, `record ${i}`);
    assert.equal(args.proof.v, 2);
    assert.equal(byId(result, '2b').computed, args.proof.fieldsRoot);
    assert.equal(byId(result, '2b').expected, batch.records[i].fieldsRoot);
  }
});

test('VALID v2 result lists the registered fields in schema order with readable values', () => {
  const result = check(argsFor(V2_SLIP));
  assert.deepEqual(result.registeredFields, [
    { name: 'employeeName', label: 'Employee name', value: 'MEERA JOSHI', display: 'MEERA JOSHI' },
    { name: 'employeeId', label: 'Employee ID', value: 'SA-2031', display: 'SA-2031' },
    { name: 'payPeriod', label: 'Pay period', value: '2026-07', display: 'July 2026' },
    { name: 'grossPay', label: 'Gross pay', value: '3450000', display: '₹34,500' },
    { name: 'netPay', label: 'Net pay', value: '3000000', display: '₹30,000' },
  ]);
  assert.deepEqual(check(argsFor(3)).registeredFields, []); // an offer letter has no fields
});

test('an edited value in proof.fields -> PROOF_INVALID at check 2b; every other check passes', () => {
  const args = argsFor(V2_SLIP);
  args.proof.fields[4].value = '4000000'; // netPay ₹30,000 -> ₹40,000, still a normalised amount
  const result = check(args);
  assert.equal(result.verdict, RESULT.PROOF_INVALID);
  assert.deepEqual(passes(result), { ...ALL_PASS, '2b': false });
  assert.equal(byId(result, '2b').expected, args.proof.fieldsRoot);
  assert.notEqual(byId(result, '2b').computed, args.proof.fieldsRoot);
  assert.equal(result.registeredFields, undefined);
});

test('an edited salt, or a field dropped from proof.fields -> PROOF_INVALID', () => {
  const salt = argsFor(V2_SLIP);
  salt.proof.fields[0].salt = salt.proof.fields[0].salt.replace(/^./, 'f');
  assert.equal(check(salt).verdict, RESULT.PROOF_INVALID);
  const dropped = argsFor(V2_SLIP);
  dropped.proof.fields.splice(3, 1); // grossPay is optional, so the list is still well-formed
  assert.equal(check(dropped).verdict, RESULT.PROOF_INVALID);
});

test('edited fields AND fieldsRoot: the leaf changes, so it can only end in METADATA_MODIFIED or ROOT_MISMATCH', () => {
  // 1. fields + fieldsRoot edited consistently, leaf left alone: check 2 catches it
  const partial = argsFor(V2_SLIP);
  partial.proof.fields[4].value = '4000000';
  partial.proof.fieldsRoot = buildFieldTree(partial.proof.fields).root;
  const partialResult = check(partial);
  assert.equal(partialResult.verdict, RESULT.METADATA_MODIFIED);
  assert.deepEqual(passes(partialResult), { ...ALL_PASS, 2: false });

  // 2. A full forgery: fields, fieldsRoot, leaf and the whole tree rebuilt, so checks 1-3 pass
  const batch = makeBatchV2();
  const fields = batch.fields[V2_SLIP].map((f) =>
    f.name === 'netPay' ? { ...f, value: '4000000' } : f,
  );
  const record = { ...batch.records[V2_SLIP], fieldsRoot: buildFieldTree(fields).root };
  const leaves = batch.records.map(leafHash);
  leaves[V2_SLIP] = leafHash(record);
  const fake = buildTree(leaves);
  const proof = buildProof({
    record,
    fields,
    batchId: V2_BATCH_ID,
    leafIndex: V2_SLIP,
    leafCount: leaves.length,
    siblings: getProof(fake.levels, V2_SLIP),
    root: fake.root,
    anchor: ANCHOR,
    fileNormalization: 'none',
    issuedAt: ISSUED_AT,
  });
  const forged = check({ ...argsFor(V2_SLIP, batch), proof });
  assert.equal(forged.verdict, RESULT.ROOT_MISMATCH);
  assert.deepEqual(passes(forged), { ...ALL_PASS, '4b': false });
  assert.equal(byId(forged, '4b').expected, batch.root);
});

test('tampered file -> DOCUMENT_MODIFIED; fieldDiff names netPay: registered 3000000, found 4000000', () => {
  const args = { ...argsFor(V2_SLIP), fileBytes: utf8(TAMPERED_SLIP_TEXT) };
  const result = check({ ...args, fileText: TAMPERED_SLIP_TEXT });
  assert.equal(result.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.deepEqual(passes(result), { ...ALL_PASS, 1: false });
  assert.equal(result.fieldDiff.available, true);
  assert.deepEqual(changedRows(result), [['netPay', '3000000', '4000000', 'changed']]);
  assert.deepEqual(
    result.fieldDiff.fields.map((row) => [row.label, row.status]),
    [
      ['Employee name', 'match'],
      ['Employee ID', 'match'],
      ['Pay period', 'match'],
      ['Gross pay', 'match'],
      ['Net pay', 'changed'],
    ],
  );
  assert.equal(result.fieldDiff.note, undefined);
  // The explanation never changes the verdict or the checks
  const withoutText = check(args);
  assert.equal(withoutText.verdict, result.verdict);
  assert.deepEqual(withoutText.checks, result.checks);
  assert.deepEqual(withoutText.fieldDiff, {
    available: false,
    reason: FIELD_DIFF_NEEDS_TEXT,
    fields: [],
  });
});

test('every registered field matches but the bytes differ -> DOCUMENT_MODIFIED with the content-match note', () => {
  const text = SLIP_TEXT.replace('demonstration only.', 'demonstration only!');
  const result = check({ ...argsFor(V2_SLIP), fileBytes: utf8(text), fileText: text });
  assert.equal(result.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.equal(result.fieldDiff.available, true);
  assert.ok(result.fieldDiff.fields.every((row) => row.status === 'match'));
  assert.equal(result.fieldDiff.note, FIELD_DIFF_CONTENT_MATCH);
  assert.equal(
    FIELD_DIFF_CONTENT_MATCH,
    'File differs from the registered original, but every registered field matches (content match, not proof).',
  );
});

test('a field that cannot be read shows as unreadable, never as a match', () => {
  const text = SLIP_TEXT.replace('Net Pay ₹ 30,000', 'Net Pay (see attached)');
  const result = check({ ...argsFor(V2_SLIP), fileBytes: utf8(text), fileText: text });
  assert.deepEqual(changedRows(result), [['netPay', '3000000', null, 'unreadable']]);
  assert.equal(result.fieldDiff.note, undefined);
});

test('.txt (text-v1) slip: core reads the file itself, no fileText needed', () => {
  const args = argsFor(V2_TXT_SLIP);
  const original = new TextDecoder().decode(args.fileBytes);
  const edited = utf8(original.replace('Rs 52,500/-', 'Rs 62,500/-'));
  const result = check({ ...args, fileBytes: edited });
  assert.equal(result.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.deepEqual(changedRows(result), [['netPay', '5250000', '6250000', 'changed']]);
  // Line endings alone are not a modification under text-v1
  assert.equal(
    check({ ...args, fileBytes: utf8(original.replace(/\r\n/g, '\n')) }).verdict,
    RESULT.VALID,
  );
});

test('fieldDiff is unavailable for images, when the proof also failed, and for types without fields', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const image = check({ ...argsFor(V2_SLIP), fileBytes: png, fileText: null });
  assert.deepEqual(image.fieldDiff, {
    available: false,
    reason: FIELD_DIFF_NEEDS_TEXT,
    fields: [],
  });
  assert.equal(
    FIELD_DIFF_NEEDS_TEXT,
    'field comparison needs a PDF with selectable text or a .txt file',
  );
  const blank = check({ ...argsFor(V2_SLIP), fileBytes: png, fileText: '  \n ' });
  assert.equal(blank.fieldDiff.reason, FIELD_DIFF_NEEDS_TEXT);

  // Wrong file AND a root that does not match the chain: the registered values are not trustworthy
  const args = argsFor(V2_SLIP);
  const untrusted = check({
    ...args,
    fileBytes: utf8(TAMPERED_SLIP_TEXT),
    fileText: TAMPERED_SLIP_TEXT,
    chainBatch: { ...args.chainBatch, leafCount: 6 },
  });
  assert.equal(untrusted.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.equal(untrusted.fieldDiff.available, false);
  assert.match(untrusted.fieldDiff.reason, /failed check 4b/);

  const offer = check({ ...argsFor(3), fileBytes: utf8('another offer letter') });
  assert.deepEqual(offer.fieldDiff, {
    available: false,
    reason: 'no fields are registered for OFFER_LETTER',
    fields: [],
  });
});

test('v1 DOCUMENT_MODIFIED has no fieldDiff (nothing registered to compare)', () => {
  const batch = makeBatch();
  const result = verify({
    fileBytes: utf8('a different file'),
    proof: batch.proofs[2],
    chainBatch: batch.chainBatch,
    pinned: PINNED,
    fileText: 'Net salary: Rs 80,000',
  });
  assert.equal(result.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.deepEqual(Object.keys(result), ['verdict', 'checks', 'computed']);
});

test('malformed fields in a v2 proof -> FORMAT_INVALID with every later check skipped', () => {
  const cases = {
    'value not normalised': (p) => (p.fields[4].value = '30,000'),
    'out of schema order': (p) => p.fields.reverse(),
    'required field missing': (p) => p.fields.pop(),
    'unknown field': (p) => p.fields.push({ name: 'bonus', value: '1', salt: p.fields[0].salt }),
    'bad salt': (p) => (p.fields[0].salt = 'xyz'),
    'fields missing': (p) => delete p.fields,
    'fieldsRoot missing': (p) => delete p.fieldsRoot,
    'fieldsRoot uppercase': (p) => (p.fieldsRoot = '0x' + p.fieldsRoot.slice(2).toUpperCase()),
    'v1 with fields': (p) => (p.v = 1),
    'v2 without fields': (p) => {
      delete p.fields;
      delete p.fieldsRoot;
    },
    'docType without that field': (p) => (p.metadata.docType = 'MARKSHEET'),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const args = argsFor(V2_SLIP);
    mutate(args.proof);
    let result;
    assert.doesNotThrow(() => (result = check(args)), name);
    assert.equal(result.verdict, RESULT.FORMAT_INVALID, name);
    assert.ok(
      result.checks.slice(1).every((c) => c.pass === null),
      name,
    );
  }
});

test('proof.json v2 shape: fieldsRoot and fields sit between fileHash and leaf', () => {
  const proof = makeBatchV2().proofs[V2_SLIP];
  assert.deepEqual(Object.keys(proof), [
    'v',
    'scheme',
    'recordId',
    'metadata',
    'fileHash',
    'fieldsRoot',
    'fields',
    'leaf',
    'batchId',
    'leafIndex',
    'leafCount',
    'siblings',
    'root',
    'anchor',
    'issuedAt',
  ]);
  assert.deepEqual(Object.keys(proof.fields[0]), ['name', 'value', 'salt']);
  assert.deepEqual(validateProof(proof), { ok: true, errors: {} });
});

test('buildProof refuses inconsistent v2 input (INVALID_PROOF)', () => {
  const batch = makeBatchV2();
  const args = {
    record: batch.records[V2_SLIP],
    fields: batch.fields[V2_SLIP],
    batchId: V2_BATCH_ID,
    leafIndex: V2_SLIP,
    leafCount: batch.records.length,
    siblings: getProof(batch.levels, V2_SLIP),
    root: batch.root,
    anchor: ANCHOR,
    fileNormalization: 'none',
    issuedAt: ISSUED_AT,
  };
  assert.doesNotThrow(() => buildProof(args));
  const otherFields = args.fields.map((f) => (f.name === 'netPay' ? { ...f, value: '1' } : f));
  const cases = {
    'fields without a matching fieldsRoot': { fields: otherFields },
    'record with fieldsRoot but no fields': { fields: undefined },
    'fields out of order': { fields: [...args.fields].reverse() },
    'fields for another docType': { record: { ...args.record, docType: 'MARKSHEET' } },
  };
  for (const [name, change] of Object.entries(cases)) {
    assert.throws(() => buildProof({ ...args, ...change }), { code: 'INVALID_PROOF' }, name);
  }
  // Without a record.fieldsRoot, buildProof computes it from the fields
  const { fieldsRoot, ...withoutRoot } = args.record;
  assert.equal(buildProof({ ...args, record: withoutRoot }).fieldsRoot, fieldsRoot);
});

test('single-field disclosure from a verified proof: fieldProof against proof.fieldsRoot', () => {
  const { proof } = argsFor(V2_SLIP);
  assert.equal(check(argsFor(V2_SLIP)).verdict, RESULT.VALID);
  const netPay = proof.fields.findIndex((f) => f.name === 'netPay');
  const disclosure = fieldProof(proof.fields, netPay);
  assert.equal(verifyFieldProof(disclosure, proof.fieldsRoot), true);
  disclosure.field.value = '4000000';
  assert.equal(verifyFieldProof(disclosure, proof.fieldsRoot), false);
});

test('the file hash alone decides check 1: same text, different bytes still fails', () => {
  const args = argsFor(V2_SLIP);
  const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...args.fileBytes]);
  const result = check({ ...args, fileBytes: withBom, fileText: SLIP_TEXT });
  assert.equal(result.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.equal(byId(result, '1').computed, fileHash(withBom));
  assert.equal(result.fieldDiff.note, FIELD_DIFF_CONTENT_MATCH);
});
