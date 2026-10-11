// Owner: Archit | GET /api/documents/:recordId/proof: proof.json for an anchored record
import { Router } from 'express';
import { buildRecordProof } from '../services/proofs.js';

const router = Router();

/**
 * GET /api/documents/:recordId/proof
 * -> proof.json (shape in CLAUDE.md "proof.json"), served as the download "<recordId>.proof.json"
 * -> 404 NOT_FOUND (no such record), 404 NOT_ANCHORED (its batch is not on-chain yet)
 * -> 409 RECORD_INTEGRITY_FAILED when the stored record no longer folds to its batch root (run the audit)
 */
router.get('/api/documents/:recordId/proof', (req, res) => {
  const proof = buildRecordProof(req.params.recordId);
  res.attachment(`${proof.recordId}.proof.json`);
  res.type('application/json').send(JSON.stringify(proof, null, 2) + '\n');
});

export default router;
