// Owner: Archit | Seal pending records into a batch: build the Merkle tree, publish the root, anchor records
import { buildTree } from '@proofchain/core';
import { db } from '../db/index.js';
import { logAction } from '../lib/auditLog.js';
import { deployment, publishRoot } from '../lib/chain.js';
import { AppError } from '../lib/errors.js';
import { rebuildLeaf } from './integrity.js';

const BATCH_PREFIX = 'BATCH-';
const MAX_BATCH_NUMBER = 9999;

const selectPending = db.prepare(
  "SELECT * FROM records WHERE status = 'pending' ORDER BY record_id",
);
const selectLastBatchId = db
  .prepare('SELECT batch_id FROM batches ORDER BY batch_id DESC LIMIT 1')
  .pluck();
const insertBatch = db.prepare(
  `INSERT INTO batches (batch_id, root, leaf_count, tree_json, tx_hash, block_number, published_at)
   VALUES (@batchId, @root, @leafCount, @treeJson, @txHash, @blockNumber, @publishedAt)`,
);
// Guarded by status and leaf: only the exact pending record that went into the published tree
const anchorRecord = db.prepare(
  `UPDATE records SET status = 'anchored', batch_id = @batchId, leaf_index = @leafIndex
   WHERE record_id = @recordId AND status = 'pending' AND leaf = @leaf`,
);
const selectBatches = db.prepare(
  `SELECT batch_id, root, leaf_count, tx_hash, block_number, published_at
   FROM batches ORDER BY batch_id DESC`,
);
const selectBatchedRecordIds = db.prepare(
  'SELECT batch_id, record_id FROM records WHERE batch_id IS NOT NULL ORDER BY batch_id, leaf_index',
);

// One seal at a time in this process: a second seal would capture the same pending records
let sealInProgress = false;

/**
 * Take all pending records ordered by recordId, build the tree, call publishRoot(batchId, root,
 * leafCount) on RootRegistry, then (one DB transaction) store the batch with every tree level and
 * mark exactly those records anchored. Logs SEAL and PUBLISH to the audit log.
 * @param {string} actor name from X-Actor
 * @returns {Promise<{ batchId: string, root: string, leafCount: number, txHash: string, blockNumber: number }>}
 * @throws {AppError} NOTHING_PENDING (400), SEAL_IN_PROGRESS (409), RECORD_INTEGRITY_FAILED (409),
 *   chain errors from publishRoot (CHAIN_UNREACHABLE 503, BATCH_ALREADY_PUBLISHED 409, CHAIN_REVERTED 502),
 *   ANCHOR_SAVE_FAILED (500) when the root is on chain but the DB write failed
 */
export async function sealBatch(actor) {
  if (sealInProgress) {
    throw new AppError('SEAL_IN_PROGRESS', 409, 'Another seal is running; try again in a moment');
  }
  sealInProgress = true;
  try {
    return await sealPending(actor);
  } finally {
    sealInProgress = false;
  }
}

/**
 * Every batch, newest first, with its recordIds in leaf order.
 * @returns {Array<{ batchId: string, root: string, leafCount: number, txHash: string,
 *   blockNumber: number, publishedAt: string, records: string[] }>}
 */
export function listBatches() {
  const recordsByBatch = Map.groupBy(selectBatchedRecordIds.all(), (row) => row.batch_id);
  return selectBatches.all().map((batch) => ({
    batchId: batch.batch_id,
    root: batch.root,
    leafCount: batch.leaf_count,
    txHash: batch.tx_hash,
    blockNumber: batch.block_number,
    publishedAt: batch.published_at,
    records: (recordsByBatch.get(batch.batch_id) ?? []).map((row) => row.record_id),
  }));
}

