// Owner: Mahendra | Input rules for documents: upload sniffing, confirm-field validation, list filters, core bridge
//
// Pure functions only (no DB, no Express), so they are unit-testable without server/.env.
import crypto from 'node:crypto';
import {
  BATCH_ID,
  DOC_TYPES,
  ISSUER_MAX_LENGTH,
  RECORD_ID,
  buildFieldTree,
  canonicalJSON,
  detectNormalization,
  fileHash,
  leafHash,
  normText,
  normalizeFields,
  validateRecord,
} from '@proofchain/core';
import { AppError } from '../lib/errors.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const RECORD_STATUSES = Object.freeze(['draft', 'pending', 'anchored']);
const MAX_FILE_NAME_CHARS = 200;

// ---- upload -------------------------------------------------------------------------------------

/** Accepted kinds. The mime type stored and served is decided by sniffing the bytes, not by the client. */
const KINDS = Object.freeze({
  pdf: { mime: 'application/pdf', extensions: ['.pdf'] },
  png: { mime: 'image/png', extensions: ['.png'] },
  jpeg: { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  txt: { mime: 'text/plain', extensions: ['.txt'] },
});
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIGNATURE = Buffer.from('%PDF-');
const PDF_SIGNATURE_WINDOW = 1024; // the PDF spec tolerates junk before the header

/** Identify a file by its leading bytes. Returns a KINDS key or null (TXT is checked separately). */
export function sniffKind(buffer) {
  if (PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, PDF_SIGNATURE_WINDOW).indexOf(PDF_SIGNATURE) !== -1) return 'pdf';
  return null;
}

function isValidUtf8(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

/**
 * Validate an upload: present, non-empty, <= 10 MB, an accepted type whose bytes match its extension.
 * @param {{ buffer?: Buffer, originalName?: string }} file
 * @returns {{ mime: string, fileName: string, kind: string }}
 * @throws {AppError} NO_FILE, EMPTY_FILE, FILE_TOO_LARGE, UNSUPPORTED_TYPE,
 *   INVALID_TEXT_ENCODING (a .txt that is not valid UTF-8)
 */
export function validateUpload({ buffer, originalName }) {
  if (!buffer) {
    throw new AppError('NO_FILE', 400, 'Attach the document as multipart form field "file"');
  }
  if (buffer.length === 0) throw new AppError('EMPTY_FILE', 400, 'The uploaded file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError('FILE_TOO_LARGE', 413, 'Files must be 10 MB or smaller');
  }

  const fileName = sanitizeFileName(originalName);
  const extension = extensionOf(fileName);
  const expected = Object.entries(KINDS).find(([, kind]) => kind.extensions.includes(extension));
  if (!expected) {
    throw new AppError('UNSUPPORTED_TYPE', 415, 'Only PDF, PNG, JPG or TXT files are accepted', {
      extension: extension || null,
    });
  }

  const [expectedKind] = expected;
  const sniffed = sniffKind(buffer);
  if (expectedKind === 'txt') {
    // Binary pretending to be text (a renamed PDF/image, or NUL bytes) is the wrong type...
    if (sniffed || buffer.includes(0)) {
      throw new AppError('UNSUPPORTED_TYPE', 415, 'This .txt file contains binary data, not plain text', {
        extension,
        detected: sniffed ?? 'binary',
      });
    }
    // ...while text in another encoding (e.g. UTF-16, Windows-1252) is an encoding problem.
    if (!isValidUtf8(buffer)) throw invalidTextEncoding();
  } else if (sniffed !== expectedKind) {
    throw new AppError(
      'UNSUPPORTED_TYPE',
      415,
      `The file content is not a valid ${expectedKind.toUpperCase()} (it does not match its ${extension} extension)`,
      { extension, detected: sniffed },
    );
  }
  return { mime: KINDS[expectedKind].mime, fileName, kind: expectedKind };
}

function invalidTextEncoding() {
  return new AppError('INVALID_TEXT_ENCODING', 415, 'Text files must be valid UTF-8. Re-save the file as UTF-8 and upload it again');
}

/**
 * Keep a display name only: no directories, no control characters, bounded length.
 * Busboy decodes header filenames as latin1 by default; recover UTF-8 names (e.g. Devanagari).
 */
export function sanitizeFileName(name) {
  let value = String(name ?? '');
  if (/^[\u0000-ÿ]*$/.test(value)) {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded.includes('�')) value = decoded;
  }
  value = value.split(/[\\/]/).pop();
  value = value.replace(/[\u0000-\u001f\u007f]/g, '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (value.length > MAX_FILE_NAME_CHARS) {
    const extension = extensionOf(value);
    value = value.slice(0, MAX_FILE_NAME_CHARS - extension.length) + extension;
  }
  return value || 'document';
}

// ---- confirm ------------------------------------------------------------------------------------

