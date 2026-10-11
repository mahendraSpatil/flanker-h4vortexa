// Owner: Archit | API tests against a live local chain: seal, proofs, batches, audit, tamper, audit log
// Needs `npm run chain` running. Resets that chain (hardhat_reset + deploy) and uses a temp DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { HEX32, verify } from '@proofchain/core';
import { ZeroHash } from 'ethers';
import { chainSkipReason, prepareTestEnv, resetChainAndDeploy, startServer } from './helpers.js';

const env = prepareTestEnv();
const skipReason = await chainSkipReason(env.rpcUrl);
if (skipReason) {
  console.warn(`Skipping server tests: ${skipReason}`);
  fs.rmSync(env.tempDir, { recursive: true, force: true });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_ROOT = '0x' + 'ab'.repeat(32);

// Fictional documents; .txt has CRLF, trailing blanks and a messy issuer to exercise normalisation
function fixture(n) {
  const date = `2026-0${(n % 9) + 1}-14`;
  if (n % 3 === 1) {
    return {
      fileName: `marksheet-${n}.txt`,
      mime: 'text/plain',
      bytes: Buffer.from(`Fictional marksheet #${n}  \r\nSemester 5\t\r\n\r\n`),
      docType: 'MARKSHEET',
      issuer: '  Northfield   College of Engineering ',
      date,
    };
  }
  if (n % 3 === 2) {
    return {
      fileName: `degree-${n}.png`,
      mime: 'image/png',
      bytes: Buffer.concat([PNG_SIGNATURE, Buffer.from(`fictional degree certificate #${n}`)]),
      docType: 'DEGREE_CERTIFICATE',
      issuer: 'Pimpri Institute of Technology',
      date,
    };
  }
  return {
    fileName: `salary-slip-${n}.pdf`,
    mime: 'application/pdf',
    bytes: Buffer.from(`%PDF-1.4\n% Fictional salary slip #${n}: Rs 50,000\n%%EOF\n`),
    docType: 'SALARY_SLIP',
    issuer: 'Acme Analytics Pvt Ltd',
    date,
  };
}

describe('server API on a live chain', { skip: skipReason ?? false }, () => {
  let t;
  const records = []; // every record anchored so far, in recordId order
  const proofs = new Map(); // recordId -> { text, proof } of the first download

  const sealViaApi = () => t.api('POST', '/api/batches/seal');
  const audit = async () => (await t.api('POST', '/api/audit')).body;
  const batchAudit = (result, batchId) => result.batches.find((b) => b.batchId === batchId);
  const issuerOf = (recordId) =>
    t.db.prepare('SELECT issuer FROM records WHERE record_id = ?').pluck().get(recordId);

  async function verifyStored(record, proof) {
    return verify({
      fileBytes: t.readStoredFile(record.fileHash),
      proof,
      chainBatch: await t.chain.readBatch(proof.batchId),
      pinned: t.pinned,
    });
  }

  // Download each record's proof twice and check it verifies against the chain
  async function downloadAndVerify(batchRecords) {
    for (const record of batchRecords) {
      const res = await t.api('GET', `/api/documents/${record.recordId}/proof`);
      assert.equal(res.status, 200, res.text);
      // Express quotes the filename only when it needs to
      assert.equal(
        res.headers.get('content-disposition').replaceAll('"', ''),
        `attachment; filename=${record.recordId}.proof.json`,
      );
      const again = await t.api('GET', `/api/documents/${record.recordId}/proof`);
      assert.equal(again.text, res.text, 'repeated downloads are byte-identical');
      const result = await verifyStored(record, res.body);
      assert.equal(result.verdict, 'VALID', JSON.stringify(result.checks, null, 2));
      proofs.set(record.recordId, { text: res.text, proof: res.body });
    }
  }

  before(async () => {
    await resetChainAndDeploy(env.rpcUrl);
    t = await startServer(env);
  });

  after(async () => {
    if (t) await t.stop();
    else fs.rmSync(env.tempDir, { recursive: true, force: true });
    console.log(
      'Note: the server tests reset the local chain. Run `npm run reset` before using the dev server.',
    );
  });

  it('seals 5 pending records into BATCH-0001 with the same root in the DB and on chain', async () => {
    for (let n = 1; n <= 5; n++) records.push(t.insertPending(fixture(n)));

    const res = await sealViaApi();
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.batchId, 'BATCH-0001');
    assert.equal(res.body.leafCount, 5);
    assert.match(res.body.root, HEX32);
    assert.match(res.body.txHash, HEX32);
    assert.ok(Number.isInteger(res.body.blockNumber));

    const dbRoot = t.db.prepare("SELECT root FROM batches WHERE batch_id = 'BATCH-0001'").pluck();
    const onChain = await t.chain.readBatch('BATCH-0001');
    assert.equal(dbRoot.get(), res.body.root);
    assert.equal(onChain.root, res.body.root);
    assert.equal(onChain.leafCount, 5);

    const rows = t.db
      .prepare('SELECT record_id, status, batch_id, leaf_index FROM records ORDER BY record_id')
      .all();
    assert.deepEqual(
      rows,
      records.map((r, i) => ({
        record_id: r.recordId,
        status: 'anchored',
        batch_id: 'BATCH-0001',
        leaf_index: i,
      })),
    );
  });

  it('serves a proof for every anchored record that verify() accepts against the chain', async () => {
    await downloadAndVerify(records);
    assert.equal(proofs.get('REC-000001').proof.scheme.fileNormalization, 'text-v1');
    assert.equal(proofs.get('REC-000002').proof.scheme.fileNormalization, 'none');
    assert.equal(
      proofs.get('REC-000001').proof.metadata.issuer,
      'Northfield College of Engineering',
    );
  });

  it('seals the next 3 pending records into BATCH-0002 and lists batches newest first', async () => {
    const batch2 = [6, 7, 8].map((n) => t.insertPending(fixture(n)));

    const notAnchored = await t.api('GET', `/api/documents/${batch2[0].recordId}/proof`);
    assert.equal(notAnchored.status, 404);
    assert.equal(notAnchored.body.error, 'NOT_ANCHORED');
    const unknown = await t.api('GET', '/api/documents/REC-999999/proof');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, 'NOT_FOUND');

    const res = await sealViaApi();
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.batchId, 'BATCH-0002');
    assert.equal(res.body.leafCount, 3);

    const list = await t.api('GET', '/api/batches');
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.map((b) => [b.batchId, b.leafCount, b.records]),
      [
        ['BATCH-0002', 3, batch2.map((r) => r.recordId)],
        ['BATCH-0001', 5, records.map((r) => r.recordId)],
      ],
    );
    const [newest] = list.body;
    assert.equal(newest.root, res.body.root);
    assert.equal(newest.txHash, res.body.txHash);
    assert.equal(newest.blockNumber, res.body.blockNumber);
    assert.ok(!Number.isNaN(Date.parse(newest.publishedAt)));

    records.push(...batch2);
    await downloadAndVerify(batch2);
  });

  it('refuses to seal when nothing is pending', async () => {
    const res = await sealViaApi();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'NOTHING_PENDING');
  });

  it('audits untouched batches as OK', async () => {
    const result = await audit();
    assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
    assert.deepEqual(
      result.batches.map((b) => [b.batchId, b.status]),
      [
        ['BATCH-0002', 'OK'],
        ['BATCH-0001', 'OK'],
      ],
    );
    for (const b of result.batches) {
      assert.equal(b.dbRoot, b.chainRoot);
      assert.equal(b.storedRoot, b.chainRoot);
      assert.equal(b.leafCount, b.chainLeafCount);
      assert.deepEqual([b.changedRecords, b.changedFiles], [[], []]);
    }
    assert.deepEqual(result.onChainOnly, []);
  });

  it('db_metadata tamper: proof endpoint refuses, audit names the record, verifier unaffected', async () => {
    const target = records[1];
    const res = await t.api('POST', '/api/demo/tamper', {
      type: 'db_metadata',
      recordId: target.recordId,
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.detail.original, target.issuer);
    assert.notEqual(res.body.detail.tampered, target.issuer);
    assert.equal(issuerOf(target.recordId), res.body.detail.tampered);

    const proof = await t.api('GET', `/api/documents/${target.recordId}/proof`);
    assert.equal(proof.status, 409);
    assert.equal(proof.body.error, 'RECORD_INTEGRITY_FAILED');

    const result = await audit();
    const batch1 = batchAudit(result, 'BATCH-0001');
    assert.equal(batch1.status, 'MISMATCH');
    assert.deepEqual(batch1.changedRecords, [target.recordId]);
    assert.deepEqual(batch1.changedFiles, []);
    assert.notEqual(batch1.dbRoot, batch1.chainRoot);
    assert.equal(batch1.storedRoot, batch1.chainRoot);
    assert.equal(batchAudit(result, 'BATCH-0002').status, 'OK');

    // The verifier never reads the DB: the genuine file + proof still pass, the DB's version cannot
    const { proof: genuine } = proofs.get(target.recordId);
    assert.equal((await verifyStored(target, genuine)).verdict, 'VALID');
    const forged = {
      ...genuine,
      metadata: { ...genuine.metadata, issuer: res.body.detail.tampered },
    };
    assert.equal((await verifyStored(target, forged)).verdict, 'METADATA_MODIFIED');
  });

  it('restore undoes the latest tamper and the audit is OK again', async () => {
    const target = records[1];
    const res = await t.api('POST', '/api/demo/tamper', {
      type: 'restore',
      recordId: target.recordId,
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.detail.undid, 'db_metadata');
    assert.equal(issuerOf(target.recordId), target.issuer);

    const proof = await t.api('GET', `/api/documents/${target.recordId}/proof`);
    assert.equal(proof.text, proofs.get(target.recordId).text);
    assert.ok((await audit()).batches.every((b) => b.status === 'OK'));

    const again = await t.api('POST', '/api/demo/tamper', {
      type: 'restore',
      recordId: target.recordId,
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'NOTHING_TO_RESTORE');
  });

  it('stored_file tamper: audit names the file, verifier rejects it, restore fixes it', async () => {
    const target = records[5];
    const original = t.readStoredFile(target.fileHash);
    const res = await t.api('POST', '/api/demo/tamper', {
      type: 'stored_file',
      recordId: target.recordId,
    });
    assert.equal(res.status, 200, res.text);
    const { offset, originalByte, tamperedByte } = res.body.detail;
    assert.equal(offset, Math.floor(original.length / 2));
    assert.equal(originalByte, original[offset]);
    assert.equal(t.readStoredFile(target.fileHash)[offset], tamperedByte);

    const batch2 = batchAudit(await audit(), 'BATCH-0002');
    assert.equal(batch2.status, 'MISMATCH');
    assert.deepEqual(batch2.changedFiles, [target.recordId]);
    assert.deepEqual(batch2.changedRecords, []);
    assert.equal(batch2.dbRoot, batch2.chainRoot);

    const { proof } = proofs.get(target.recordId);
    assert.equal((await verifyStored(target, proof)).verdict, 'DOCUMENT_MODIFIED');

    const restore = await t.api('POST', '/api/demo/tamper', {
      type: 'restore',
      recordId: target.recordId,
    });
    assert.equal(restore.status, 200, restore.text);
    assert.deepEqual(t.readStoredFile(target.fileHash), original);
    assert.ok((await audit()).batches.every((b) => b.status === 'OK'));
  });

  it('rejects an unknown tamper type or record', async () => {
    const badType = await t.api('POST', '/api/demo/tamper', {
      type: 'chain',
      recordId: 'REC-000001',
    });
    assert.equal(badType.status, 400);
    assert.equal(badType.body.error, 'VALIDATION');
    assert.ok(badType.body.details.type);

    const unknown = await t.api('POST', '/api/demo/tamper', {
      type: 'db_metadata',
      recordId: 'REC-999999',
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, 'NOT_FOUND');
  });

  it('serialises seals: a concurrent seal gets SEAL_IN_PROGRESS', async () => {
    const { sealBatch } = await import('../src/services/batching.js');
    records.push(t.insertPending(fixture(9)));

    const first = sealBatch('server-test');
    await assert.rejects(sealBatch('server-test'), { code: 'SEAL_IN_PROGRESS', status: 409 });
    assert.equal((await first).batchId, 'BATCH-0003');
  });

  it('refuses to seal a pending record whose stored fields were edited', async () => {
    const record = t.insertPending(fixture(10));
    t.db
      .prepare('UPDATE records SET issuer = ? WHERE record_id = ?')
      .run('Someone Else University', record.recordId);

    const res = await sealViaApi();
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'RECORD_INTEGRITY_FAILED');
    assert.deepEqual(res.body.details.recordIds, [record.recordId]);

    const status = t.db.prepare('SELECT status FROM records WHERE record_id = ?').pluck();
    assert.equal(status.get(record.recordId), 'pending');
    const batchCount = t.db.prepare('SELECT COUNT(*) FROM batches').pluck().get();
    assert.equal(batchCount, 3);
    assert.equal(await t.chain.readBatch('BATCH-0004'), null);
  });

  it('maps chain reverts to API errors and audits roots the DB does not know', async () => {
    await assert.rejects(t.chain.publishRoot('BATCH-0001', FAKE_ROOT, 1), {
      code: 'BATCH_ALREADY_PUBLISHED',
      status: 409,
    });
    await assert.rejects(t.chain.publishRoot('BATCH-0098', ZeroHash, 1), {
      code: 'CHAIN_REVERTED',
      status: 502,
      details: { reason: 'Invalid batch' },
    });

    await t.chain.publishRoot('BATCH-0099', FAKE_ROOT, 1);
    const result = await audit();
    assert.deepEqual(result.onChainOnly, ['BATCH-0099']);
    assert.ok(result.batches.every((b) => b.status === 'OK'));
  });

  it('lists the audit log newest first with parsed details', async () => {
    const res = await t.api('GET', '/api/audit-log');
    assert.equal(res.status, 200);
    const ids = res.body.map((entry) => entry.id);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => b - a),
    );
    assert.equal(res.body[0].action, 'AUDIT');

    const actions = new Set(res.body.map((entry) => entry.action));
    for (const action of ['SEAL', 'PUBLISH', 'TAMPER', 'RESTORE', 'AUDIT']) {
      assert.ok(actions.has(action), `audit log has ${action}`);
    }
    const tamper = res.body.find((entry) => entry.action === 'TAMPER');
    assert.equal(typeof tamper.detail, 'object');
    assert.ok(
      res.body.some((e) => e.action === 'SEAL' && e.outcome === 'RECORD_INTEGRITY_FAILED'),
      'refused seal is logged',
    );

    const limited = await t.api('GET', '/api/audit-log?limit=2');
    assert.deepEqual(
      limited.body.map((entry) => entry.id),
      ids.slice(0, 2),
    );
    for (const bad of ['0', 'abc', '1.5']) {
      const invalid = await t.api('GET', `/api/audit-log?limit=${bad}`);
      assert.equal(invalid.status, 400, `limit=${bad}`);
      assert.equal(invalid.body.error, 'VALIDATION');
    }
  });
});
