// Owner: Archit | DEMO ONLY: simulate an insider editing stored data, and undo it
//
// These functions deliberately corrupt the registry's own DB and storage so the demo can show the
// audit and the verifier catching it. The chain is never touched (it cannot be rewritten anyway).
// Synchronous fs on purpose: a read-modify-write of a file must not interleave with another request.
import fs from 'node:fs';
import { ISSUER_MAX_LENGTH, normText } from '@proofchain/core';
import { db } from '../db/index.js';
import { logAction } from '../lib/auditLog.js';
import { AppError } from '../lib/errors.js';
import { storedFilePath } from './integrity.js';

export const TAMPER_TYPES = Object.freeze(['db_metadata', 'stored_file', 'restore']);

const TAMPER_MARK = ' (TAMPERED)';

const selectRecord = db.prepare('SELECT * FROM records WHERE record_id = ?');
const updateIssuer = db.prepare('UPDATE records SET issuer = ? WHERE record_id = ?');
const selectTamperHistory = db.prepare(
  `SELECT id, action, detail FROM audit_log
   WHERE target = ? AND action IN ('TAMPER', 'RESTORE') AND outcome = 'OK' ORDER BY id`,
);

/**
 * Apply one demo tamper (or undo the latest one) to a record. Logs TAMPER or RESTORE; the log
 * detail holds everything needed to undo it.
 * @param {{ type: string, recordId: string, actor: string }} args type is one of TAMPER_TYPES
 * @returns {object} detail of what changed (same object as the audit log detail)
 * @throws {AppError} VALIDATION (400), NOT_FOUND (404), NOTHING_TO_RESTORE (409)
 */
export function tamper({ type, recordId, actor }) {
  const errors = {};
  if (!TAMPER_TYPES.includes(type)) errors.type = `must be one of ${TAMPER_TYPES.join(', ')}`;
  if (typeof recordId !== 'string' || recordId === '') errors.recordId = 'is required';
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION', 400, 'Invalid tamper request', errors);
  }
  const row = selectRecord.get(recordId);
  if (!row) throw new AppError('NOT_FOUND', 404, `No record ${recordId}`);

  if (type === 'db_metadata') return tamperIssuer(row, actor);
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
    field: 'issuer',
    original,
    tampered,
  });
});

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
    return restoreIssuer(row, undone, detail, actor);
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
