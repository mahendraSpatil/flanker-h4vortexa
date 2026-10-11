// Owner: Archit | Read-only JSON-RPC gate in front of the Hardhat node, for the public verifier (/rpc via nginx)
// No dependencies: node:http + global fetch (Node >= 18). Run with: node deploy/rpc-proxy.mjs
import { createServer } from 'node:http';

const HOST = process.env.RPC_PROXY_HOST ?? '127.0.0.1';
const PORT = Number(process.env.RPC_PROXY_PORT ?? 8546);
const UPSTREAM = process.env.RPC_UPSTREAM ?? 'http://127.0.0.1:8545';
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

// Everything the verifier needs to read getBatch() from the pinned contract; nothing that writes or signs.
const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_call',
  'eth_getBlockByNumber',
  'eth_getCode',
]);

class HttpError extends Error {
  constructor(status, rpcCode, message) {
    super(message);
    this.status = status;
    this.rpcCode = rpcCode;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendRpcError(res, status, code, message, id = null) {
  sendJson(res, status, { jsonrpc: '2.0', id, error: { code, message } });
}

/** Read the request body, rejecting anything over MAX_BODY_BYTES without buffering it. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, -32600, 'Request body too large'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data');
        reject(new HttpError(413, -32600, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parse a single request or a batch; returns the list of calls. Throws HttpError on malformed input. */
function parseCalls(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, -32700, 'Parse error');
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0) throw new HttpError(400, -32600, 'Empty batch');
  for (const call of calls) {
    if (call === null || typeof call !== 'object' || Array.isArray(call)) {
      throw new HttpError(400, -32600, 'Invalid request');
    }
  }
  return { calls, isBatch: Array.isArray(parsed) };
}

function rejectedMethods(calls) {
  return calls.map((c) => c.method).filter((m) => typeof m !== 'string' || !ALLOWED_METHODS.has(m));
}

async function forward(body) {
  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  return { status: upstream.status, text: await upstream.text() };
}

async function handle(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendRpcError(res, 405, -32600, 'Method not allowed: use POST');
    return;
  }

  let body, calls, isBatch;
  try {
    body = await readBody(req);
    ({ calls, isBatch } = parseCalls(body));
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 413) res.setHeader('Connection', 'close');
      sendRpcError(res, err.status, err.rpcCode, err.message);
      return;
    }
    throw err;
  }

  const rejected = rejectedMethods(calls);
  if (rejected.length > 0) {
    const client = req.headers['x-real-ip'] ?? req.socket.remoteAddress;
    for (const method of rejected) {
      console.warn(`[rpc-proxy] ${new Date().toISOString()} rejected method ${JSON.stringify(method)} from ${client}`);
    }
    const id = isBatch ? null : (calls[0].id ?? null);
    sendRpcError(res, 403, -32601, `Method not allowed: ${rejected.map(String).join(', ')}`, id);
    return;
  }

  let upstream;
  try {
    upstream = await forward(body);
  } catch (err) {
    console.error(`[rpc-proxy] ${new Date().toISOString()} upstream ${UPSTREAM} unreachable: ${err.message}`);
    const id = isBatch ? null : (calls[0].id ?? null);
    sendRpcError(res, 502, -32603, 'Chain node unreachable', id);
    return;
  }
  res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
  res.end(upstream.text);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`[rpc-proxy] ${new Date().toISOString()} internal error: ${err.stack ?? err}`);
    if (!res.headersSent) sendRpcError(res, 500, -32603, 'Internal error');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[rpc-proxy] listening on http://${HOST}:${PORT} -> ${UPSTREAM} (read-only: ${[...ALLOWED_METHODS].join(', ')})`);
});
