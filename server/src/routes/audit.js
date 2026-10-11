// Owner: Archit | Integrity audit (DB roots vs chain) and the audit log
import { Router } from 'express';
import { notImplemented } from '../lib/errors.js';

const router = Router();

/**
 * POST /api/audit
 * -> { batches: [ { batchId, status: "OK" | "MISMATCH", dbRoot, chainRoot, changedRecords: [recordId] } ] }
 */
router.post('/api/audit', notImplemented);

/**
 * GET /api/audit-log
 * -> [ { id, ts, actor, action, target, outcome, detail } ] newest first
 */
router.get('/api/audit-log', notImplemented);

export default router;
