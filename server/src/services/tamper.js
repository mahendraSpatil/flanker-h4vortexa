// Owner: Archit | DEMO ONLY: simulate an insider editing stored data, and undo it
//
// These functions deliberately corrupt the registry's own DB and storage so the demo can show the
// audit and the verifier catching it. The chain is never touched (it cannot be rewritten anyway).
// Synchronous fs on purpose: a read-modify-write of a file must not interleave with another request.
import fs from 'node:fs';
import { ISSUER_MAX_LENGTH, fieldDefinition, normText } from '@proofchain/core';
import { db } from '../db/index.js';
import { logAction } from '../lib/auditLog.js';
import { AppError } from '../lib/errors.js';
import { storedFilePath } from './integrity.js';

export const TAMPER_TYPES = Object.freeze(['db_metadata', 'stored_file', 'restore']);

const TAMPER_MARK = ' (TAMPERED)';
const ISSUER = 'issuer';
/** Added to a tampered amount: ₹30,000 in paise, so the demo slip's ₹50,000 becomes ₹80,000. */
const AMOUNT_BUMP_PAISE = 3_000_000n;

const selectRecord = db.prepare('SELECT * FROM records WHERE record_id = ?');
const updateIssuer = db.prepare('UPDATE records SET issuer = ? WHERE record_id = ?');
const selectField = db.prepare('SELECT value FROM record_fields WHERE record_id = ? AND name = ?');
const updateField = db.prepare(
  'UPDATE record_fields SET value = ? WHERE record_id = ? AND name = ?',
);
const selectTamperHistory = db.prepare(
  `SELECT id, action, detail FROM audit_log
   WHERE target = ? AND action IN ('TAMPER', 'RESTORE') AND outcome = 'OK' ORDER BY id`,
);

/**
 * Apply one demo tamper (or undo the latest one) to a record. Logs TAMPER or RESTORE; the log
 * detail holds everything needed to undo it.
 * @param {{ type: string, recordId: string, field?: string, actor: string }} args type is one of
 *   TAMPER_TYPES; field (db_metadata only) is "issuer" (default) or one of the record's document
 *   fields, e.g. "netPay"
 * @returns {object} detail of what changed (same object as the audit log detail)
 * @throws {AppError} VALIDATION (400), NOT_FOUND (404), NOTHING_TO_RESTORE (409)
 */
export function tamper({ type, recordId, field = ISSUER, actor }) {
  const errors = {};
  if (!TAMPER_TYPES.includes(type)) errors.type = `must be one of ${TAMPER_TYPES.join(', ')}`;
  if (typeof recordId !== 'string' || recordId === '') errors.recordId = 'is required';
  if (typeof field !== 'string' || field === '') errors.field = 'must be a field name';
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION', 400, 'Invalid tamper request', errors);
  }
  const row = selectRecord.get(recordId);
  if (!row) throw new AppError('NOT_FOUND', 404, `No record ${recordId}`);

  if (type === 'db_metadata') {
    return field === ISSUER ? tamperIssuer(row, actor) : tamperField(row, field, actor);
  }
  if (type === 'stored_file') return tamperFile(row, actor);
  return restoreLatest(row, actor);
}

// Insider edit: change the confirmed issuer in the DB, leaving the stored leaf as it was
const tamperIssuer = db.transaction((row, actor) => {
  if (row.issuer === null) {
    throw new AppError('VALIDATION', 400, `${row.record_id} has no confirmed issuer to edit yet`, {
      recordId: `is ${row.status}; confirm it first`,
    });
  }
  const original = row.issuer;
  const base = normText(original).slice(0, ISSUER_MAX_LENGTH - TAMPER_MARK.length);
  const tampered = base + TAMPER_MARK;
  updateIssuer.run(tampered, row.record_id);
  return logged(actor, 'TAMPER', row, {
    type: 'db_metadata',
    recordId: row.record_id,
    field: ISSUER,
    original,
    tampered,
  });
});

