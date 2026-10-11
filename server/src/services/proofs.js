// Owner: Archit | Assemble proof.json for an anchored record from its stored batch tree
import { buildProof, getProof } from '@proofchain/core';
import { db } from '../db/index.js';
import { deployment } from '../lib/chain.js';
import { AppError } from '../lib/errors.js';
import { normalizationOf, parseTree, storedFields, toCoreRecord } from './integrity.js';

const selectRecord = db.prepare('SELECT * FROM records WHERE record_id = ?');
const selectBatch = db.prepare('SELECT * FROM batches WHERE batch_id = ?');

/**
 * proof.json (v2) for one anchored record: the record, its salted fields and its path to the
 * batch root. Reads only the DB (no chain call). issuedAt is the batch's published_at, so repeated
 * downloads are byte-identical.
 * @param {string} recordId
 * @returns {object} proof.json object (shape in CLAUDE.md "proof.json")
 * @throws {AppError} NOT_FOUND (404), NOT_ANCHORED (404), RECORD_INTEGRITY_FAILED (409) when the
 *   stored record no longer folds to its batch root (stored data changed after anchoring)
 */
export function buildRecordProof(recordId) {
  const row = selectRecord.get(recordId);
  if (!row) throw new AppError('NOT_FOUND', 404, `No record ${recordId}`);
  if (row.status !== 'anchored') {
    throw new AppError(
      'NOT_ANCHORED',
      404,
      `${recordId} is ${row.status}; a proof exists only after its batch is sealed`,
      { status: row.status },
    );
  }
  const batch = selectBatch.get(row.batch_id);
  const levels = batch ? parseTree(batch.tree_json) : null;
  if (!levels) throw integrityFailed(row, 'its batch tree is missing or unreadable');

  try {
    return buildProof({
      record: toCoreRecord(row),
      fields: storedFields(row.record_id),
      batchId: batch.batch_id,
      leafIndex: row.leaf_index,
      leafCount: batch.leaf_count,
      siblings: getProof(levels, row.leaf_index),
      root: batch.root,
      anchor: {
        chainId: deployment.chainId,
        contract: deployment.address,
        txHash: batch.tx_hash,
        blockNumber: batch.block_number,
      },
      fileNormalization: normalizationOf(row),
      issuedAt: batch.published_at,
    });
  } catch (err) {
    // INVALID_RECORD / INVALID_PROOF: bad stored fields, or the leaf no longer folds to the root.
    // RangeError: leaf_index is outside the stored tree.
    if (
      err.code === 'INVALID_RECORD' ||
      err.code === 'INVALID_PROOF' ||
      err instanceof RangeError
    ) {
      throw integrityFailed(row, err.message);
    }
    throw err;
  }
}

function integrityFailed(row, reason) {
  return new AppError(
    'RECORD_INTEGRITY_FAILED',
    409,
    `${row.record_id} no longer matches the root of ${row.batch_id}: its stored data changed ` +
      'after anchoring. Run the audit (POST /api/audit) to see what changed.',
    { recordId: row.record_id, batchId: row.batch_id, reason },
  );
}
