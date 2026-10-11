// Owner: Mahendra | Upload sniffing, confirm-field validation and list filters
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, test } from 'node:test';
import { JPEG_BYTES, PNG_BYTES, sha256Hex, tinyPdf } from './documentHelpers.js';
import { prepareTestEnv } from './helpers.js';

// Every server test points server code at a temp DB + storage BEFORE importing it (CLAUDE.md).
const { tempDir } = prepareTestEnv();
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
const {
  MAX_UPLOAD_BYTES,
  hashUpload,
  parseListFilters,
  sanitizeFileName,
  validateConfirmFields,
  validateUpload,
} = await import('../src/services/documentRules.js');

const code = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return 'NO_ERROR';
};

test('accepts PDF, PNG, JPG and UTF-8 TXT by content, and returns the sniffed mime', () => {
  assert.equal(validateUpload({ buffer: tinyPdf(), originalName: 'a.pdf' }).mime, 'application/pdf');
  assert.equal(validateUpload({ buffer: PNG_BYTES, originalName: 'scan.PNG' }).mime, 'image/png');
  assert.equal(validateUpload({ buffer: JPEG_BYTES, originalName: 'scan.jpeg' }).mime, 'image/jpeg');
  assert.equal(validateUpload({ buffer: Buffer.from('नमस्ते\r\n'), originalName: 'n.txt' }).mime, 'text/plain');
});

test('rejects missing, empty, oversized, unsupported and mismatched files', () => {
  assert.equal(code(() => validateUpload({})), 'NO_FILE');
  assert.equal(code(() => validateUpload({ buffer: Buffer.alloc(0), originalName: 'a.pdf' })), 'EMPTY_FILE');
  assert.equal(
    code(() => validateUpload({ buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1), originalName: 'a.pdf' })),
    'FILE_TOO_LARGE',
  );
  assert.equal(code(() => validateUpload({ buffer: tinyPdf(), originalName: 'a.docx' })), 'UNSUPPORTED_TYPE');
  assert.equal(code(() => validateUpload({ buffer: PNG_BYTES, originalName: 'fake.pdf' })), 'UNSUPPORTED_TYPE');
});

test('.txt: binary (renamed file, NUL bytes) is UNSUPPORTED_TYPE; non-UTF-8 text is INVALID_TEXT_ENCODING', () => {
  const err = (buffer) => {
    try {
      validateUpload({ buffer, originalName: 'notes.txt' });
    } catch (e) {
      return [e.code, e.status];
    }
    return ['NO_ERROR'];
  };
  assert.deepEqual(err(tinyPdf()), ['UNSUPPORTED_TYPE', 415], 'a PDF renamed to .txt');
  assert.deepEqual(err(Buffer.from('abc\u0000def')), ['UNSUPPORTED_TYPE', 415], 'NUL bytes');
  assert.deepEqual(err(Buffer.from([0x52, 0xe9, 0x73, 0x75, 0x6d, 0xe9])), ['INVALID_TEXT_ENCODING', 415], 'Windows-1252 "Résumé"');
  assert.deepEqual(err(Buffer.from([0xff, 0xfe, 0x41])), ['INVALID_TEXT_ENCODING', 415], 'stray UTF-16 BOM bytes');
});

test('hashUpload uses core: raw bytes for PDF, text-v1 for .txt', () => {
  const pdf = tinyPdf();
  assert.deepEqual(hashUpload(pdf, { fileName: 'a.pdf', mime: 'application/pdf' }), {
    fileHash: sha256Hex(pdf),
    normalization: 'none',
  });
  const txt = hashUpload(Buffer.from('\uFEFFLine one  \r\nLine two\r\n\r\n'), { fileName: 'a.txt', mime: 'text/plain' });
  assert.equal(txt.normalization, 'text-v1');
  assert.equal(txt.fileHash, sha256Hex(Buffer.from('Line one\nLine two')), 'BOM, CRLF, trailing blanks and final newlines removed');

  assert.equal(code(() => hashUpload(Buffer.from([0xc3, 0x28]), { fileName: 'a.txt', mime: 'text/plain' })), 'INVALID_TEXT_ENCODING', "core's error code is passed through");
});

