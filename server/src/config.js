// Owner: Archit (frozen; ask before changing) | Loads server/.env, validates it and exports a frozen config
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const AI_MODES = ['gemini', 'off'];
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });

function loadConfig(env) {
  const errors = [];
  const port = Number(env.PORT ?? 4000);
  const rpcUrl = env.RPC_URL?.trim() || 'http://127.0.0.1:8545';
  const publisherPrivateKey = env.PUBLISHER_PRIVATE_KEY?.trim() ?? '';
  const geminiApiKey = env.GEMINI_API_KEY?.trim() ?? '';
  const aiMode = (env.AI_MODE?.trim() || 'gemini').toLowerCase();

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be an integer 1-65535, got "${env.PORT}"`);
  }
  if (!/^https?:\/\//.test(rpcUrl)) {
    errors.push(`RPC_URL must be an http(s) URL, got "${rpcUrl}"`);
  }
  if (!PRIVATE_KEY.test(publisherPrivateKey)) {
    errors.push(
      'PUBLISHER_PRIVATE_KEY must be 0x + 64 hex chars (Hardhat account #0, printed by `npm run chain`)',
    );
  }
  if (!AI_MODES.includes(aiMode)) {
    errors.push(`AI_MODE must be one of ${AI_MODES.join(' | ')}, got "${aiMode}"`);
  }
  if (aiMode === 'gemini' && !geminiApiKey) {
    errors.push(
      'GEMINI_API_KEY is required when AI_MODE=gemini (or set AI_MODE=off to use the fallback)',
    );
  }

  return {
    errors,
    config: Object.freeze({
      port,
      rpcUrl,
      publisherPrivateKey,
      geminiApiKey,
      aiMode,
      // DB_PATH / STORAGE_DIR override the defaults (server/test points them at a temp directory)
      dbPath: path.resolve(env.DB_PATH?.trim() || path.join(SERVER_ROOT, 'data', 'proofchain.db')),
      storageDir: path.resolve(env.STORAGE_DIR?.trim() || path.join(SERVER_ROOT, 'storage')),
    }),
  };
}

const { config, errors } = loadConfig(process.env);

if (errors.length > 0) {
  console.error(
    `Invalid server configuration (${path.join(SERVER_ROOT, '.env')}):\n` +
      errors.map((e) => `  - ${e}`).join('\n') +
      '\nCopy server/.env.example to server/.env and fill in the values.',
  );
  process.exit(1);
}

export { config };
