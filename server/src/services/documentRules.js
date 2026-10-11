// Owner: Mahendra | Input rules for documents: upload sniffing, confirm-field validation, list filters, core bridge
//
// Pure functions only (no DB, no Express), so they are unit-testable without server/.env.
import { createHash } from 'node:crypto';
import * as core from '@proofchain/core';
import { BATCH_ID, DOC_TYPES, FILE_NORMALIZATION, RECORD_ID, canonicalJSON, normText } from '@proofchain/core';
import { AppError } from '../lib/errors.js';
import { isValidIsoDate } from './fallbackMetadata.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ISSUER_MAX_CHARS = 120;
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

function isUtf8Text(buffer) {
  if (buffer.includes(0)) return false; // NUL bytes: binary, not text
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
 * @throws {AppError} NO_FILE, EMPTY_FILE, FILE_TOO_LARGE, UNSUPPORTED_TYPE
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
  const sniffed = sniffKind(buffer) ?? (isUtf8Text(buffer) ? 'txt' : null);
  if (sniffed !== expectedKind) {
    const message =
      expectedKind === 'txt'
        ? 'Text files must be UTF-8 plain text'
        : `The file content is not a valid ${expectedKind.toUpperCase()} (it does not match its ${extension} extension)`;
    throw new AppError('UNSUPPORTED_TYPE', 415, message, { extension, detected: sniffed });
  }
  return { mime: KINDS[expectedKind].mime, fileName, kind: expectedKind };
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
 * Validate the confirmed fields against the locked formats. The future-date check lives here
 * because core deliberately skips it (it depends on "today").
 * @param {unknown} body request body { docType, issuer, date }
 * @param {{ today: string }} options today's local date, YYYY-MM-DD
 * @returns {{ value: { docType: string, issuer: string, date: string } | null, errors: Record<string,string> }}
 */
export function validateConfirmFields(body, { today }) {
  const errors = {};
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const { docType, issuer, date } = input;

  if (typeof docType !== 'string' || !DOC_TYPES.includes(docType)) {
    errors.docType = `Choose one of: ${DOC_TYPES.join(', ')}`;
  }

  let cleanIssuer = '';
  if (typeof issuer !== 'string') {
    errors.issuer = 'Issuer is required';
  } else {
    cleanIssuer = normText(issuer);
    const length = [...cleanIssuer].length;
    if (length === 0) errors.issuer = 'Issuer is required';
    else if (length > ISSUER_MAX_CHARS) errors.issuer = `Issuer must be at most ${ISSUER_MAX_CHARS} characters`;
    else if (/\p{Cc}/u.test(cleanIssuer)) errors.issuer = 'Issuer contains control characters';
  }

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.date = 'Date must be YYYY-MM-DD';
  } else if (!isValidIsoDate(date)) {
    errors.date = 'Date is not a real calendar date';
  } else if (date > today) {
    errors.date = 'Date cannot be in the future';
  }

  if (Object.keys(errors).length > 0) return { value: null, errors };
  return { value: { docType, issuer: cleanIssuer, date }, errors };
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
    if (issuer.length <= ISSUER_MAX_CHARS) filters.issuer = normText(issuer);
    else errors.issuer = `At most ${ISSUER_MAX_CHARS} characters`;
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

// ---- bridge to @proofchain/core -----------------------------------------------------------------
//
// fileHash, leafHash, detectNormalization and validateRecord come from @proofchain/core. Until
// Archit's core lands they throw NOT_IMPLEMENTED (or do not exist yet); CLAUDE.md says Mahendra stubs
// them meanwhile. The stub below follows the locked spec, is used ONLY while core is missing, and is
// reported as hashSource "mock" in the API response and audit log. Delete it once core is on main.

let warnedAboutMock = false;

function isNotImplemented(err) {
  return err instanceof Error && err.message.startsWith('NOT_IMPLEMENTED');
}

function callCore(name, args) {
  const fn = core[name];
  if (typeof fn !== 'function') return { missing: true };
  try {
    return { value: fn(...args) };
  } catch (err) {
    if (isNotImplemented(err)) return { missing: true };
    throw err;
  }
}

function noteMock(name) {
  if (warnedAboutMock) return;
  warnedAboutMock = true;
  console.warn(
    `[documents] @proofchain/core ${name} is not implemented yet: using the temporary stub in ` +
      'services/documentRules.js. Pull main once core lands, then run npm run reset.',
  );
}

/** "text-v1" for .txt, "none" otherwise. Prefers core.detectNormalization when it exists. */
export function detectNormalization({ mime, fileName }) {
  const result = callCore('detectNormalization', [{ mime, fileName }]);
  // TODO(core lands): confirm detectNormalization's signature; anything unexpected uses the local rule.
  if (!result.missing && Object.values(FILE_NORMALIZATION).includes(result.value)) return result.value;
  return mime === 'text/plain' ? FILE_NORMALIZATION.TEXT_V1 : FILE_NORMALIZATION.NONE;
}

/**
 * fileHash of the raw upload via core.
 * @returns {{ fileHash: string, hashSource: 'core' | 'mock' }}
 */
export function computeFileHash(bytes, normalization) {
  const result = callCore('fileHash', [new Uint8Array(bytes), { normalization }]);
  if (!result.missing) return { fileHash: result.value, hashSource: 'core' };
  noteMock('fileHash');
  const input = normalization === FILE_NORMALIZATION.TEXT_V1 ? stubNormalizeText(bytes) : bytes;
  return { fileHash: stubSha256Hex(input), hashSource: 'mock' };
}

/**
 * leaf for a confirmed record via core.
 * @returns {{ leaf: string, hashSource: 'core' | 'mock' }}
 */
export function computeLeaf(record) {
  const result = callCore('leafHash', [record]);
  if (!result.missing) return { leaf: result.value, hashSource: 'core' };
  noteMock('leafHash');
  const json = Buffer.from(canonicalJSON(record), 'utf8');
  return { leaf: stubSha256Hex(Buffer.concat([Buffer.from([0x00]), json])), hashSource: 'mock' };
}

/**
 * Run core.validateRecord when available and turn whatever it reports into field errors.
 * Tolerant of the exact return shape until core's signature is final (TODO(core lands)).
 * @returns {Record<string, string>} empty when the record is acceptable
 */
export function coreRecordErrors(record) {
  let result;
  try {
    result = callCore('validateRecord', [record]);
  } catch (err) {
    return { [err.field ?? 'record']: err.message };
  }
  if (result.missing) return {};
  return interpretValidation(result.value);
}

function interpretValidation(value) {
  if (value === undefined || value === null || value === true) return {};
  if (value === false) return { record: 'Record rejected by core validation' };
  if (Array.isArray(value)) return listToFields(value);
  if (typeof value === 'object') {
    const errors = value.errors ?? value.fields;
    if (Array.isArray(errors)) return listToFields(errors);
    if (errors && typeof errors === 'object' && Object.keys(errors).length > 0) return { ...errors };
    if (value.ok === false || value.valid === false) return { record: 'Record rejected by core validation' };
  }
  return {};
}

function listToFields(list) {
  const fields = {};
  for (const item of list) {
    if (item && typeof item === 'object') fields[item.field ?? 'record'] = item.message ?? String(item);
    else fields.record = fields.record ? `${fields.record}; ${item}` : String(item);
  }
  return fields;
}

// TEMPORARY stub of the locked spec (CLAUDE.md "Hashing"), used only while core is missing.
function stubSha256Hex(bytes) {
  return '0x' + createHash('sha256').update(bytes).digest('hex');
}

function stubNormalizeText(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  const normalised = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').normalize('NFC');
  return Buffer.from(normalised, 'utf8');
}

/** Exposed for the record shape: what exactly goes into the leaf. */
export function canonicalOf(record) {
  return canonicalJSON(record);
}
