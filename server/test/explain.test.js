// Owner: Mahendra | /api/explain service: templates per code, optional AI, never alters the verdict
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, test } from 'node:test';
import { RESULT } from '@proofchain/core';
import { prepareTestEnv } from './helpers.js';

// Every server test points server code at a temp DB + storage BEFORE importing it (CLAUDE.md).
const { tempDir } = prepareTestEnv();
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
const { TEMPLATES, explainResult } = await import('../src/services/explain.js');

const checks = [
  { id: '0', name: 'Proof format', pass: true },
  { id: '0b', name: 'Registry', pass: true },
  { id: '1', name: 'File hash', pass: false, computed: '0xaa', expected: '0xbb' },
  { id: '2', name: 'Leaf', pass: null },
];

test('every result code has a template', () => {
  for (const code of Object.values(RESULT)) assert.ok(TEMPLATES[code]?.length > 40, code);
});

test('AI_MODE=off uses the template and names the first failing check', async () => {
  const { explanation, path } = await explainResult({ verdict: 'DOCUMENT_MODIFIED', checks }, { aiMode: 'off' });
  assert.equal(path, 'template');
  assert.match(explanation, /^Check 1 \(File hash\) failed\./);
});

test('AI wording is used when valid, template otherwise; the result never carries a verdict', async () => {
  const good = async () => JSON.stringify({ explanation: 'The file was changed after it was registered, so its fingerprint no longer matches.' });
  const ai = await explainResult({ verdict: 'DOCUMENT_MODIFIED', checks }, { aiMode: 'gemini', generate: good });
  assert.equal(ai.path, 'ai');
  assert.deepEqual(Object.keys(ai).sort(), ['explanation', 'path']);

  for (const generate of [async () => 'garbage', async () => JSON.stringify({ explanation: 'ok' }), async () => { throw new Error('down'); }]) {
    const fallback = await explainResult({ verdict: 'ROOT_MISMATCH', checks }, { aiMode: 'gemini', generate });
    assert.equal(fallback.path, 'template');
  }
  const slow = () => new Promise((resolve) => setTimeout(() => resolve('{}'), 500));
  assert.equal((await explainResult({ verdict: 'VALID', checks: [] }, { aiMode: 'gemini', generate: slow, timeoutMs: 20 })).path, 'template');
});
