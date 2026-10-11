// Owner: Mahendra | Document upload, confirm, list and file download
import { Router } from 'express';
import { notImplemented } from '../lib/errors.js';

const router = Router();

/**
 * POST /api/documents  (multipart field "file"; PDF, PNG/JPG or TXT, max 10 MB)
 * -> 201 { recordId, fileHash, status: "draft",
 *          suggestions: { docType, issuer, date, confidence: {...}, evidence: {...} },
 *          extractionPath: "ai" | "fallback" }
 * -> 409 DUPLICATE with details { recordId, batchId } when fileHash already exists
 */
router.post('/api/documents', notImplemented);

/**
 * POST /api/documents/:recordId/confirm  body { docType, issuer, date }
 * -> { record, leaf, status: "pending" }
 * -> 400 VALIDATION with field errors in details
 */
router.post('/api/documents/:recordId/confirm', notImplemented);

/**
 * GET /api/documents?status=&docType=&issuer=&batchId=
 * -> [ record ]
 */
router.get('/api/documents', notImplemented);

/**
 * GET /api/documents/:recordId/file
 * -> the stored file bytes with its original mime type
 */
router.get('/api/documents/:recordId/file', notImplemented);

export default router;
