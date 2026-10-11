// Owner: Archit | SHA-256 helpers: hex encoding, file hash, leaf hash, node hash (browser + Node)
import { sha256 } from '@noble/hashes/sha2.js';
import {
  concatBytes,
  bytesToHex as rawBytesToHex,
  hexToBytes as rawHexToBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';
import { canonicalJSON, normText } from './canonical.js';
import {
  DOC_TYPES,
  FILE_NORMALIZATION,
  HEX32,
  ISSUER_MAX_LENGTH,
  RECORD_ID,
  SCHEME,
} from './constants.js';

const LEAF_PREFIX = hexToBytes(SCHEME.leafPrefix);
const NODE_PREFIX = hexToBytes(SCHEME.nodePrefix);
const HASH_HEX_ANY_CASE = /^0x[0-9a-fA-F]{64}$/;
const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Encode bytes as "0x" + lowercase hex.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return '0x' + rawBytesToHex(bytes);
}

/**
 * Decode "0x"-prefixed hex (either case, even length) into bytes.
 * @param {string} hex
 * @returns {Uint8Array}
 * @throws {TypeError} when the input is not 0x-prefixed, even-length hex
 */
export function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) {
    throw new TypeError(`Expected 0x-prefixed even-length hex, got: ${String(hex).slice(0, 20)}`);
  }
  return rawHexToBytes(hex.slice(2));
}

/**
 * SHA-256 of raw bytes.
 * @param {Uint8Array} bytes
 * @returns {string} "0x" + 64 lowercase hex chars
 */
export function sha256Hex(bytes) {
  return bytesToHex(sha256(bytes));
}

/**
 * Normalise a .txt file before hashing ("text-v1"): decode UTF-8 strictly, strip one leading BOM,
 * CRLF and lone CR -> LF, remove spaces/tabs at the end of every line, remove trailing newlines
 * at end of file, Unicode NFC, re-encode UTF-8.
 * @param {Uint8Array} bytes raw file bytes
 * @returns {Uint8Array} normalised bytes
 * @throws {Error} code 'INVALID_TEXT_ENCODING' when the bytes are not valid UTF-8
 */
export function normalizeTextFile(bytes) {
  assertBytes(bytes, 'normalizeTextFile');
  let text;
  try {
    // ignoreBOM keeps a BOM in the output so the strip below is explicit, not a decoder default
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    throw Object.assign(new Error('File is not valid UTF-8 text', { cause }), {
      code: 'INVALID_TEXT_ENCODING',
    });
  }
  if (text.startsWith('\ufeff')) text = text.slice(1);
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(stripTrailingBlanks);
  // Trailing newlines at end of file show up as trailing empty lines after the split
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return utf8ToBytes(lines.join('\n').normalize('NFC'));
}

/**
 * Pick the file normalisation from what the uploader knows about the file, so server and
 * verifier always agree: "text-v1" for a .txt name or text/plain MIME, else "none".
 * @param {{ fileName?: string, mime?: string }} [file]
 * @returns {'none' | 'text-v1'}
 */
export function detectNormalization(file) {
  const { fileName, mime } = file ?? {};
  const isTxtName = typeof fileName === 'string' && fileName.toLowerCase().endsWith('.txt');
  const isTextPlain =
    typeof mime === 'string' && mime.split(';')[0].trim().toLowerCase() === 'text/plain';
  return isTxtName || isTextPlain ? FILE_NORMALIZATION.TEXT_V1 : FILE_NORMALIZATION.NONE;
}

/**
 * fileHash = SHA-256(file bytes), after normalizeTextFile when normalization is "text-v1".
 * @param {Uint8Array} bytes raw file bytes (a Node Buffer is fine)
 * @param {{ normalization?: 'none' | 'text-v1' }} [options] defaults to "none"
 * @returns {string} "0x" + 64 lowercase hex chars
 * @throws {TypeError} on non-bytes input or an unknown normalization
 * @throws {Error} code 'INVALID_TEXT_ENCODING' for "text-v1" input that is not valid UTF-8
 */
export function fileHash(bytes, { normalization = FILE_NORMALIZATION.NONE } = {}) {
  assertBytes(bytes, 'fileHash');
  if (normalization === FILE_NORMALIZATION.NONE) return sha256Hex(bytes);
  if (normalization === FILE_NORMALIZATION.TEXT_V1) return sha256Hex(normalizeTextFile(bytes));
  throw new TypeError(
    `fileHash: normalization must be "none" or "text-v1", got ${String(normalization)}`,
  );
}

