// Owner: Archit | DEMO ONLY: tamper endpoint that corrupts the registry's own DB and storage on purpose,
// so the audit and the verifier can be shown catching it. Not part of a real registry.
import { Router } from 'express';
import { tamper } from '../services/tamper.js';

const router = Router();

/**
 * POST /api/demo/tamper  body { type: "stored_file" | "db_metadata" | "restore", recordId, field? }
 *   db_metadata: change the record's issuer in the DB, or with field (e.g. "netPay") that confirmed
 *                document field (original kept in the audit log detail)
 *   stored_file: flip one byte near the middle of the stored file (offset + original byte in the detail)
 *   restore:     undo the most recent tamper on that record that has not been undone yet
 * -> { ok: true, detail }
 * -> 400 VALIDATION (unknown type, missing recordId, nothing to edit), 404 NOT_FOUND,
 *    409 NOTHING_TO_RESTORE
 */
router.post('/api/demo/tamper', (req, res) => {
  const { type, recordId, field } = req.body ?? {};
  res.json({ ok: true, detail: tamper({ type, recordId, field, actor: req.actor }) });
});

export default router;
