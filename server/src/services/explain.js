// Owner: Mahendra | Stretch: plain-language explanation of a verification result for the registry app only
// (the verifier uses its own deterministic templates and never calls the server)
//
// The explanation is words only. It never returns or alters a verdict, and it sees no document and no DB.
import { RESULT } from '@proofchain/core';
import { AI_TIMEOUT_MS, geminiGenerate, withTimeout } from './aiMetadata.js';

/** Fixed explanation per result code (the fallback, and the path when AI_MODE=off). */
export const TEMPLATES = Object.freeze({
  [RESULT.VALID]:
    'All checks passed. This exact file, with these confirmed details, was registered by this registry in this batch, and the batch root matches the one published on the chain. This proves registration only, not that the contents are true or who wrote them.',
  [RESULT.FORMAT_INVALID]:
    'The proof.json is malformed or does not follow this registry\'s hashing scheme (a missing field, a wrong hash length or a path of the wrong length), so nothing else could be checked reliably.',
  [RESULT.REGISTRY_MISMATCH]:
    'The proof names a different chain or contract than the one this verifier trusts, so it was not issued by this registry. A forged proof can point at a fake contract; only the pinned contract counts.',
  [RESULT.DOCUMENT_MODIFIED]:
    'The SHA-256 hash of this file differs from the hash recorded when it was registered. The document has been changed since registration (even one byte is enough), or it is a different file, such as a re-saved or compressed copy.',
  [RESULT.METADATA_MODIFIED]:
    'The file itself matches, but its recorded details (record ID, issuer, document type or date) do not rebuild the registered leaf. The metadata in the proof was altered after registration.',
  [RESULT.PROOF_INVALID]:
    'The sibling hashes in the proof do not lead from this record\'s leaf to the root the proof claims. The proof was corrupted or edited, or it belongs to a different record or batch.',
  [RESULT.BATCH_NOT_PUBLISHED]:
    'The chain holds no root for this batch, so there is nothing trustworthy to compare against. The batch was never published, or the local chain was reset.',
  [RESULT.ROOT_MISMATCH]:
    'The proof is internally consistent, but its root or leaf count is not the one published on the chain for this batch. Someone can rebuild a self-consistent proof for a forged document; the on-chain root is what exposes it.',
});

const MAX_EXPLANATION_CHARS = 700;

const SYSTEM_INSTRUCTION = `You explain the result of a cryptographic document verification to a non-technical person.
You receive the verdict code and the list of checks. Do not change, question or soften the verdict.
Write 2 or 3 short plain sentences: what failed (or that everything passed) and what it means in practice.
Say that verification proves registration only, not that the contents are true, when the verdict is VALID.
Reply with JSON only: {"explanation": string}`;

/**
 * Explain a verdict in 2-3 plain sentences. Uses Gemini via @google/genai when config.aiMode is
 * "gemini", otherwise (or on failure) a fixed template per result code. Never changes the verdict.
 * @param {{ verdict: string, checks: object[] }} result output of verify() from @proofchain/core
 * @param {object} [options] test seams
 * @param {'gemini'|'off'} [options.aiMode] defaults to config.aiMode
 * @param {Function} [options.generate] same contract as geminiGenerate
 * @param {number} [options.timeoutMs] defaults to AI_TIMEOUT_MS (8 s)
 * @returns {Promise<{ explanation: string, path: 'ai' | 'template' }>}
 */
export async function explainResult({ verdict, checks }, options = {}) {
  const template = templateFor(verdict, checks);
  const aiMode = options.aiMode ?? (await import('../config.js')).config.aiMode;
  if (aiMode !== 'gemini') return { explanation: template, path: 'template' };

  try {
    const generate = options.generate ?? geminiGenerate;
    const prompt = `Verdict: ${verdict}\nChecks:\n${JSON.stringify(checks)}`;
    const raw = await withTimeout(
      (signal) => generate({ system: SYSTEM_INSTRUCTION, prompt, signal }),
      options.timeoutMs ?? AI_TIMEOUT_MS,
    );
    const explanation = readExplanation(raw);
    if (explanation) return { explanation, path: 'ai' };
  } catch {
    // Any AI failure falls back to the template; the explanation is never essential.
  }
  return { explanation: template, path: 'template' };
}

/** Template text, prefixed with the first failing check when there is one. */
export function templateFor(verdict, checks = []) {
  const base = TEMPLATES[verdict];
  const failed = checks.find((check) => check.pass === false);
  if (verdict === RESULT.VALID || !failed) return base;
  return `Check ${failed.id} (${failed.name}) failed. ${base}`;
}

function readExplanation(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return null;
  }
  const text = typeof parsed?.explanation === 'string' ? parsed.explanation.replace(/\s+/g, ' ').trim() : '';
  if (text.length < 20 || text.length > MAX_EXPLANATION_CHARS) return null;
  return text;
}
