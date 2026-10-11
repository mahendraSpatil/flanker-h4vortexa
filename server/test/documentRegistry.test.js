// Owner: Mahendra | Upload -> draft -> confirm -> pending against the real schema.sql
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, beforeEach, test } from 'node:test';
import { buildFieldTree, canonicalJSON } from '@proofchain/core';
import { auditRecorder, memoryStorage, openTestDb, sha256Hex, tinyPdf } from './documentHelpers.js';
import { prepareTestEnv } from './helpers.js';

// Every server test points server code at a temp DB + storage BEFORE importing it (CLAUDE.md).
const { tempDir } = prepareTestEnv();
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
const { createDocumentRegistry } = await import('../src/services/documentRegistry.js');

const NOW = new Date('2026-10-11T10:00:00');
/** Salary-slip fields as a person types them on the confirm screen. */
const SLIP_FIELDS = { employeeName: ' riya  sharma ', payPeriod: 'June 2026', netPay: 'Rs 46,200/-' };
const SUGGESTIONS = {
  docType: 'SALARY_SLIP',
  issuer: 'Acme Technologies Pvt Ltd',
  date: '2026-06-30',
  confidence: { docType: 0.9, issuer: 0.8, date: 0.7 },
  evidence: { docType: 'Salary Slip', issuer: 'ACME TECHNOLOGIES PVT LTD', date: 'Date: 30/06/2026' },
};

let db;
let storage;
let audit;
let registry;
let extractCalls;
let saltCounter;
/** Deterministic salts so the expected fieldsRoot can be computed independently. */
const testSalt = () => (++saltCounter).toString(16).padStart(32, '0');

beforeEach(async () => {
  db = await openTestDb();
  storage = memoryStorage();
  audit = auditRecorder();
  extractCalls = [];
  saltCounter = 0;
  registry = createDocumentRegistry({
    db,
    storage,
    logAction: audit.logAction,
    now: () => NOW,
    salt: testSalt,
    extractText: async (buffer, mime) => {
      extractCalls.push(mime);
      return { text: 'Salary Slip\nACME TECHNOLOGIES PVT LTD\nDate: 30/06/2026', method: 'pdf-text' };
    },
    suggestMetadata: async () => ({ suggestions: SUGGESTIONS, extractionPath: 'ai', diagnostics: { raw: '{}' } }),
  });
});

const upload = (buffer, originalName = 'slip.pdf', actor = 'Mahendra') =>
  registry.upload({ buffer, originalName, actor });

const rejection = async (promiseOrFn) => {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (err) {
    return err;
  }
  assert.fail('expected an error');
};

test('upload hashes the raw bytes, stores the file and saves a draft with suggestions', async () => {
  const pdf = tinyPdf('salary');
  const result = await upload(pdf);

  assert.equal(result.recordId, 'REC-000001');
  assert.equal(result.fileHash, sha256Hex(pdf), 'fileHash = SHA-256(raw bytes)');
  assert.equal(result.status, 'draft');
  assert.equal(result.extractionPath, 'ai');
  assert.deepEqual(result.suggestions, SUGGESTIONS);
  assert.ok(storage.files.get(result.fileHash).equals(pdf), 'raw bytes stored under the hash');

  const [row] = registry.list();
  assert.equal(row.status, 'draft');
  assert.equal(row.docType, null, 'nothing is confirmed by AI');
  assert.equal(row.mime, 'application/pdf');
  assert.equal(row.createdBy, 'Mahendra');
  assert.deepEqual(row.suggestions, SUGGESTIONS);

  const actions = audit.entries.map((e) => `${e.action}:${e.outcome}`);
  assert.deepEqual(actions, ['UPLOAD:OK']);
  assert.equal((await upload(tinyPdf('second'))).recordId, 'REC-000002');
});

