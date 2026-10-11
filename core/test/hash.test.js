// Owner: Archit | Tests for hash.js: file hash, text-v1, record validation, leaf and node hashes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_NORMALIZATION,
  detectNormalization,
  fileHash,
  leafHash,
  nodeHash,
  normalizeTextFile,
  validateRecord,
} from '../src/index.js';
import { refCanonical, refLeaf, refNode, sha256 } from './reference.js';
import { toText, utf8 } from './fixtures.js';

const TEXT_V1 = { normalization: FILE_NORMALIZATION.TEXT_V1 };
const RECORD = Object.freeze({
  recordId: 'REC-000002',
  fileHash: sha256(utf8('degree certificate bytes')),
  docType: 'DEGREE_CERTIFICATE',
  issuer: 'Pimpri Institute of Technology',
  date: '2026-06-14',
});
const normalized = (text) => toText(normalizeTextFile(utf8(text)));

test('fileHash("abc") is the SHA-256 test vector, for Uint8Array and Buffer', () => {
  const expected = '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(fileHash(utf8('abc')), expected);
  assert.equal(fileHash(Buffer.from('abc')), expected);
});

test('fileHash "none" hashes the raw bytes (matches node:crypto)', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.equal(fileHash(bytes), sha256(bytes));
  assert.equal(fileHash(bytes, { normalization: 'none' }), sha256(bytes));
  // "none" does not care about encoding or line endings
  assert.notEqual(fileHash(utf8('a\r\n')), fileHash(utf8('a\n')));
});

test('text-v1: "a \\r\\nb\\t\\r\\n\\r\\n" and "a\\nb" hash the same (matches node:crypto)', () => {
  assert.equal(fileHash(utf8('a \r\nb\t\r\n\r\n'), TEXT_V1), fileHash(utf8('a\nb'), TEXT_V1));
  assert.equal(fileHash(utf8('a \r\nb\t\r\n\r\n'), TEXT_V1), sha256(utf8('a\nb')));
});

test('text-v1: lone CR is a line break; leading, inner and blank-line content is kept', () => {
  assert.equal(normalized('a\rb\r'), 'a\nb');
  assert.equal(normalized('a\r\r\nb'), 'a\n\nb');
  assert.equal(normalized('  a  \t b \t'), '  a  \t b');
  assert.equal(normalized('a\n\n\nb\n\n'), 'a\n\n\nb');
  assert.equal(normalized(' \n\t\r\n'), '');
});

test('text-v1: one leading BOM is ignored; a BOM elsewhere is content', () => {
  assert.equal(fileHash(utf8('\ufeffhello\n'), TEXT_V1), fileHash(utf8('hello'), TEXT_V1));
  assert.equal(normalized('a\ufeffb'), 'a\ufeffb');
});

test('text-v1: "e\\u0301" (decomposed) equals "\\u00e9" (NFC)', () => {
  assert.equal(fileHash(utf8('cafe\u0301'), TEXT_V1), fileHash(utf8('caf\u00e9'), TEXT_V1));
  assert.equal(fileHash(utf8('caf\u00e9'), TEXT_V1), sha256(Buffer.from('caf\u00e9', 'utf8')));
  // Without text-v1 the two encodings are different files
  assert.notEqual(fileHash(utf8('cafe\u0301')), fileHash(utf8('caf\u00e9')));
});

test('text-v1: invalid UTF-8 throws INVALID_TEXT_ENCODING', () => {
  const invalid = [
    [0x61, 0xff, 0x62], // 0xff never appears in UTF-8
    [0xc3], // truncated 2-byte sequence
    [0xed, 0xa0, 0x80], // encoded surrogate
    [0xc0, 0xaf], // overlong "/"
  ];
  for (const bytes of invalid) {
    assert.throws(() => fileHash(Uint8Array.from(bytes), TEXT_V1), {
      code: 'INVALID_TEXT_ENCODING',
    });
  }
  assert.doesNotThrow(() => fileHash(Uint8Array.from([0xff]))); // "none" hashes any bytes
});

test('text-v1 is idempotent and linear on pathological whitespace', { timeout: 5000 }, () => {
  const once = normalizeTextFile(utf8('\ufeff x \r\n\t\r\ne\u0301\n\n'));
  assert.deepEqual(normalizeTextFile(once), once);
  // A /[ \t]+$/ or /\n+$/ regex would take minutes on this input
  const nasty = ' '.repeat(200_000) + 'x' + '\n'.repeat(200_000) + 'y';
  assert.equal(normalized(nasty), nasty);
});

test('fileHash rejects non-bytes and unknown normalizations', () => {
  assert.throws(() => fileHash('abc'), TypeError);
  assert.throws(() => fileHash([0x61, 0x62, 0x63]), TypeError);
  assert.throws(() => fileHash(utf8('abc').buffer), TypeError);
  assert.throws(() => fileHash(utf8('abc'), { normalization: 'text-v2' }), TypeError);
  assert.throws(() => normalizeTextFile(undefined), TypeError);
});

test('detectNormalization: .txt name or text/plain MIME -> text-v1, else none', () => {
  const cases = [
    [{ fileName: 'notes.txt' }, 'text-v1'],
    [{ fileName: 'NOTES.TXT', mime: 'application/octet-stream' }, 'text-v1'],
    [{ mime: 'text/plain' }, 'text-v1'],
    [{ fileName: 'upload', mime: 'Text/Plain; charset=utf-8' }, 'text-v1'],
    [{ fileName: 'slip.pdf', mime: 'application/pdf' }, 'none'],
    [{ fileName: 'scan.txt.png', mime: 'image/png' }, 'none'],
    [{ fileName: 'marks.csv', mime: 'text/csv' }, 'none'],
    [{}, 'none'],
    [undefined, 'none'],
    [null, 'none'],
  ];
  for (const [file, expected] of cases) {
    assert.equal(detectNormalization(file), expected, JSON.stringify(file));
  }
});

