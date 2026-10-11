// Owner: Archit | SHA-256 helpers: hex encoding, file hash, leaf hash, node hash (browser + Node)
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex as rawBytesToHex, hexToBytes as rawHexToBytes } from '@noble/hashes/utils.js';

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
 * Normalise a .txt file before hashing ("text-v1"): decode UTF-8, CRLF -> LF,
 * strip trailing spaces on every line, Unicode NFC, re-encode UTF-8.
 * @param {Uint8Array} bytes raw file bytes
 * @returns {Uint8Array} normalised bytes
 */
export function normalizeTextFile(bytes) {
  throw new Error('NOT_IMPLEMENTED: normalizeTextFile');
}

/**
 * fileHash = SHA-256(file bytes), after normalizeTextFile when normalization is "text-v1".
 * @param {Uint8Array} bytes raw file bytes
 * @param {{ normalization?: 'none' | 'text-v1' }} [options] defaults to "none"
 * @returns {string} "0x" + 64 lowercase hex chars
 */
export function fileHash(bytes, { normalization = 'none' } = {}) {
  throw new Error('NOT_IMPLEMENTED: fileHash');
}

/**
 * leaf = SHA-256(0x00 ‖ utf8(canonicalJSON(record))).
 * @param {{ recordId: string, fileHash: string, docType: string, issuer: string, date: string }} record
 * @returns {string} "0x" + 64 lowercase hex chars
 */
export function leafHash(record) {
  throw new Error('NOT_IMPLEMENTED: leafHash');
}

/**
 * node = SHA-256(0x01 ‖ leftBytes ‖ rightBytes), hashing the raw 32 bytes of each child, not hex text.
 * @param {string} leftHex 0x-prefixed 32-byte hash
 * @param {string} rightHex 0x-prefixed 32-byte hash
 * @returns {string} "0x" + 64 lowercase hex chars
 */
export function nodeHash(leftHex, rightHex) {
  throw new Error('NOT_IMPLEMENTED: nodeHash');
}