/**
 * Validate confirmed fields with core's validateRecord (locked formats) plus the future-date rule,
 * which core deliberately leaves to the server so that verification never depends on today's date.
 * Document fields (e.g. netPay) are normalised with core's normalizeFields for the chosen docType,
 * in schema order; their errors are keyed "fields.<name>".
 * Error messages are fragments ("is required", "must be YYYY-MM-DD") to read after the field label.
 * @param {{ recordId: string, fileHash: string }} stored the draft's recordId and fileHash
 * @param {unknown} body request body { docType, issuer, date, fields?: { [name]: value as typed } }
 *   (amounts in rupees, e.g. "50,000")
 * @param {{ today: string }} options today's local date, YYYY-MM-DD
 * @returns {{ record: object | null, fields: Array<{ name: string, value: string }>,
 *   errors: Record<string, string> }} record (without fieldsRoot) and normalised fields; record is
 *   null when there are errors
 */
export function validateConfirmFields(stored, body, { today }) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const record = {
    recordId: stored.recordId,
    fileHash: stored.fileHash,
    docType: input.docType,
    issuer: typeof input.issuer === 'string' ? normText(input.issuer) : input.issuer,
    date: input.date,
  };

  const { errors } = validateRecord(record);
  if (!errors.date && record.date > today) errors.date = 'must not be in the future';
  const fields = errors.docType ? [] : readDocumentFields(record.docType, input.fields, errors);
  if (Object.keys(errors).length > 0) return { record: null, fields: [], errors };
  return { record, fields, errors };
}

// Fields are checked only once the docType is known, since the docType decides which fields exist
function readDocumentFields(docType, raw, errors) {
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    errors.fields = 'must be an object of field values';
    return [];
  }
  const { fields, errors: fieldErrors } = normalizeFields(docType, raw ?? {});
  for (const [name, message] of Object.entries(fieldErrors)) errors[`fields.${name}`] = message;
  return fields;
}

/** 16 random bytes as 32 lowercase hex characters: one per field, so values cannot be guessed from leaves. */
export function randomSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Give each normalised field its own fresh salt.
 * @param {Array<{ name: string, value: string }>} fields
 * @param {() => string} [salt] test seam
 * @returns {Array<{ name: string, value: string, salt: string }>}
 */
export function saltFields(fields, salt = randomSalt) {
  return fields.map(({ name, value }) => ({ name, value, salt: salt() }));
}

// ---- list filters -------------------------------------------------------------------------------

/**
 * Validate GET /api/documents query filters. Unknown keys are ignored.
 * `recordId` is an additive filter (not in the CLAUDE.md table) used by the confirm screen to reload a draft.
 * @returns {{ status?: string, docType?: string, issuer?: string, batchId?: string, recordId?: string }}
 * @throws {AppError} VALIDATION with details.fields
 */
export function parseListFilters(query = {}) {
  const filters = {};
  const errors = {};
  const read = (key) => {
    const value = query[key];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string') {
      errors[key] = 'Give this filter once, as text';
      return undefined;
    }
    return value.trim();
  };

  const status = read('status');
  if (status !== undefined) {
    if (RECORD_STATUSES.includes(status)) filters.status = status;
    else errors.status = `One of: ${RECORD_STATUSES.join(', ')}`;
  }
  const docType = read('docType');
  if (docType !== undefined) {
    if (DOC_TYPES.includes(docType)) filters.docType = docType;
    else errors.docType = `One of: ${DOC_TYPES.join(', ')}`;
  }
  const issuer = read('issuer');
  if (issuer !== undefined) {
    if (issuer.length <= ISSUER_MAX_LENGTH) filters.issuer = normText(issuer);
    else errors.issuer = `At most ${ISSUER_MAX_LENGTH} characters`;
  }
  const batchId = read('batchId');
  if (batchId !== undefined) {
    if (BATCH_ID.test(batchId)) filters.batchId = batchId;
    else errors.batchId = 'Format BATCH-0001';
  }
  const recordId = read('recordId');
  if (recordId !== undefined) {
    if (RECORD_ID.test(recordId)) filters.recordId = recordId;
    else errors.recordId = 'Format REC-000001';
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION', 400, 'Invalid list filters', { fields: errors });
  }
  return filters;
}

// ---- hashing via @proofchain/core ---------------------------------------------------------------

/**
 * fileHash of the raw upload, with the normalisation core picks ("text-v1" for .txt, else "none").
 * @returns {{ fileHash: string, normalization: 'none' | 'text-v1' }}
 * @throws {AppError} INVALID_TEXT_ENCODING (415) when core rejects a .txt as not valid UTF-8
 */
export function hashUpload(buffer, { fileName, mime }) {
  const normalization = detectNormalization({ fileName, mime });
  try {
    return { fileHash: fileHash(buffer, { normalization }), normalization };
  } catch (err) {
    if (err.code === 'INVALID_TEXT_ENCODING') throw invalidTextEncoding();
    throw err;
  }
}

/**
 * v2 canonical record + leaf for a confirmed record and its salted fields, all from core (never
 * re-implemented here): fieldsRoot = root of the field tree, then leaf over the record with it.
 * Call only after validateConfirmFields returned no errors.
 * @returns {{ fieldsRoot: string, canonical: string, leaf: string }}
 */
export function buildLeaf(record, saltedFields) {
  const withRoot = { ...record, fieldsRoot: buildFieldTree(saltedFields).root };
  return {
    fieldsRoot: withRoot.fieldsRoot,
    canonical: canonicalJSON(withRoot),
    leaf: leafHash(withRoot),
  };
}
