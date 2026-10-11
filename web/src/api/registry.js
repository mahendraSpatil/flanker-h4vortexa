// Owner: Archit (frozen; ask before changing) | Health, batch, audit, demo and explain endpoints
// Usage: import * as registry from '../api/registry.js'; await registry.seal();
import { request } from './client.js';

/** GET /api/health -> { ok, chain, aiMode, contract }. */
export function getHealth() {
  return request('/api/health');
}

/** POST /api/batches/seal -> { batchId, root, leafCount, txHash, blockNumber } (400 NOTHING_PENDING). */
export function seal() {
  return request('/api/batches/seal', { method: 'POST' });
}

/** GET /api/batches -> [ { batchId, root, leafCount, txHash, blockNumber, publishedAt } ]. */
export function listBatches() {
  return request('/api/batches');
}

/** POST /api/audit -> { batches: [ { batchId, status, dbRoot, chainRoot, changedRecords } ] }. */
export function runAudit() {
  return request('/api/audit', { method: 'POST' });
}

/** GET /api/audit-log -> [ entry ] newest first. */
export function getAuditLog() {
  return request('/api/audit-log');
}

/** POST /api/demo/tamper. type: "stored_file" | "db_metadata" -> { ok: true, detail }. */
export function tamper({ type, recordId }) {
  return request('/api/demo/tamper', { method: 'POST', json: { type, recordId } });
}

/** POST /api/explain with a verify() result -> { explanation, path: "ai" | "template" }. */
export function explain({ verdict, checks }) {
  return request('/api/explain', { method: 'POST', json: { verdict, checks } });
}
