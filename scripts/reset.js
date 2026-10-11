// Owner: Archit | Start over: hardhat_reset the chain, wipe the DB + stored uploads, redeploy RootRegistry
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RPC_URL = 'http://127.0.0.1:8545';
const SERVER_HEALTH_URL = 'http://localhost:4000/api/health';
const WIPE_DIRS = ['server/data', 'server/storage'];
const KEEP_FILE = '.gitkeep';
const TIMEOUT_MS = 3000;

function fail(message) {
  console.error(`\nreset failed: ${message}`);
  process.exit(1);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function isServerRunning() {
  try {
    await fetch(SERVER_HEALTH_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

function wipeDir(relativeDir) {
  const dir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir).filter((name) => name !== KEEP_FILE);
  for (const name of entries) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  return entries.length;
}

async function main() {
  // The server holds the SQLite file open: on Windows it cannot be deleted, elsewhere it would go stale.
  if (await isServerRunning()) {
    fail(
      `the API server is running (${SERVER_HEALTH_URL}). Stop it, then run npm run reset again.`,
    );
  }

  try {
    await rpc('eth_chainId');
  } catch {
    fail(`no chain at ${RPC_URL}. Start it in another terminal with npm run chain.`);
  }

  for (const dir of WIPE_DIRS) {
    console.log(`Wiped ${wipeDir(dir)} item(s) from ${dir}`);
  }

  await rpc('hardhat_reset');
  console.log('Chain reset to a fresh state (hardhat_reset)');

  // Single command string: avoids spawning npm.cmd with args, which Node 24 rejects or warns about.
  const deploy = spawnSync('npm run deploy', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (deploy.status !== 0) fail('npm run deploy did not succeed (see output above).');

  console.log('\nReset complete. Next:\n  npm run server\n  npm run seed   (optional demo data)');
}

main().catch((err) => fail(err.message));
