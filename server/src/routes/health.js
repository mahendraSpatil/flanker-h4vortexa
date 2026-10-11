// Owner: Archit | GET /api/health: server, chain and AI status
import { Router } from 'express';
import { config } from '../config.js';
import { deployment, isChainReachable } from '../lib/chain.js';

const router = Router();

/** Returns { ok: true, chain: boolean, aiMode: "gemini" | "off", contract: address }. */
router.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    chain: await isChainReachable(),
    aiMode: config.aiMode,
    contract: deployment.address,
  });
});

export default router;
