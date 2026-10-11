// Owner: Archit (frozen; ask before changing) | Appends entries to and reads the audit_log table
import { db } from '../db/index.js';

export const AUDIT_ACTIONS = Object.freeze([
  'UPLOAD',
  'CONFIRM',
  'SEAL',
  'PUBLISH',
  'AUDIT',
  'TAMPER',
  'RESTORE',
  'REJECT',
]);

const insertEntry = db.prepare(
  'INSERT INTO audit_log (ts, actor, action, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)',
);
const selectNewest = db.prepare(
  'SELECT id, ts, actor, action, target, outcome, detail FROM audit_log ORDER BY id DESC LIMIT ?',
);

/**
 * Record one action. `detail` is stored as JSON.
 * @param {{ actor: string|null, action: string, target?: string, outcome?: string, detail?: object }} entry
 *   action is one of AUDIT_ACTIONS; target is usually a recordId or batchId; outcome e.g. "OK" or an error code
 * @returns {number} id of the new entry
 */
export function logAction({ actor, action, target = null, outcome = null, detail = null }) {
  if (!AUDIT_ACTIONS.includes(action)) {
    throw new Error(
      `Unknown audit action "${action}"; expected one of ${AUDIT_ACTIONS.join(', ')}`,
    );
  }
  const { lastInsertRowid } = insertEntry.run(
    new Date().toISOString(),
    actor ?? null,
    action,
    target,
    outcome,
    detail === null ? null : JSON.stringify(detail),
  );
  return Number(lastInsertRowid);
}

/**
 * The newest entries first, with `detail` parsed back from JSON.
 * @param {number} limit maximum number of entries
 * @returns {Array<{ id: number, ts: string, actor: string|null, action: string, target: string|null,
 *   outcome: string|null, detail: object|null }>}
 */
export function listEntries(limit) {
  return selectNewest.all(limit).map((entry) => ({ ...entry, detail: parseDetail(entry.detail) }));
}

// A detail that is not valid JSON (edited by hand) is returned as the raw string
function parseDetail(detail) {
  if (detail === null) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}
