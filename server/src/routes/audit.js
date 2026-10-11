// Owner: Archit | Integrity audit (DB roots vs chain) and the audit log
import { Router } from 'express';
import { listEntries } from '../lib/auditLog.js';
import { AppError } from '../lib/errors.js';
import { runAudit } from '../services/audit.js';

const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 500;

const router = Router();

/**
 * POST /api/audit  (read-only; logs AUDIT)
 * -> { checkedAt, batches: [ { batchId, status: "OK" | "MISMATCH", dbRoot, storedRoot, chainRoot,
 *      leafCount, chainLeafCount, changedRecords: [recordId], changedFiles: [recordId] } ],
 *      onChainOnly: [batchId] }
 * -> 503 CHAIN_UNREACHABLE
 */
router.post('/api/audit', async (req, res) => {
  res.json(await runAudit(req.actor));
});

/**
 * GET /api/audit-log?limit=100  (limit 1-500; larger values are capped at 500)
 * -> [ { id, ts, actor, action, target, outcome, detail } ] newest first, detail parsed from JSON
 */
router.get('/api/audit-log', (req, res) => {
  res.json(listEntries(readLimit(req.query.limit)));
});

function readLimit(raw) {
  if (raw === undefined) return DEFAULT_LOG_LIMIT;
  const limit = Number(raw);
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || limit < 1) {
    throw new AppError('VALIDATION', 400, 'Invalid audit log query', {
      limit: `must be an integer from 1 to ${MAX_LOG_LIMIT}`,
    });
  }
  return Math.min(limit, MAX_LOG_LIMIT);
}

export default router;