test('duplicate upload -> 409 DUPLICATE with the existing recordId and batch', async () => {
  const first = await upload(tinyPdf('dup'));
  const err = await rejection(upload(tinyPdf('dup'), 'renamed.pdf', 'Neel'));
  assert.equal(err.code, 'DUPLICATE');
  assert.equal(err.status, 409);
  assert.deepEqual(err.details, { recordId: first.recordId, batchId: null, status: 'draft' });
  assert.equal(registry.list().length, 1);
  assert.equal(audit.entries.at(-1).action, 'REJECT');
  assert.equal(audit.entries.at(-1).outcome, 'DUPLICATE');
});

test('.txt is normalised before hashing: CRLF and trailing spaces do not create a new record', async () => {
  const lf = Buffer.from('Offer Letter\nNimbus Solutions Limited', 'utf8');
  const crlf = Buffer.from('Offer Letter  \r\nNimbus Solutions Limited\r\n', 'utf8');
  const first = await upload(lf, 'offer.txt');
  assert.equal(first.mime, 'text/plain');
  assert.equal(first.textMethod, 'pdf-text', 'textMethod comes from the extractor');
  assert.equal(first.fileHash, sha256Hex(lf), 'already-normal text hashes to its own bytes');

  const err = await rejection(upload(crlf, 'offer-windows.txt'));
  assert.equal(err.code, 'DUPLICATE');
  assert.ok(storage.files.get(first.fileHash).equals(lf), 'stored bytes are the raw upload');
});

test('invalid uploads are rejected before anything is stored, and audited', async () => {
  const err = await rejection(upload(Buffer.from('%PDF-1.4'), 'note.txt'));
  assert.equal(err.code, 'UNSUPPORTED_TYPE');
  assert.equal(storage.files.size, 0);
  assert.equal(registry.list().length, 0);
  assert.equal(audit.entries[0].action, 'REJECT');
});

test('extraction failure still creates the draft, with a warning and fallback suggestions', async () => {
  registry = createDocumentRegistry({
    db,
    storage,
    logAction: audit.logAction,
    now: () => NOW,
    extractText: async () => {
      throw new Error('OCR language data could not be downloaded');
    },
    suggestMetadata: async (text) => ({
      suggestions: { docType: null, issuer: null, date: null, confidence: { docType: 0, issuer: 0, date: 0 }, evidence: { docType: '', issuer: '', date: '' } },
      extractionPath: text ? 'ai' : 'fallback',
    }),
  });
  const result = await upload(tinyPdf('scan'));
  assert.equal(result.status, 'draft');
  assert.equal(result.extractionPath, 'fallback');
  assert.ok(result.warnings.some((w) => /extraction failed/i.test(w)));
});

