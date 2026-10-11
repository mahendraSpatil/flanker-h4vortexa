// Owner: Mahendra | Document workflow over SQLite: upload -> draft, confirm -> pending, list, read file
//
// Dependencies are injected so this runs in tests without server/.env, Express or the real DB file.
// routes/documents.js wires the production ones.
import { AppError } from '../lib/errors.js';
import { RECORD_ID } from '@proofchain/core';
import { emptySuggestions, localIsoDate } from './fallbackMetadata.js';
import { buildLeaf, hashUpload, validateConfirmFields, validateUpload } from './documentRules.js';

const MAX_RECORD_NUMBER = 999_999;

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db schema from server/src/db/schema.sql applied
 * @param {{ saveFile: Function, readFile: Function }} deps.storage see services/storage.js
 * @param {(buffer: Buffer, mime: string) => Promise<{ text: string, method: string }>} deps.extractText
 * @param {(text: string) => Promise<{ suggestions: object, extractionPath: string, diagnostics?: object }>} deps.suggestMetadata
 * @param {(entry: object) => void} deps.logAction see lib/auditLog.js
 * @param {() => Date} [deps.now]
 */
export function createDocumentRegistry({ db, storage, extractText, suggestMetadata, logAction, now = () => new Date() }) {
  const sql = {
    byHash: db.prepare('SELECT record_id, batch_id, status FROM records WHERE file_hash = ?'),
    byId: db.prepare('SELECT * FROM records WHERE record_id = ?'),
    lastNumber: db.prepare(
      "SELECT MAX(CAST(SUBSTR(record_id, 5) AS INTEGER)) AS n FROM records WHERE record_id LIKE 'REC-%'",
    ),
    insertDraft: db.prepare(
      "INSERT INTO records (record_id, file_hash, file_name, mime, status, created_by, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)",
    ),
    saveSuggestions: db.prepare(
      'UPDATE records SET ai_suggestions = ?, extraction_path = ? WHERE record_id = ?',
    ),
    confirm: db.prepare(
      "UPDATE records SET doc_type = ?, issuer = ?, doc_date = ?, leaf = ?, status = 'pending', confirmed_by = ?, confirmed_at = ? WHERE record_id = ? AND status IN ('draft', 'pending')",
    ),
  };

  /** Audit logging must never turn a successful action into an error response. */
  function audit(entry) {
    try {
      logAction(entry);
    } catch (err) {
      console.error('[documents] audit log write failed:', err.message);
    }
  }

  function reject(actor, target, err, detail = {}) {
    audit({ actor, action: 'REJECT', target, outcome: err.code ?? 'ERROR', detail: { ...detail, message: err.message } });
  }

  // ---- upload -----------------------------------------------------------------------------------

  /**
   * POST /api/documents. Hash -> duplicate check -> store -> draft -> extract text -> suggestions.
   * @returns {Promise<object>} { recordId, fileHash, status, suggestions, extractionPath, fileName, mime, textMethod, warnings }
   */
  async function upload({ buffer, originalName, actor }) {
    let file;
    try {
      file = validateUpload({ buffer, originalName });
    } catch (err) {
      reject(actor, null, err, { fileName: originalName ?? null, bytes: buffer?.length ?? 0 });
      throw err;
    }

    // fileHash is computed from the raw bytes (text-v1 normalised for .txt) before anything else.
    let hashed;
    try {
      hashed = hashUpload(buffer, file);
    } catch (err) {
      reject(actor, null, err, { fileName: file.fileName });
      throw err;
    }
    const { fileHash, normalization } = hashed;

    const existing = sql.byHash.get(fileHash);
    if (existing) throw duplicate(actor, existing, fileHash, file.fileName);

    await storage.saveFile(fileHash, buffer); // raw bytes, never the normalised .txt bytes
    const recordId = insertDraft({ fileHash, file, actor });

    const warnings = [];

    // Text and suggestions organise the document only; they never enter a hash.
    const { text, textMethod } = await extractSafely(buffer, file.mime, warnings);
    const { suggestions, extractionPath, diagnostics } = await suggestSafely(text);

    sql.saveSuggestions.run(
      JSON.stringify({ suggestions, extractionPath, textMethod, textChars: text.length, diagnostics, warnings }),
      extractionPath,
      recordId,
    );
    audit({
      actor,
      action: 'UPLOAD',
      target: recordId,
      outcome: 'OK',
      detail: { fileHash, fileName: file.fileName, mime: file.mime, normalization, extractionPath, textMethod },
    });

    return {
      recordId,
      fileHash,
      status: 'draft',
      suggestions,
      extractionPath,
      fileName: file.fileName,
      mime: file.mime,
      textMethod,
      warnings,
    };
  }

  function duplicate(actor, existing, fileHash, fileName) {
    const err = new AppError(
      'DUPLICATE',
      409,
      `This file is already registered as ${existing.record_id}`,
      { recordId: existing.record_id, batchId: existing.batch_id ?? null, status: existing.status },
    );
    reject(actor, existing.record_id, err, { fileHash, fileName });
    return err;
  }

  /** Allocate REC-000001, REC-000002, ... and insert the draft atomically. */
  function insertDraft({ fileHash, file, actor }) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const next = (sql.lastNumber.get()?.n ?? 0) + 1;
      if (next > MAX_RECORD_NUMBER) {
        throw new AppError('REGISTRY_FULL', 507, 'Record IDs are exhausted (REC-999999)');
      }
      const recordId = `REC-${String(next).padStart(6, '0')}`;
      sql.insertDraft.run(recordId, fileHash, file.fileName, file.mime, actor ?? null, now().toISOString());
      db.exec('COMMIT');
      return recordId;
    } catch (err) {
      db.exec('ROLLBACK');
      // Two identical uploads at once: the UNIQUE(file_hash) constraint decides the loser.
      if (/UNIQUE constraint failed: records\.file_hash/.test(err.message)) {
        throw duplicate(actor, sql.byHash.get(fileHash), fileHash, file.fileName);
      }
      throw err;
    }
  }

  async function extractSafely(buffer, mime, warnings) {
    try {
      const { text, method } = await extractText(buffer, mime);
      if (!text.trim()) warnings.push('No text could be read from this document. Enter the details manually.');
      return { text, textMethod: method };
    } catch (err) {
      console.warn(`[documents] text extraction failed (${mime}):`, err.message);
      warnings.push('Text extraction failed, so there are no suggestions. Enter the details manually.');
      return { text: '', textMethod: null };
    }
  }

  async function suggestSafely(text) {
    try {
      return await suggestMetadata(text);
    } catch (err) {
      // suggestMetadata already falls back internally; this guards against bugs, not AI errors.
      console.error('[documents] suggestion step failed:', err);
      return { suggestions: emptySuggestions(), extractionPath: 'fallback', diagnostics: { fallbackReason: err.message } };
    }
  }

  // ---- confirm ----------------------------------------------------------------------------------

  /**
   * POST /api/documents/:recordId/confirm. Validates, builds the canonical record and its leaf, -> pending.
   * A pending record may be re-confirmed (fixing a typo) until it is sealed; anchored records are final.
   * @returns {{ record: object, leaf: string, status: 'pending', canonical: string }}
   */
  function confirm(recordId, body, actor) {
    const row = getRow(recordId);
    if (row.status === 'anchored') {
      const err = new AppError('ALREADY_ANCHORED', 409, `${recordId} is already anchored in ${row.batch_id}; it can no longer change`, {
        recordId,
        batchId: row.batch_id,
      });
      reject(actor, recordId, err);
      throw err;
    }

    const { record, errors } = validateConfirmFields(
      { recordId, fileHash: row.file_hash },
      body,
      { today: localIsoDate(now()) },
    );
    if (!record) throw validationError(actor, recordId, errors);

    const { leaf, canonical } = buildLeaf(record);
    const { changes } = sql.confirm.run(
      record.docType,
      record.issuer,
      record.date,
      leaf,
      actor ?? null,
      now().toISOString(),
      recordId,
    );
    if (changes !== 1) {
      // Sealed between our read and our write.
      const err = new AppError('ALREADY_ANCHORED', 409, `${recordId} was sealed while you were confirming it`, { recordId });
      reject(actor, recordId, err);
      throw err;
    }

    const suggested = parseStoredSuggestions(row.ai_suggestions)?.suggestions;
    audit({
      actor,
      action: 'CONFIRM',
      target: recordId,
      outcome: 'OK',
      detail: {
        leaf,
        reconfirmed: row.status === 'pending',
        editedFields: suggested ? ['docType', 'issuer', 'date'].filter((f) => suggested[f] !== record[f]) : null,
      },
    });

    return { record: toRecord(sql.byId.get(recordId)), leaf, status: 'pending', canonical };
  }

  function validationError(actor, recordId, fields) {
    const err = new AppError('VALIDATION', 400, 'Some fields are invalid', { fields });
    reject(actor, recordId, err, { fields });
    return err;
  }

  // ---- read -------------------------------------------------------------------------------------

  /** GET /api/documents with already-validated filters (see parseListFilters). */
  function list(filters = {}) {
    const where = [];
    const params = [];
    const add = (condition, param) => {
      where.push(condition);
      params.push(param);
    };
    if (filters.status) add('status = ?', filters.status);
    if (filters.docType) add('doc_type = ?', filters.docType);
    if (filters.batchId) add('batch_id = ?', filters.batchId);
    if (filters.recordId) add('record_id = ?', filters.recordId);
    if (filters.issuer) {
      // Case-insensitive (ASCII) substring match; escape LIKE wildcards in user input.
      add("issuer LIKE ? ESCAPE '\\'", `%${filters.issuer.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM records ${clause} ORDER BY record_id`).all(...params).map(toRecord);
  }

  /** GET /api/documents/:recordId/file */
  async function getFile(recordId) {
    const row = getRow(recordId);
    const buffer = await storage.readFile(row.file_hash);
    return { buffer, mime: row.mime, fileName: row.file_name };
  }

  function getRow(recordId) {
    const row = RECORD_ID.test(recordId ?? '') ? sql.byId.get(recordId) : undefined;
    if (!row) throw new AppError('NOT_FOUND', 404, `No record ${recordId}`);
    return row;
  }

  return { upload, confirm, list, getFile };
}

function parseStoredSuggestions(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * API shape of one record (camelCase). Confirmed fields are null while draft.
 * `suggestions` and `extractionPath` are what the AI or fallback proposed, kept for the confirm screen.
 */
export function toRecord(row) {
  const stored = parseStoredSuggestions(row.ai_suggestions);
  return {
    recordId: row.record_id,
    fileHash: row.file_hash,
    fileName: row.file_name,
    mime: row.mime,
    status: row.status,
    docType: row.doc_type,
    issuer: row.issuer,
    date: row.doc_date,
    leaf: row.leaf,
    batchId: row.batch_id,
    leafIndex: row.leaf_index,
    extractionPath: row.extraction_path,
    suggestions: stored?.suggestions ?? null,
    warnings: stored?.warnings ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
  };
}
