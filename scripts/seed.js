// Owner: Neel | Uploads + confirms the samples through the API and seals two batches
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_BASE = 'http://localhost:4000/api';
const ACTOR = 'Neel';
const MANIFEST_PATH = path.join(ROOT, 'samples', 'manifest.json');

function fail(msg) {
  console.error(`\n❌ seed failed: ${msg}`);
  process.exit(1);
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'X-Actor': ACTOR,
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg = data?.message || data?.error || res.statusText;
    throw new Error(`${options.method || 'GET'} ${endpoint} [${res.status}]: ${errorMsg}`);
  }
  return data;
}

async function uploadFile(fileName) {
  const filePath = path.join(ROOT, 'samples', fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Sample file not found: ${filePath}`);
  }

  const bytes = fs.readFileSync(filePath);
  const blob = new Blob([bytes]);
  const formData = new FormData();
  formData.append('file', blob, fileName);

  return request('/documents', {
    method: 'POST',
    body: formData,
  });
}

async function confirmRecord(recordId, metadata) {
  return request(`/documents/${encodeURIComponent(recordId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docType: metadata.docType,
      issuer: metadata.issuer,
      date: metadata.date,
    }),
  });
}

async function sealBatch() {
  return request('/batches/seal', {
    method: 'POST',
  });
}

async function main() {
  console.log('🌱 Starting ProofChain demo database seed...');

  // 1. Health check
  try {
    const health = await request('/health');
    console.log(`✓ API server healthy (chain: ${health.chain}, contract: ${health.contract?.slice(0, 10)}…)`);
  } catch {
    fail('API server is not reachable at http://localhost:4000.\nPlease run `npm run server` in another terminal first.');
  }

  // 2. Read manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`manifest.json not found at ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const docs = manifest.documents || [];

  if (docs.length < 9) {
    fail(`Expected at least 9 documents in manifest, found ${docs.length}`);
  }

  // Target structure:
  // Batch 1: docs[0..4] (5 documents)
  // Batch 2: docs[5..8] (4 documents)
  // Pending: docs[9..] (3 documents)
  const batch1Docs = docs.slice(0, 5);
  const batch2Docs = docs.slice(5, 9);
  const pendingDocs = docs.slice(9);

  // Group 1 -> BATCH-0001
  console.log('\n📦 [1/3] Uploading & confirming Batch 1 documents (5 items)...');
  for (const doc of batch1Docs) {
    process.stdout.write(`  • Uploading ${doc.file}... `);
    const uploaded = await uploadFile(doc.file);
    process.stdout.write(`(${uploaded.recordId}) → Confirming... `);
    await confirmRecord(uploaded.recordId, doc);
    console.log('✓ pending');
  }

  console.log('  🔒 Sealing BATCH-0001...');
  const batch1 = await sealBatch();
  console.log(`  ✓ Sealed ${batch1.batchId}: root ${batch1.root.slice(0, 14)}… (tx: ${batch1.txHash?.slice(0, 10)}…, block ${batch1.blockNumber})`);

  // Group 2 -> BATCH-0002
  console.log('\n📦 [2/3] Uploading & confirming Batch 2 documents (4 items)...');
  for (const doc of batch2Docs) {
    process.stdout.write(`  • Uploading ${doc.file}... `);
    const uploaded = await uploadFile(doc.file);
    process.stdout.write(`(${uploaded.recordId}) → Confirming... `);
    await confirmRecord(uploaded.recordId, doc);
    console.log('✓ pending');
  }

  console.log('  🔒 Sealing BATCH-0002...');
  const batch2 = await sealBatch();
  console.log(`  ✓ Sealed ${batch2.batchId}: root ${batch2.root.slice(0, 14)}… (tx: ${batch2.txHash?.slice(0, 10)}…, block ${batch2.blockNumber})`);

  // Group 3 -> Pending
  console.log('\n📦 [3/3] Uploading & confirming Pending records (unsealed)...');
  for (const doc of pendingDocs) {
    process.stdout.write(`  • Uploading ${doc.file}... `);
    const uploaded = await uploadFile(doc.file);
    process.stdout.write(`(${uploaded.recordId}) → Confirming... `);
    await confirmRecord(uploaded.recordId, doc);
    console.log('✓ pending');
  }

  console.log('\n🎉 Seed complete!');
  console.log('Summary:');
  console.log(`  • ${batch1.batchId}: 5 records (anchored)`);
  console.log(`  • ${batch2.batchId}: 4 records (anchored)`);
  console.log(`  • Pending: ${pendingDocs.length} records (ready to seal on Batches page)`);
  console.log('\nReady for demo! Open web app at http://localhost:5173 and verifier at http://localhost:5174');
}

main().catch((err) => fail(err.stack || err.message));
