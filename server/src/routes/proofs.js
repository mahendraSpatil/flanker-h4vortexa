// Owner: Archit | GET /api/documents/:recordId/proof: proof.json for an anchored record
import { Router } from 'express';
import { notImplemented } from '../lib/errors.js';

const router = Router();

/**
 * GET /api/documents/:recordId/proof
 * -> proof.json (shape in CLAUDE.md "proof.json"), served as a download
 * -> 404 NOT_ANCHORED when the record exists but its batch is not on-chain yet
 */
router.get('/api/documents/:recordId/proof', notImplemented);

export default router;
