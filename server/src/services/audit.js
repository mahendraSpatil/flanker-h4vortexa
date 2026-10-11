// Owner: Archit | Integrity audit: rebuild every batch from stored data and compare with the chain
import { buildTree } from '@proofchain/core';
import { db } from '../db/index.js';
import { logAction } from '../lib/auditLog.js';
import { listPublishedBatchIds, readBatch } from '../lib/chain.js';
import { hashStoredFile, parseTree, rebuildLeaf } from './integrity.js';

const selectBatches = db.prepare('SELECT * FROM batches ORDER BY batch_id DESC');
const selectBatchRecords = db.prepare(
  'SELECT * FROM records WHERE batch_id = ? ORDER BY leaf_index, record_id',
);

/**
 * @typedef {object} BatchAudit
 * @property {string} batchId
 * @property {'OK' | 'MISMATCH'} status OK only if dbRoot = storedRoot = chainRoot, leafCount =
 *   chainLeafCount = number of records, the stored tree is intact and nothing changed
 * @property {string|null} dbRoot root rebuilt from the records' stored fields (null if a record
 *   no longer forms a valid leaf)
 * @property {string} storedRoot batches.root as saved at seal time
 * @property {string|null} chainRoot root on the pinned contract (null if not published)
 * @property {number} leafCount batches.leaf_count
 * @property {number|null} chainLeafCount
 * @property {string[]} changedRecords rebuilt leaf differs from the leaf stored in tree_json
 * @property {string[]} changedFiles stored file is missing or no longer hashes to file_hash
 */

/**
 * Read-only check of every DB batch against its stored tree, its stored files and the chain.
 * Logs AUDIT with a summary.
 * @param {string} actor name from X-Actor
 * @returns {Promise<{ checkedAt: string, batches: BatchAudit[], onChainOnly: string[] }>} batches
 *   newest first; onChainOnly = batchIds published on chain that the DB does not know
 * @throws {AppError} CHAIN_UNREACHABLE (503)
 */
export async function runAudit(actor) {
  const checkedAt = new Date().toISOString();
  const dbBatches = selectBatches.all();
  const batches = [];
  for (const batch of dbBatches) batches.push(await auditBatch(batch));

  const known = new Set(dbBatches.map((batch) => batch.batch_id));
  const onChainOnly = (await listPublishedBatchIds()).filter((id) => !known.has(id));

  const mismatched = batches.filter((b) => b.status === 'MISMATCH').map((b) => b.batchId);
  logAction({
    actor,
    action: 'AUDIT',
    outcome: mismatched.length === 0 && onChainOnly.length === 0 ? 'OK' : 'MISMATCH',
    detail: {
      checkedAt,
      batches: batches.length,
      mismatched,
      changedRecords: batches.flatMap((b) => b.changedRecords),
      changedFiles: batches.flatMap((b) => b.changedFiles),
      onChainOnly,
    },
  });
  return { checkedAt, batches, onChainOnly };
}

/** @returns {Promise<BatchAudit>} */
async function auditBatch(batch) {
  const records = selectBatchRecords.all(batch.batch_id);
  const storedLevels = parseTree(batch.tree_json);
  const storedLeaves = storedLevels?.[0] ?? [];

  const rebuilt = records.map((row) => rebuildLeaf(row).leaf);
  const changedRecords = records
    .filter((row, i) => rebuilt[i] === null || rebuilt[i] !== storedLeaves[row.leaf_index])
    .map((row) => row.record_id);
  const changedFiles = await findChangedFiles(records);

  const dbRoot = rebuilt.length > 0 && !rebuilt.includes(null) ? buildTree(rebuilt).root : null;
  const chain = await readBatch(batch.batch_id);
  const chainRoot = chain?.root ?? null;
  const chainLeafCount = chain?.leafCount ?? null;

  const ok =
    storedLevels !== null &&
    dbRoot !== null &&
    dbRoot === batch.root &&
    batch.root === chainRoot &&
    batch.leaf_count === chainLeafCount &&
    batch.leaf_count === records.length &&
    hasLeafIndexes(records) &&
    changedRecords.length === 0 &&
    changedFiles.length === 0;

  return {
    batchId: batch.batch_id,
    status: ok ? 'OK' : 'MISMATCH',
    dbRoot,
    storedRoot: batch.root,
    chainRoot,
    leafCount: batch.leaf_count,
    chainLeafCount,
    changedRecords,
    changedFiles,
  };
}

async function findChangedFiles(records) {
  const hashes = await Promise.all(records.map(hashStoredFile));
  return records
    .filter((row, i) => hashes[i].fileHash !== row.file_hash)
    .map((row) => row.record_id);
}

// Records are in leaf_index order, so a complete batch has exactly 0, 1, ..., n-1
function hasLeafIndexes(records) {
  return records.every((row, i) => row.leaf_index === i);
}