test('confirm validates, normalises + salts the fields, builds the v2 record + leaf with core, -> pending', async () => {
  const { recordId, fileHash } = await upload(tinyPdf('confirm'));
  const result = registry.confirm(
    recordId,
    { docType: 'SALARY_SLIP', issuer: '  Acme   Technologies Pvt Ltd ', date: '2026-06-30', fields: SLIP_FIELDS },
    'Mahendra',
  );

  // Stored in schema order, normalised, each with its own 32-hex salt
  const stored = db.prepare('SELECT idx, name, value, salt FROM record_fields WHERE record_id = ? ORDER BY idx').all(recordId);
  assert.deepEqual(
    stored.map(({ idx, name, value }) => [idx, name, value]),
    [
      [0, 'employeeName', 'RIYA SHARMA'],
      [1, 'payPeriod', '2026-06'],
      [2, 'netPay', '4620000'],
    ],
  );
  assert.ok(stored.every((f) => /^[0-9a-f]{32}$/.test(f.salt)), 'salts are 32 lowercase hex');
  assert.equal(new Set(stored.map((f) => f.salt)).size, 3, 'one salt per field');

  const fieldsRoot = buildFieldTree(stored.map(({ name, value, salt }) => ({ name, value, salt }))).root;
  const canonical =
    `{"date":"2026-06-30","docType":"SALARY_SLIP","fieldsRoot":"${fieldsRoot}","fileHash":"${fileHash}",` +
    `"issuer":"Acme Technologies Pvt Ltd","recordId":"${recordId}","v":2}`;
  assert.equal(canonicalJSON({ recordId, fileHash, fieldsRoot, docType: 'SALARY_SLIP', issuer: 'Acme Technologies Pvt Ltd', date: '2026-06-30' }), canonical);
  const expectedLeaf = sha256Hex(Buffer.concat([Buffer.from([0x00]), Buffer.from(canonical, 'utf8')]));

  assert.equal(result.status, 'pending');
  assert.equal(result.leaf, expectedLeaf, 'leaf = SHA-256(0x00 || canonicalJSON(v2 record))');
  assert.equal(result.canonical, canonical);
  assert.equal(result.record.status, 'pending');
  assert.equal(result.record.issuer, 'Acme Technologies Pvt Ltd', 'issuer stored normalised');
  assert.equal(result.record.leaf, expectedLeaf);
  assert.equal(result.record.confirmedBy, 'Mahendra');
  assert.deepEqual(result.record.fields, [
    { name: 'employeeName', label: 'Employee name', value: 'RIYA SHARMA', display: 'RIYA SHARMA' },
    { name: 'payPeriod', label: 'Pay period', value: '2026-06', display: 'June 2026' },
    { name: 'netPay', label: 'Net pay', value: '4620000', display: '₹46,200' },
  ]);
  assert.ok(!JSON.stringify(result.record).includes(stored[0].salt), 'salts never leave the DB via the record API');

  const confirmEntry = audit.entries.find((e) => e.action === 'CONFIRM');
  assert.deepEqual(confirmEntry.detail.editedFields, ['fields.employeeName', 'fields.payPeriod', 'fields.netPay'], 'the mock suggested no fields');
  assert.equal(confirmEntry.detail.fieldsRoot, fieldsRoot);
});

test('confirm rejects missing or unreadable fields as 400 VALIDATION keyed fields.<name>', async () => {
  const { recordId } = await upload(tinyPdf('fields'));
  const err = await rejection(() =>
    registry.confirm(
      recordId,
      { docType: 'SALARY_SLIP', issuer: 'Acme', date: '2026-06-30', fields: { employeeName: 'Riya', netPay: 'lots', bonus: '1' } },
      'Mahendra',
    ),
  );
  assert.equal(err.code, 'VALIDATION');
  assert.deepEqual(Object.keys(err.details.fields).sort(), ['fields.bonus', 'fields.netPay', 'fields.payPeriod']);
  assert.equal(err.details.fields['fields.payPeriod'], 'is required');
  assert.equal(db.prepare('SELECT COUNT(*) FROM record_fields').pluck().get(), 0);
  // A docType without fields needs none (its fieldsRoot is the empty root)
  const offer = registry.confirm(recordId, { docType: 'OFFER_LETTER', issuer: 'Acme', date: '2026-06-30' }, 'x');
  assert.deepEqual(offer.record.fields, []);
  assert.match(offer.canonical, /"fieldsRoot":"0xe52d9c508c502347344d8c07ad91cbd6068afc75ff6292f062a09ca381c89e71"/);
});

test('re-confirming replaces the fields with freshly salted ones', async () => {
  const { recordId } = await upload(tinyPdf('reconfirm'));
  const body = { docType: 'SALARY_SLIP', issuer: 'Acme', date: '2026-06-30', fields: SLIP_FIELDS };
  const first = registry.confirm(recordId, body, 'A');
  const saltsBefore = db.prepare('SELECT salt FROM record_fields WHERE record_id = ?').pluck().all(recordId);
  const second = registry.confirm(recordId, { ...body, fields: { ...SLIP_FIELDS, employeeId: 'ac-77' } }, 'A');
  const rows = db.prepare('SELECT name, salt FROM record_fields WHERE record_id = ? ORDER BY idx').all(recordId);
  assert.deepEqual(rows.map((r) => r.name), ['employeeName', 'employeeId', 'payPeriod', 'netPay']);
  assert.ok(rows.every((r) => !saltsBefore.includes(r.salt)), 'new salts');
  assert.notEqual(first.leaf, second.leaf);
});

