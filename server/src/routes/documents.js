// Owner: Mahendra | Document upload, confirm, list and file download
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { logAction } from '../lib/auditLog.js';
import { suggestMetadata } from '../services/aiMetadata.js';
import { createDocumentRegistry } from '../services/documentRegistry.js';
import { MAX_UPLOAD_BYTES, parseListFilters } from '../services/documentRules.js';
import { extractText } from '../services/extraction.js';
import { createStorage } from '../services/storage.js';

const router = Router();

const registry = createDocumentRegistry({
  db,
  storage: createStorage(config.storageDir),
  extractText,
  suggestMetadata,
  logAction,
});

// Memory storage: files are at most 10 MB and must be hashed before they are written anywhere.
const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 },
}).single('file');

/** multer, plus an audit entry when it rejects the upload (e.g. 413 FILE_TOO_LARGE). */
function receiveFile(req, res, next) {
  receive(req, res, (err) => {
    if (err) {
      const outcome = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_INVALID';
      try {
        logAction({ actor: req.actor, action: 'REJECT', outcome, detail: { message: err.message } });
      } catch {
        // Never mask the upload error with an audit error.
      }
    }
    next(err);
  });
}

/**
 * POST /api/documents  (multipart field "file"; PDF, PNG/JPG or TXT, max 10 MB)
 * -> 201 { recordId, fileHash, status: "draft",
 *          suggestions: { docType, issuer, date, confidence: {...}, evidence: {...} },
 *          extractionPath: "ai" | "fallback", fileName, mime, textMethod, warnings: string[] }
 * -> 409 DUPLICATE with details { recordId, batchId, status } when fileHash already exists
 * -> 400 NO_FILE | EMPTY_FILE | UPLOAD_INVALID, 413 FILE_TOO_LARGE,
 *    415 UNSUPPORTED_TYPE (wrong type, or binary in a .txt) | INVALID_TEXT_ENCODING (.txt not UTF-8)
 */
router.post('/api/documents', receiveFile, async (req, res) => {
  const result = await registry.upload({
    buffer: req.file?.buffer,
    originalName: req.file?.originalname,
    actor: req.actor,
  });
  res.status(201).json(result);
});

/**
 * POST /api/documents/:recordId/confirm  body { docType, issuer, date, fields?: { [name]: value } }
 *   fields: the docType's document fields as typed (amounts in rupees, e.g. { netPay: "50,000" });
 *   the server normalises them, salts each one and commits to them through fieldsRoot (record v2)
 * -> { record, leaf, status: "pending", canonical }  (canonical = the v2 record text that was hashed)
 * -> 400 VALIDATION with details { fields: { docType?, issuer?, date?, "fields.<name>"? } }
 * -> 404 NOT_FOUND, 409 ALREADY_ANCHORED
 */
router.post('/api/documents/:recordId/confirm', (req, res) => {
  res.json(registry.confirm(req.params.recordId, req.body, req.actor));
});

/**
 * GET /api/documents?status=&docType=&issuer=&batchId=  (+ additive &recordId=)
 * -> [ record ]  ordered by recordId; 400 VALIDATION for a bad filter value
 */
router.get('/api/documents', (req, res) => {
  res.json(registry.list(parseListFilters(req.query)));
});

/**
 * GET /api/documents/:recordId/file
 * -> the stored file bytes with its original mime type; 404 NOT_FOUND
 */
router.get('/api/documents/:recordId/file', async (req, res) => {
  const { buffer, mime, fileName } = await registry.getFile(req.params.recordId);
  res.set({
    'Content-Type': mime === 'text/plain' ? 'text/plain; charset=utf-8' : mime,
    'Content-Disposition': contentDisposition(fileName),
    'X-Content-Type-Options': 'nosniff',
    // The tamper demo edits stored bytes; never let a browser show a cached original.
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
});

/** inline; filename="ascii fallback"; filename*=UTF-8''percent-encoded (RFC 6266) */
function contentDisposition(fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export default router;
