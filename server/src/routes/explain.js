// Owner: Mahendra | POST /api/explain: plain-language explanation of a verification result
import { Router } from 'express';
import { notImplemented } from '../lib/errors.js';

const router = Router();

/**
 * POST /api/explain  body { verdict, checks }  (no document, no DB lookup)
 * -> { explanation, path: "ai" | "template" }
 */
router.post('/api/explain', notImplemented);

export default router;
