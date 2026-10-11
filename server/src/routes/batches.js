// Owner: Archit | Seal + publish a batch, list batches
import { Router } from 'express';
import { notImplemented } from '../lib/errors.js';

const router = Router();

/**
 * POST /api/batches/seal
 * -> { batchId, root, leafCount, txHash, blockNumber }
 * -> 400 NOTHING_PENDING when no record is pending
 */
router.post('/api/batches/seal', notImplemented);

/**
 * GET /api/batches
 * -> [ { batchId, root, leafCount, txHash, blockNumber, publishedAt } ]
 */
router.get('/api/batches', notImplemented);

export default router;
