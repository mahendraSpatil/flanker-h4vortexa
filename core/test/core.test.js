// Owner: Archit | Unit tests for @proofchain/core (todos mark functions still to implement)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_TYPES,
  HEX32,
  RESULT,
  bytesToHex,
  canonicalJSON,
  hexToBytes,
  normText,
  sha256Hex,
} from '../src/index.js';

const FILE_HASH = '0x' + '9b2c'.repeat(16);
const RECORD = {
  recordId: 'REC-000002',
  fileHash: FILE_HASH,
  docType: 'DEGREE_CERTIFICATE',
  issuer: 'Pimpri Institute of Technology',
  date: '2026-06-14',
};
const utf8 = (s) => new TextEncoder().encode(s);

test('canonicalJSON sorts keys A-Z with no whitespace', () => {
  assert.equal(
    canonicalJSON(RECORD),
    `{"date":"2026-06-14","docType":"DEGREE_CERTIFICATE","fileHash":"${FILE_HASH}",` +
      '"issuer":"Pimpri Institute of Technology","recordId":"REC-000002","v":1}',
  );
});

test('canonicalJSON is independent of input key order and drops extra fields', () => {
  const shuffled = {
    status: 'pending',
    date: RECORD.date,
    issuer: RECORD.issuer,
    recordId: RECORD.recordId,
    docType: RECORD.docType,
    fileHash: RECORD.fileHash,
  };
  assert.equal(canonicalJSON(shuffled), canonicalJSON(RECORD));
});

test('canonicalJSON normalises issuer and lowercases fileHash', () => {
  const messy = {
    ...RECORD,
    issuer: '  Pimpri   Institute\tof\nTechnology ',
    fileHash: FILE_HASH.toUpperCase().replace('0X', '0x'),
  };
  assert.equal(canonicalJSON(messy), canonicalJSON(RECORD));
});

test('canonicalJSON always writes scheme version v:1', () => {
  assert.match(canonicalJSON({ ...RECORD, v: 2 }), /"v":1}$/);
});

test('normText trims, collapses inner whitespace and applies NFC', () => {
  assert.equal(normText('  a \t b\n\nc  '), 'a b c');
  assert.equal(normText('Café'), 'Café');
});

test('sha256Hex matches the NIST test vectors', () => {
  assert.equal(
    sha256Hex(utf8('')),
    '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex(utf8('abc')),
    '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.match(sha256Hex(utf8('abc')), HEX32);
});

test('bytesToHex and hexToBytes round-trip with a lowercase 0x prefix', () => {
  const bytes = new Uint8Array([0x00, 0x01, 0xab, 0xff]);
  assert.equal(bytesToHex(bytes), '0x0001abff');
  assert.deepEqual(hexToBytes('0x0001ABff'), bytes);
  assert.throws(() => hexToBytes('0001abff'), TypeError);
  assert.throws(() => hexToBytes('0xabc'), TypeError);
});

test('locked enums match CLAUDE.md', () => {
  assert.equal(DOC_TYPES.length, 6);
  assert.equal(Object.keys(RESULT).length, 8);
});

test.todo('normalizeTextFile: CRLF -> LF, trailing spaces stripped, NFC');
test.todo('fileHash: "none" hashes raw bytes; "text-v1" hashes normalised text');
test.todo('leafHash = SHA-256(0x00 || canonicalJSON(record))');
test.todo('nodeHash hashes raw 32-byte children with the 0x01 prefix');
test.todo('buildTree: 1, 2, 3, 4, 5 and 7 leaves; odd node promoted, not duplicated');
test.todo('getProof + foldProof: every proof folds back to the root');
test.todo('expectedPathLength matches getProof length for every leaf');
test.todo('buildProof produces the proof.json shape from CLAUDE.md');
test.todo('verify: genuine document is VALID');
test.todo('verify: one flipped byte fails at the right check for each result code');
