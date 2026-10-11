// Owner: Archit (frozen; ask before changing) | Server entry point: start listening and report chain status
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { deployment, isChainReachable } from './lib/chain.js';

const server = createApp().listen(config.port);

server.on('listening', async () => {
  console.log(`ProofChain server on http://localhost:${config.port} (AI_MODE=${config.aiMode})`);
  console.log(`Database: ${db.name}`);
  if (await isChainReachable()) {
    console.log(`Chain OK: RootRegistry at ${deployment.address} on ${config.rpcUrl}`);
  } else {
    console.warn(
      `Chain NOT ready at ${config.rpcUrl} (no RootRegistry at ${deployment.address}).\n` +
        'Start it with `npm run chain`, then `npm run reset` (or `npm run deploy` on a fresh chain).',
    );
  }
});

server.on('error', (err) => {
  console.error(
    err.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Is another server running?`
      : err,
  );
  process.exit(1);
});
