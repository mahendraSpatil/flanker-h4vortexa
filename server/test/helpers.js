// Owner: Archit | Server test harness: temp DB + storage, fresh chain + deploy, app on a random port
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Wallet } from 'ethers';

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = path.join(SERVER_ROOT, '..');
const EXPECTED_CHAIN_ID = 31337;
const RPC_TIMEOUT_MS = 5000;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const ACTOR = 'server-test';

/**
 * Point the server at a temp DB + storage dir and force AI_MODE=off. Must run BEFORE anything
 * imports server/src (config.js reads the environment once, at import).
 * @returns {{ tempDir: string, storageDir: string, rpcUrl: string }}
 */
export function prepareTestEnv() {
  dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofchain-server-test-'));
  const storageDir = path.join(tempDir, 'storage');
  fs.mkdirSync(storageDir);
  process.env.DB_PATH = path.join(tempDir, 'proofchain.test.db');
  process.env.STORAGE_DIR = storageDir;
  process.env.AI_MODE = 'off';
  return { tempDir, storageDir, rpcUrl: process.env.RPC_URL?.trim() || 'http://127.0.0.1:8545' };
}

/**
 * Why the suite cannot run against this chain, or null when it can.
 * @param {string} rpcUrl
 * @returns {Promise<string|null>}
 */
export async function chainSkipReason(rpcUrl) {
  let chainId;
  try {
    chainId = Number(await rpc(rpcUrl, 'eth_chainId'));
  } catch {
    return `no chain at ${rpcUrl}: start it with \`npm run chain\`, then run \`npm run test:server\``;
  }
  return chainId === EXPECTED_CHAIN_ID
    ? null
    : `the chain at ${rpcUrl} has chainId ${chainId}, expected ${EXPECTED_CHAIN_ID}`;
}

/**
 * hardhat_reset the running node and redeploy RootRegistry with the normal deploy script.
 * Fails fast when PUBLISHER_PRIVATE_KEY is not the deployer (Hardhat account #0).
 * @param {string} rpcUrl
 */
export async function resetChainAndDeploy(rpcUrl) {
  const key = process.env.PUBLISHER_PRIVATE_KEY?.trim() ?? '';
  if (!PRIVATE_KEY.test(key)) {
    throw new Error('server/.env needs PUBLISHER_PRIVATE_KEY (Hardhat account #0) for these tests');
  }
  const [deployer] = await rpc(rpcUrl, 'eth_accounts');
  if (new Wallet(key).address.toLowerCase() !== deployer?.toLowerCase()) {
    throw new Error(`PUBLISHER_PRIVATE_KEY is not Hardhat account #0 (${deployer})`);
  }
  await rpc(rpcUrl, 'hardhat_reset');
  // Single command string, as in scripts/reset.js: Node 24 rejects spawning npm.cmd with args
  const deploy = spawnSync('npm run deploy', { cwd: REPO_ROOT, shell: true, encoding: 'utf8' });
  if (deploy.status !== 0) {
    throw new Error(`npm run deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);
  }
}

/**
 * Import the app (after prepareTestEnv) and listen on a random local port.
 * @param {{ tempDir: string, storageDir: string }} env
 */
export async function startServer({ tempDir, storageDir }) {
  const { createApp } = await import('../src/app.js');
  const { db } = await import('../src/db/index.js');
  const chain = await import('../src/lib/chain.js');
  const core = await import('@proofchain/core');

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  // Next REC- number from the DB, so records uploaded through the API never collide with these
  const lastRecordNumber = db
    .prepare('SELECT MAX(CAST(SUBSTR(record_id, 5) AS INTEGER)) FROM records')
    .pluck();

  return {
    db,
    chain,
    baseUrl,
    pinned: { chainId: chain.deployment.chainId, contract: chain.deployment.address },

    /** fetch with X-Actor; returns { status, headers, text, body } (body = parsed JSON or null) */
    async api(method, urlPath, json) {
      const headers = { 'X-Actor': ACTOR };
      if (json !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(baseUrl + urlPath, {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, body: parseJson(text) };
    },

    /**
     * Store a file and insert it as a confirmed (pending) v2 record, as upload + confirm would:
     * fields normalised in schema order, salted, fieldsRoot in the leaf.
     * @param {{ fields?: Object<string, string> }} doc fields as typed (amounts in rupees)
     */
    insertPending({ fileName, mime, bytes, docType, issuer, date, fields: input = {} }) {
      const recordId = `REC-${String((lastRecordNumber.get() ?? 0) + 1).padStart(6, '0')}`;
      const normalization = core.detectNormalization({ fileName, mime });
      const hash = core.fileHash(bytes, { normalization });
      fs.writeFileSync(path.join(storageDir, hash), bytes);
      const { fields: normalized, errors } = core.normalizeFields(docType, input);
      if (Object.keys(errors).length > 0)
        throw new Error(`fixture fields: ${JSON.stringify(errors)}`);
      const fields = normalized.map((f) => ({
        ...f,
        salt: crypto.randomBytes(16).toString('hex'),
      }));
      const record = {
        recordId,
        fileHash: hash,
        fieldsRoot: core.buildFieldTree(fields).root,
        docType,
        issuer: core.normText(issuer),
        date,
      };
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO records (record_id, file_hash, file_name, mime, status, doc_type, issuer,
           doc_date, leaf, extraction_path, created_by, confirmed_by, created_at, confirmed_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 'fallback', ?, ?, ?, ?)`,
      ).run(
        recordId,
        hash,
        fileName,
        mime,
        docType,
        record.issuer,
        date,
        core.leafHash(record),
        ACTOR,
        ACTOR,
        now,
        now,
      );
      const insertField = db.prepare(
        'INSERT INTO record_fields (record_id, idx, name, value, salt) VALUES (?, ?, ?, ?, ?)',
      );
      fields.forEach((f, idx) => insertField.run(recordId, idx, f.name, f.value, f.salt));
      return { ...record, fields, fileName, mime };
    },

    readStoredFile(hash) {
      return fs.readFileSync(path.join(storageDir, hash));
    },

    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      chain.provider.destroy();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function rpc(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
