// Owner: Archit | Seal + publish a batch, list batches
import { Router } from 'express';
import { listBatches, sealBatch } from '../services/batching.js';

const router = Router();

/**
 * POST /api/batches/seal
 * -> 201 { batchId, root, leafCount, txHash, blockNumber }
 * -> 400 NOTHING_PENDING when no record is pending
 * -> 409 SEAL_IN_PROGRESS | RECORD_INTEGRITY_FAILED (details { recordIds, problems }) | BATCH_ALREADY_PUBLISHED
 * -> 502 CHAIN_REVERTED, 503 CHAIN_UNREACHABLE, 500 ANCHOR_SAVE_FAILED (published but not saved)
 */
router.post('/api/batches/seal', async (req, res) => {
  res.status(201).json(await sealBatch(req.actor));
});

/**
 * GET /api/batches
 * -> [ { batchId, root, leafCount, txHash, blockNumber, publishedAt, records: [recordId] } ] newest first
 */
router.get('/api/batches', (req, res) => {
  res.json(listBatches());
});

export default router;
