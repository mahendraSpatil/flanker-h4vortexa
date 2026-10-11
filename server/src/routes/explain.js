// Owner: Mahendra | POST /api/explain: plain-language explanation of a verification result
import { RESULT } from '@proofchain/core';
import { Router } from 'express';
import { AppError } from '../lib/errors.js';
import { explainResult } from '../services/explain.js';

const router = Router();

const VERDICTS = Object.values(RESULT);
const MAX_CHECKS = 12;
const MAX_TEXT = 140;

/**
 * POST /api/explain  body { verdict, checks }  (no document, no DB lookup)
 * -> { explanation, path: "ai" | "template" }
 * -> 400 VALIDATION with details { fields }
 */
router.post('/api/explain', async (req, res) => {
  res.json(await explainResult(parseExplainBody(req.body)));
});

/** Accept only the verify() result shape, trimmed to what an explanation needs. */
function parseExplainBody(body) {
  const fields = {};
  const { verdict, checks } = body && typeof body === 'object' ? body : {};
  if (!VERDICTS.includes(verdict)) fields.verdict = `One of: ${VERDICTS.join(', ')}`;
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS) {
    fields.checks = `An array of at most ${MAX_CHECKS} checks`;
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError('VALIDATION', 400, 'Body must be a verify() result { verdict, checks }', { fields });
  }

  const text = (value) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : undefined);
  return {
    verdict,
    checks: checks
      .filter((check) => check && typeof check === 'object')
      .map((check) => ({
        id: text(check.id),
        name: text(check.name),
        pass: typeof check.pass === 'boolean' ? check.pass : null, // null = skipped
        computed: text(check.computed),
        expected: text(check.expected),
      })),
  };
}

export default router;