test('confirm rejects bad fields with 400 VALIDATION and leaves the draft untouched', async () => {
  const { recordId } = await upload(tinyPdf('bad'));
  const err = await rejection(() =>
    registry.confirm(recordId, { docType: 'PASSPORT', issuer: '', date: '2026-10-12' }, 'Mahendra'),
  );
  assert.equal(err.code, 'VALIDATION');
  assert.equal(err.status, 400);
  assert.deepEqual(Object.keys(err.details.fields).sort(), ['date', 'docType', 'issuer']);
  assert.equal(registry.list({ recordId })[0].status, 'draft');
  assert.equal(audit.entries.at(-1).outcome, 'VALIDATION');
});

test('pending records can be re-confirmed; anchored records cannot; unknown ids are 404', async () => {
  const { recordId } = await upload(tinyPdf('state'));
  const body = { docType: 'SALARY_SLIP', issuer: 'Acme', date: '2026-06-30', fields: SLIP_FIELDS };
  const first = registry.confirm(recordId, body, 'A');
  const second = registry.confirm(recordId, { ...body, issuer: 'Acme Technologies' }, 'B');
  assert.notEqual(first.leaf, second.leaf, 'changing a confirmed field changes the leaf');

  db.exec("INSERT INTO batches (batch_id, root, leaf_count, tree_json) VALUES ('BATCH-0001', '0x00', 1, '[]')");
  db.prepare("UPDATE records SET status = 'anchored', batch_id = 'BATCH-0001', leaf_index = 0 WHERE record_id = ?").run(recordId);
  const anchored = await rejection(() => registry.confirm(recordId, body, 'A'));
  assert.equal(anchored.code, 'ALREADY_ANCHORED');
  assert.equal(anchored.status, 409);

  const dupOfAnchored = await rejection(upload(tinyPdf('state')));
  assert.deepEqual(dupOfAnchored.details, { recordId, batchId: 'BATCH-0001', status: 'anchored' });

  assert.equal((await rejection(() => registry.confirm('REC-999999', body, 'A'))).code, 'NOT_FOUND');
  assert.equal((await rejection(() => registry.confirm("REC-1' OR 1=1", body, 'A'))).code, 'NOT_FOUND');
});

test('list filters by status, docType, issuer substring (wildcards escaped), batchId and recordId', async () => {
  const a = await upload(tinyPdf('a'));
  const b = await upload(tinyPdf('b'));
  await upload(tinyPdf('c'));
  registry.confirm(a.recordId, { docType: 'MARKSHEET', issuer: 'Deccan College', date: '2026-01-01', fields: { studentName: 'Asha Rao' } }, 'x');
  registry.confirm(b.recordId, { docType: 'SALARY_SLIP', issuer: 'Acme 100% Pvt Ltd', date: '2026-01-01', fields: SLIP_FIELDS }, 'x');

  assert.equal(registry.list({ status: 'draft' }).length, 1);
  assert.deepEqual(registry.list({ docType: 'MARKSHEET' }).map((r) => r.recordId), [a.recordId]);
  assert.deepEqual(registry.list({ issuer: 'deccan' }).map((r) => r.recordId), [a.recordId]);
  assert.deepEqual(registry.list({ issuer: '100%' }).map((r) => r.recordId), [b.recordId]);
  assert.equal(registry.list({ issuer: '%' }).length, 1, '% is literal, not a wildcard');
  assert.equal(registry.list({ batchId: 'BATCH-0001' }).length, 0);
  assert.deepEqual(registry.list().map((r) => r.recordId), ['REC-000001', 'REC-000002', 'REC-000003']);
});

test('getFile returns the stored bytes, mime and name; missing record -> 404', async () => {
  const pdf = tinyPdf('file');
  const { recordId } = await upload(pdf, 'Salary June.pdf');
  const file = await registry.getFile(recordId);
  assert.ok(file.buffer.equals(pdf));
  assert.equal(file.mime, 'application/pdf');
  assert.equal(file.fileName, 'Salary June.pdf');
  assert.equal((await rejection(registry.getFile('REC-000404'))).code, 'NOT_FOUND');
});
