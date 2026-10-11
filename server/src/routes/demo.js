// Owner: Archit | Tamper demo endpoint (demo only)
import { Router } from 'express';
import { notImplemented } from '../lib/errors.js';

const router = Router();

/**
 * POST /api/demo/tamper  body { type: "stored_file" | "db_metadata", recordId }
 * -> { ok: true, detail }
 */
router.post('/api/demo/tamper', notImplemented);

export default router;
