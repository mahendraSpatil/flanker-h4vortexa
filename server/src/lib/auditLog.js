// Owner: Archit (frozen; ask before changing) | Appends an entry to the audit_log table
import { db } from '../db/index.js';

export const AUDIT_ACTIONS = Object.freeze([
  'UPLOAD',
  'CONFIRM',
  'SEAL',
  'PUBLISH',
  'AUDIT',
  'TAMPER',
  'REJECT',
]);

const insertEntry = db.prepare(
  'INSERT INTO audit_log (ts, actor, action, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)',
);

/**
 * Record one action. `detail` is stored as JSON.
 * @param {{ actor: string|null, action: string, target?: string, outcome?: string, detail?: object }} entry
 *   action is one of AUDIT_ACTIONS; target is usually a recordId or batchId; outcome e.g. "OK" or an error code
 */
export function logAction({ actor, action, target = null, outcome = null, detail = null }) {
  if (!AUDIT_ACTIONS.includes(action)) {
    throw new Error(
      `Unknown audit action "${action}"; expected one of ${AUDIT_ACTIONS.join(', ')}`,
    );
  }
  insertEntry.run(
    new Date().toISOString(),
    actor ?? null,
    action,
    target,
    outcome,
    detail === null ? null : JSON.stringify(detail),
  );
}