test('file names lose directories and control chars; latin1-mangled UTF-8 is recovered', () => {
  assert.equal(sanitizeFileName('C:\\Users\\x\\..\\slip.pdf'), 'slip.pdf');
  assert.equal(sanitizeFileName('../../etc/passwd.txt'), 'passwd.txt');
  assert.equal(sanitizeFileName('a\u0000b\nc.pdf'), 'abc.pdf');
  const mangled = Buffer.from('पत्र.pdf', 'utf8').toString('latin1');
  assert.equal(sanitizeFileName(mangled), 'पत्र.pdf');
  assert.equal(sanitizeFileName(''), 'document');
});

test('confirm fields: core validateRecord rules + future-date check, issuer normalised', () => {
  const today = '2026-10-11';
  const stored = { recordId: 'REC-000001', fileHash: '0x' + 'a'.repeat(64) };
  const check = (body) => validateConfirmFields(stored, body, { today });

  const ok = check({
    docType: 'SALARY_SLIP',
    issuer: '  Acme \t Pvt   Ltd ',
    date: '2026-10-11',
    fields: { netPay: '30,000', payPeriod: 'Sept 2026', employeeName: 'Riya Sharma' },
  });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.record, { ...stored, docType: 'SALARY_SLIP', issuer: 'Acme Pvt Ltd', date: '2026-10-11' });
  assert.deepEqual(ok.fields, [
    { name: 'employeeName', value: 'RIYA SHARMA' },
    { name: 'payPeriod', value: '2026-09' },
    { name: 'netPay', value: '3000000' },
  ]);

  const bad = check({ docType: 'PASSPORT', issuer: '   ', date: '2026-10-12' });
  assert.equal(bad.record, null);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['date', 'docType', 'issuer']);
  assert.match(bad.errors.date, /future/);

  assert.ok(check({ docType: 'OTHER', issuer: 'X', date: '2026-02-30' }).errors.date);
  assert.ok(check({ docType: 'OTHER', issuer: 'X', date: '14/06/2026' }).errors.date);
  assert.match(check({ docType: 'OTHER', issuer: 'x'.repeat(121), date: '2026-01-01' }).errors.issuer, /120/);
  assert.ok(check(null).errors.docType);
  assert.ok(check({ docType: 'OTHER', issuer: 42, date: '2026-01-01' }).errors.issuer);

  // Document fields: keyed "fields.<name>"; only checked once the docType is valid
  const slip = { docType: 'SALARY_SLIP', issuer: 'Acme', date: '2026-01-01' };
  assert.deepEqual(Object.keys(check(slip).errors).sort(), ['fields.employeeName', 'fields.netPay', 'fields.payPeriod']);
  assert.deepEqual(check({ ...slip, fields: ['30,000'] }).errors, { fields: 'must be an object of field values' });
  assert.match(check({ ...slip, docType: 'OTHER', fields: { netPay: '1' } }).errors['fields.netPay'], /not a field of OTHER/);
  assert.deepEqual(Object.keys(check({ ...slip, docType: 'PASSPORT', fields: { x: 1 } }).errors), ['docType']);
  assert.deepEqual(check({ ...slip, docType: 'OTHER' }).fields, []);
});

test('list filters are validated; unknown keys ignored; recordId supported', () => {
  assert.deepEqual(parseListFilters({ status: 'pending', issuer: ' acme ', foo: 'bar' }), { status: 'pending', issuer: 'acme' });
  assert.deepEqual(parseListFilters({ recordId: 'REC-000001', batchId: 'BATCH-0002' }), {
    recordId: 'REC-000001',
    batchId: 'BATCH-0002',
  });
  assert.equal(code(() => parseListFilters({ status: 'deleted' })), 'VALIDATION');
  assert.equal(code(() => parseListFilters({ docType: ['A', 'B'] })), 'VALIDATION');
  assert.equal(code(() => parseListFilters({ batchId: 'B-1' })), 'VALIDATION');
});