// Insider edit: change one confirmed document field (e.g. netPay) in the DB, leaving the leaf as it was
const tamperField = db.transaction((row, name, actor) => {
  const stored = selectField.get(row.record_id, name);
  if (!stored) {
    throw new AppError('VALIDATION', 400, `${row.record_id} has no confirmed field ${name}`, {
      field: `is not a confirmed field of ${row.record_id}`,
    });
  }
  const tampered = tamperedValue(fieldDefinition(name)?.kind, stored.value);
  updateField.run(tampered, row.record_id, name);
  return logged(actor, 'TAMPER', row, {
    type: 'db_metadata',
    recordId: row.record_id,
    field: name,
    original: stored.value,
    tampered,
  });
});

// A different value that still looks valid, so only the hashes can tell
function tamperedValue(kind, value) {
  if (kind === 'amount') return (BigInt(value) + AMOUNT_BUMP_PAISE).toString();
  if (kind === 'month') {
    const [year, month] = value.split('-').map(Number);
    return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  if (kind === 'id') return `${value}-X`;
  return value + TAMPER_MARK;
}

// Flip every bit of one byte near the middle of the stored file
function tamperFile(row, actor) {
  const { filePath, bytes } = readStoredFile(row);
  if (bytes.length === 0) {
    throw new AppError('VALIDATION', 400, `The stored file of ${row.record_id} is empty`);
  }
  const offset = Math.floor(bytes.length / 2);
  const originalByte = bytes[offset];
  const tamperedByte = originalByte ^ 0xff;
  bytes[offset] = tamperedByte;
  fs.writeFileSync(filePath, bytes);
  return logged(actor, 'TAMPER', row, {
    type: 'stored_file',
    recordId: row.record_id,
    fileHash: row.file_hash,
    offset,
    originalByte,
    tamperedByte,
  });
}

// Undo the most recent TAMPER on this record that no RESTORE has undone yet
function restoreLatest(row, actor) {
  const history = selectTamperHistory.all(row.record_id).map((entry) => ({
    ...entry,
    detail: JSON.parse(entry.detail),
  }));
  const restored = new Set(
    history.filter((entry) => entry.action === 'RESTORE').map((entry) => entry.detail.restores),
  );
  const latest = history.findLast((entry) => entry.action === 'TAMPER' && !restored.has(entry.id));
  if (!latest) {
    throw new AppError('NOTHING_TO_RESTORE', 409, `${row.record_id} has no tamper left to undo`);
  }

  const undone = latest.detail;
  const detail = {
    type: 'restore',
    recordId: row.record_id,
    restores: latest.id,
    undid: undone.type,
  };
  if (undone.type === 'db_metadata') {
    return undone.field === ISSUER
      ? restoreIssuer(row, undone, detail, actor)
      : restoreField(row, undone, detail, actor);
  }
  const { filePath, bytes } = readStoredFile(row);
  bytes[undone.offset] = undone.originalByte;
  fs.writeFileSync(filePath, bytes);
  return logged(actor, 'RESTORE', row, { ...detail, offset: undone.offset });
}

const restoreIssuer = db.transaction((row, undone, detail, actor) => {
  updateIssuer.run(undone.original, row.record_id);
  return logged(actor, 'RESTORE', row, { ...detail, issuer: undone.original });
});

const restoreField = db.transaction((row, undone, detail, actor) => {
  updateField.run(undone.original, row.record_id, undone.field);
  return logged(actor, 'RESTORE', row, { ...detail, field: undone.field, value: undone.original });
});

function readStoredFile(row) {
  const filePath = storedFilePath(row.file_hash);
  try {
    return { filePath, bytes: fs.readFileSync(filePath) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    throw new AppError('NOT_FOUND', 404, `The stored file of ${row.record_id} is missing`);
  }
}

function logged(actor, action, row, detail) {
  logAction({ actor, action, target: row.record_id, outcome: 'OK', detail });
  return detail;
}