async function sealPending(actor) {
  const records = selectPending.all();
  if (records.length === 0) {
    throw new AppError(
      'NOTHING_PENDING',
      400,
      'No pending records to seal; confirm a document first',
    );
  }
  const leaves = rebuildLeavesOrRefuse(records, actor);
  const batchId = nextBatchId();
  const { root, levels } = buildTree(leaves);
  const leafCount = records.length;

  // Chain first: if publishing fails, nothing in the DB changes and the records stay pending
  let anchor;
  try {
    anchor = await publishRoot(batchId, root, leafCount);
  } catch (err) {
    logAction({
      actor,
      action: 'PUBLISH',
      target: batchId,
      outcome: err.code ?? 'ERROR',
      detail: { root, leafCount, message: err.message },
    });
    throw err;
  }

  const batch = {
    batchId,
    root,
    leafCount,
    treeJson: JSON.stringify(levels),
    txHash: anchor.txHash,
    blockNumber: anchor.blockNumber,
    publishedAt: new Date().toISOString(),
  };
  try {
    saveAnchoredBatch(batch, records, leaves, actor);
  } catch (err) {
    throw anchorSaveFailed(batch, err, actor);
  }
  return { batchId, root, leafCount, txHash: batch.txHash, blockNumber: batch.blockNumber };
}

// Never anchor a record whose stored fields no longer produce its stored leaf
function rebuildLeavesOrRefuse(records, actor) {
  const problems = {};
  const leaves = records.map((row) => {
    const { leaf, problem } = rebuildLeaf(row);
    if (problem) problems[row.record_id] = problem;
    else if (leaf !== row.leaf) {
      problems[row.record_id] = 'stored fields no longer rebuild the stored leaf';
    }
    return leaf;
  });
  const recordIds = Object.keys(problems);
  if (recordIds.length > 0) {
    const details = { recordIds, problems };
    logAction({ actor, action: 'SEAL', outcome: 'RECORD_INTEGRITY_FAILED', detail: details });
    throw new AppError(
      'RECORD_INTEGRITY_FAILED',
      409,
      `Refusing to seal: stored data of ${recordIds.join(', ')} changed after confirmation`,
      details,
    );
  }
  return leaves;
}

function nextBatchId() {
  const last = selectLastBatchId.get();
  const next = last ? Number(last.slice(BATCH_PREFIX.length)) + 1 : 1;
  if (!Number.isSafeInteger(next) || next > MAX_BATCH_NUMBER) {
    throw new AppError('BATCH_LIMIT', 409, `Cannot create a batch after ${last}`);
  }
  return BATCH_PREFIX + String(next).padStart(4, '0');
}

const saveAnchoredBatch = db.transaction((batch, records, leaves, actor) => {
  insertBatch.run(batch);
  records.forEach((row, leafIndex) => {
    const { changes } = anchorRecord.run({
      batchId: batch.batchId,
      leafIndex,
      recordId: row.record_id,
      leaf: leaves[leafIndex],
    });
    if (changes !== 1) {
      throw new Error(`${row.record_id} changed while ${batch.batchId} was being published`);
    }
  });
  const { batchId, root, leafCount, txHash, blockNumber } = batch;
  const recordIds = records.map((row) => row.record_id);
  logAction({
    actor,
    action: 'SEAL',
    target: batchId,
    outcome: 'OK',
    detail: { root, leafCount, records: recordIds },
  });
  logAction({
    actor,
    action: 'PUBLISH',
    target: batchId,
    outcome: 'OK',
    detail: {
      root,
      leafCount,
      txHash,
      blockNumber,
      chainId: deployment.chainId,
      contract: deployment.address,
    },
  });
});

// The root is on chain but the DB does not know it, so the next seal would hit BATCH_ALREADY_PUBLISHED
function anchorSaveFailed(batch, cause, actor) {
  const { batchId, txHash, blockNumber } = batch;
  console.error(
    `\n!!! ${batchId} WAS PUBLISHED ON CHAIN (tx ${txHash}, block ${blockNumber}) ` +
      'BUT SAVING IT TO THE DATABASE FAILED. Database and chain are now out of sync; ' +
      'run `npm run reset` to start over.\n',
    cause,
  );
  try {
    logAction({
      actor,
      action: 'PUBLISH',
      target: batchId,
      outcome: 'ANCHOR_SAVE_FAILED',
      detail: { txHash, blockNumber, message: cause.message },
    });
  } catch {
    // Already reported on the console; the DB itself may be what failed
  }
  return new AppError(
    'ANCHOR_SAVE_FAILED',
    500,
    `${batchId} was published on chain (tx ${txHash}) but saving it to the database failed; ` +
      'run `npm run reset` to start over',
    { batchId, txHash, blockNumber },
  );
}