/**
 * Check a record against the locked field rules. Does NOT reject future dates: that is the
 * server's rule at confirm time, so that verification never depends on today's date.
 * A record with a fieldsRoot (any value but undefined) is v2 and needs it to be a 32-byte hash.
 * @param {{ recordId: string, fileHash: string, fieldsRoot?: string, docType: string, issuer: string, date: string }} record
 * @returns {{ ok: boolean, errors: Object<string, string> }} errors maps field -> message
 */
export function validateRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: { record: 'must be an object' } };
  }
  const errors = {};
  if (!matches(RECORD_ID, record.recordId)) errors.recordId = 'must be REC- followed by 6 digits';
  if (!matches(HEX32, record.fileHash)) {
    errors.fileHash = 'must be 0x followed by 64 lowercase hex characters';
  }
  if (record.fieldsRoot !== undefined && !matches(HEX32, record.fieldsRoot)) {
    errors.fieldsRoot = 'must be 0x followed by 64 lowercase hex characters';
  }
  if (!DOC_TYPES.includes(record.docType))
    errors.docType = `must be one of ${DOC_TYPES.join(', ')}`;
  const issuerProblem = checkIssuer(record.issuer);
  if (issuerProblem) errors.issuer = issuerProblem;
  const dateProblem = checkDate(record.date);
  if (dateProblem) errors.date = dateProblem;
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * leaf = SHA-256(0x00 ‖ utf8(canonicalJSON(record))). v2 when the record has a fieldsRoot.
 * @param {{ recordId: string, fileHash: string, fieldsRoot?: string, docType: string, issuer: string, date: string }} record
 * @returns {string} "0x" + 64 lowercase hex chars
 * @throws {Error} code 'INVALID_RECORD' with `errors` from validateRecord
 */
export function leafHash(record) {
  const { ok, errors } = validateRecord(record);
  if (!ok) {
    const summary = Object.entries(errors).map(([field, message]) => `${field} ${message}`);
    throw Object.assign(new Error(`Invalid record: ${summary.join('; ')}`), {
      code: 'INVALID_RECORD',
      errors,
    });
  }
  return sha256Hex(concatBytes(LEAF_PREFIX, utf8ToBytes(canonicalJSON(record))));
}

/**
 * node = SHA-256(0x01 ‖ leftBytes ‖ rightBytes), hashing the raw 32 bytes of each child, not hex text.
 * @param {string} leftHex 0x-prefixed 32-byte hash (either case)
 * @param {string} rightHex 0x-prefixed 32-byte hash (either case)
 * @returns {string} "0x" + 64 lowercase hex chars
 * @throws {TypeError} when a child is not a 32-byte hex hash
 */
export function nodeHash(leftHex, rightHex) {
  return sha256Hex(
    concatBytes(NODE_PREFIX, childBytes(leftHex, 'left'), childBytes(rightHex, 'right')),
  );
}

function childBytes(hex, side) {
  if (typeof hex !== 'string' || !HASH_HEX_ANY_CASE.test(hex)) {
    throw new TypeError(`nodeHash: ${side} child must be 0x + 64 hex characters`);
  }
  return hexToBytes(hex);
}

function assertBytes(bytes, caller) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${caller}: expected a Uint8Array`);
}

// A loop, not /[ \t]+$/: that regex is quadratic on long runs of blanks inside a line (ReDoS)
function stripTrailingBlanks(line) {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
  return line.slice(0, end);
}

// RegExp.test coerces non-strings (['0xab..'] would pass), so check the type first
function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function checkIssuer(issuer) {
  if (typeof issuer !== 'string' || normText(issuer) === '') return 'is required';
  if ([...normText(issuer)].length > ISSUER_MAX_LENGTH) {
    return `must be at most ${ISSUER_MAX_LENGTH} characters`;
  }
  return null;
}

function checkDate(date) {
  const parts = typeof date === 'string' ? DATE_FORMAT.exec(date) : null;
  if (!parts) return 'must be YYYY-MM-DD';
  const [year, month, day] = parts.slice(1).map(Number);
  return day >= 1 && month >= 1 && month <= 12 && day <= daysInMonth(year, month)
    ? null
    : 'is not a real calendar date';
}

function daysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
