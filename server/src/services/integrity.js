// Owner: Archit | Rebuild leaves, trees and file hashes from what the registry stored (DB rows, files)
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  HEX32,
  buildFieldTree,
  buildTree,
  detectNormalization,
  fileHash,
  leafHash,
  validateFields,
} from '@proofchain/core';
import { config } from '../config.js';
import { db } from '../db/index.js';

const selectFields = db.prepare(
  'SELECT name, value, salt FROM record_fields WHERE record_id = ? ORDER BY idx',
);

/**
 * A record's stored, salted fields in field-tree order (the leaves of its fieldsRoot).
 * @param {string} recordId
 * @returns {Array<{ name: string, value: string, salt: string }>} [] for a docType without fields
 */
export function storedFields(recordId) {
  return selectFields.all(recordId);
}

/**
 * The confirmed record for a records row, without fieldsRoot (core builds that from the fields).
 * @param {object} row records row
 * @returns {{ recordId: string, fileHash: string, docType: string, issuer: string, date: string }}
 */
export function toCoreRecord(row) {
  return {
    recordId: row.record_id,
    fileHash: row.file_hash,
    docType: row.doc_type,
    issuer: row.issuer,
    date: row.doc_date,
  };
}

/**
 * v2 leaf rebuilt from a row's stored fields and its record_fields rows (never from its stored
 * `leaf` column): fieldsRoot from the salted fields, then the leaf over the record with it.
 * @param {object} row records row
 * @returns {{ leaf: string|null, problem: string|null }} leaf is null when the stored data is no
 *   longer a valid record (e.g. the issuer was emptied, a field value is malformed); problem says why
 */
export function rebuildLeaf(row) {
  const fields = storedFields(row.record_id);
  const check = validateFields(row.doc_type, fields);
  if (!check.ok) {
    const summary = Object.entries(check.errors).map(([path, message]) => `${path} ${message}`);
    return { leaf: null, problem: `Invalid stored fields: ${summary.join('; ')}` };
  }
  try {
    const fieldsRoot = buildFieldTree(fields).root;
    return { leaf: leafHash({ ...toCoreRecord(row), fieldsRoot }), problem: null };
  } catch (err) {
    if (err.code === 'INVALID_RECORD') return { leaf: null, problem: err.message };
    throw err;
  }
}

/**
 * Parse batches.tree_json back into levels, checking it is exactly the tree of its own leaves.
 * @param {string} treeJson
 * @returns {string[][] | null} levels bottom to top, or null when unreadable or inconsistent
 */
export function parseTree(treeJson) {
  let levels;
  try {
    levels = JSON.parse(treeJson);
    if (!Array.isArray(levels)) return null;
    const rebuilt = buildTree(levels[0]).levels;
    return JSON.stringify(rebuilt) === JSON.stringify(levels) ? levels : null;
  } catch {
    return null;
  }
}

/**
 * Where a file is stored: server/storage/<fileHash> (config.storageDir).
 * @param {string} hash "0x" + 64 lowercase hex
 * @returns {string} absolute path
 * @throws {TypeError} when hash is not a 32-byte hex hash (never build a path from anything else)
 */
export function storedFilePath(hash) {
  if (typeof hash !== 'string' || !HEX32.test(hash)) {
    throw new TypeError(`storedFilePath: not a file hash: ${String(hash).slice(0, 20)}`);
  }
  return path.join(config.storageDir, hash);
}

/** The fileNormalization a row was hashed with at upload ("text-v1" for .txt / text/plain). */
export function normalizationOf(row) {
  return detectNormalization({ fileName: row.file_name, mime: row.mime });
}

/**
 * Recompute the fileHash of a row's stored file.
 * @param {object} row records row
 * @returns {Promise<{ fileHash: string|null, problem: string|null }>} fileHash is null when the
 *   file is missing or cannot be hashed (e.g. a .txt that is no longer valid UTF-8)
 */
export async function hashStoredFile(row) {
  let bytes;
  try {
    bytes = await fs.readFile(storedFilePath(row.file_hash));
  } catch (err) {
    if (err.code === 'ENOENT') return { fileHash: null, problem: 'stored file is missing' };
    if (err instanceof TypeError) return { fileHash: null, problem: err.message };
    throw err;
  }
  try {
    return { fileHash: fileHash(bytes, { normalization: normalizationOf(row) }), problem: null };
  } catch (err) {
    if (err.code === 'INVALID_TEXT_ENCODING') return { fileHash: null, problem: err.message };
    throw err;
  }
}