test('validateRecord accepts a valid record, including edge values', () => {
  assert.deepEqual(validateRecord(RECORD), { ok: true, errors: {} });
  const valid = [
    { issuer: 'x'.repeat(120) },
    { issuer: '\u{1F393}'.repeat(120) }, // 120 code points, 240 UTF-16 units
    { issuer: '  Pimpri   Institute\tof Technology ' }, // checked after normText
    { date: '2024-02-29' },
    { date: '2000-02-29' },
    { date: '2999-12-31' }, // future dates are the server's rule, not core's
    { status: 'pending', v: 1 }, // extra fields are ignored (canonicalJSON drops them)
  ];
  for (const change of valid) {
    assert.equal(validateRecord({ ...RECORD, ...change }).ok, true, JSON.stringify(change));
  }
});

test('validateRecord rejects each bad field with only that field in errors', () => {
  const bad = [
    ['recordId', 'REC-2'],
    ['recordId', 'rec-000002'],
    ['recordId', 'REC-0000002'],
    ['recordId', ' REC-000002'],
    ['fileHash', '0x' + RECORD.fileHash.slice(2).toUpperCase()],
    ['fileHash', RECORD.fileHash.slice(2)],
    ['fileHash', RECORD.fileHash + '00'],
    ['fileHash', [RECORD.fileHash]], // RegExp.test would coerce this array to a valid string
    ['docType', 'PASSPORT'],
    ['docType', 'degree_certificate'],
    ['docType', undefined],
    ['issuer', ''],
    ['issuer', ' \t\n '],
    ['issuer', 'x'.repeat(121)],
    ['issuer', 42],
    ['date', '2026-02-30'],
    ['date', '2025-02-29'],
    ['date', '1900-02-29'],
    ['date', '2026-13-01'],
    ['date', '2026-00-10'],
    ['date', '2026-04-31'],
    ['date', '2026-6-14'],
    ['date', '14/06/2026'],
    ['date', '2026-06-14T00:00:00Z'],
  ];
  for (const [field, value] of bad) {
    const { ok, errors } = validateRecord({ ...RECORD, [field]: value });
    assert.equal(ok, false, `${field} = ${JSON.stringify(value)}`);
    assert.deepEqual(Object.keys(errors), [field], `${field} = ${JSON.stringify(value)}`);
  }
  assert.equal(
    validateRecord({ ...RECORD, date: '2026-02-30' }).errors.date,
    'is not a real calendar date',
  );
  assert.equal(validateRecord({ ...RECORD, issuer: ' ' }).errors.issuer, 'is required');
});

test('validateRecord rejects non-objects without throwing', () => {
  for (const value of [null, undefined, 'REC-000002', 42, []]) {
    assert.deepEqual(validateRecord(value), { ok: false, errors: { record: 'must be an object' } });
  }
});

test('leafHash = SHA-256(0x00 || canonicalJSON(record)) (matches node:crypto)', () => {
  assert.equal(leafHash(RECORD), refLeaf(RECORD));
  assert.equal(leafHash(RECORD), sha256(Buffer.from([0]), Buffer.from(refCanonical(RECORD))));
  // Without the 0x00 prefix it would be a different value
  assert.notEqual(leafHash(RECORD), sha256(Buffer.from(refCanonical(RECORD))));
});

test('leafHash normalises the issuer, so cosmetic whitespace cannot change a leaf', () => {
  assert.equal(
    leafHash({ ...RECORD, issuer: '  Pimpri   Institute\tof Technology ' }),
    leafHash(RECORD),
  );
  assert.notEqual(
    leafHash({ ...RECORD, issuer: 'Pimpri Institute of Technology.' }),
    leafHash(RECORD),
  );
});

test('leafHash throws INVALID_RECORD with the field errors', () => {
  assert.throws(
    () => leafHash({ ...RECORD, date: '2026-02-30', docType: 'PASSPORT' }),
    (error) =>
      error.code === 'INVALID_RECORD' &&
      error.errors.date === 'is not a real calendar date' &&
      error.errors.docType !== undefined,
  );
  assert.throws(() => leafHash(null), { code: 'INVALID_RECORD' });
});

test('nodeHash = SHA-256(0x01 || left || right) over raw 32-byte values (matches node:crypto)', () => {
  const a = sha256(utf8('a'));
  const b = sha256(utf8('b'));
  assert.equal(nodeHash(a, b), refNode(a, b));
  assert.notEqual(nodeHash(a, b), nodeHash(b, a));
  // Hashing the hex text instead of the bytes would give a different value
  assert.notEqual(nodeHash(a, b), sha256(Buffer.from([1]), Buffer.from(a + b)));
  // Input case does not matter (same bytes); output is lowercase
  assert.equal(nodeHash('0x' + a.slice(2).toUpperCase(), b), nodeHash(a, b));
});

test('nodeHash rejects anything that is not a 32-byte hash', () => {
  const a = sha256(utf8('a'));
  for (const bad of ['0x1234', a.slice(2), a + '00', undefined, null, 7]) {
    assert.throws(() => nodeHash(bad, a), TypeError);
    assert.throws(() => nodeHash(a, bad), TypeError);
  }
});
