# ProofChain: Team Context & Spec (VORTEXA 3.0, B-01)

> This file is the **source of truth** for every format, field name, result code, API and ownership rule in this repository. `README.md` and `docs/concepts.md` explain; this file decides. If anything conflicts, this file wins. Do not change the locked sections without telling all three team members.

## What we're building

ProofChain is a document registry where anyone can prove a document is exactly the one that was registered, using only the file, a small `proof.json`, and a root published on a blockchain the registry cannot rewrite. It answers VORTEXA 3.0 problem **B-01 (ProofChain: Verifiable Records & Tamper Detection)**.

**The pitch:** an issuer (a college, an employer) uploads documents. AI suggests metadata (issuer, date, type) and a person confirms it. Documents are grouped into batches; each batch becomes a Merkle tree, and only its 32-byte root goes on-chain. Every document gets a `proof.json`. A separate verifier, which never touches our database, takes the document plus its proof, reads the root from the chain, and says exactly what is wrong if anything is: document modified, metadata modified, invalid proof, or root mismatch.

**What verification proves:** this exact file, with these confirmed details, was registered by this registry in this batch.

**What it does not prove:** that the contents are true, or who wrote the document.

**Team:** Archit (Claude Code), Mahendra (Claude Code), Neel (Gemini). Fresh repo; ideas and small pieces may be borrowed from the team's earlier Veritas Ledger project (hashing, Hardhat setup, certificate PDF).

---

## How the system works, start to end

A document moves through three states: `draft` (uploaded) → `pending` (metadata confirmed) → `anchored` (its batch root is on-chain). It is then verified independently. OCR and AI only organise documents; they never go into a hash.

**Registration (registry app + server)**

1. **Upload.** Validate type (PDF, PNG/JPG, TXT) and size (max 10 MB). Compute `fileHash = SHA-256(raw bytes)` immediately. For `.txt` files the text-v1 rule applies (see Hashing).
2. **Duplicate check.** If `fileHash` exists, return 409 with the existing recordId and batch.
3. **Store** the file at `server/storage/<fileHash>` and save the record as `draft`.
4. **Extract text.** PDF text layer first (pdf-parse); OCR (tesseract.js) only when there is no text layer or the file is an image.
5. **AI suggests metadata** (docType, issuer, date) with confidence and the source line it came from. If AI is off or fails, a regex/keyword fallback runs. Record which path ran.
6. **Human confirms** on a confirm screen: edit or accept each field. Validate against the rules (docType enum, ISO date not in the future, issuer not empty).
7. **Build the canonical record and its leaf** (see Locked formats). Record becomes `pending`.

**Batching and publishing (server + contract)**

8. **Seal batch** (button). Take all `pending` records ordered by recordId, build the Merkle tree, store every level.
9. **Publish** `publishRoot(batchId, root, leafCount)` to the local Hardhat chain. Write-once: the contract refuses to overwrite.
10. **Anchor.** Save txHash and block number; records become `anchored`.
11. **Issue proofs.** Each record gets a downloadable `proof.json` (and optionally a receipt PDF with a QR).

**Verification (separate verifier app, no registry API or DB)**

12. The user drops in the **document** + its **proof.json**.
13. The verifier hashes the file in the browser and reads `getBatch(batchId)` **directly from the pinned contract**.
14. It runs checks 0–4 (see Verification) and shows every check with computed vs expected values.
15. A plain-language explanation of any failure is shown (deterministic template inside the verifier; no AI, no server call). It never changes the result.

**Integrity audit (server)**

16. **Audit** recomputes every batch's root from the DB and compares it with the chain. Any batch that differs is flagged, with the exact records whose leaves changed. This catches "stored record no longer matches its published reference".

**Tamper demo** buttons: flip a byte in a stored file, edit a record's issuer in the DB, corrupt one sibling in a proof, swap in a fake root. Each must fail at the right check, and the verifier must still reject a tampered document after the DB is altered.

---

## Merkle trees in this project

Our tree is built **across documents**: one leaf per document record, one root per batch. It is not a tree over the parts of a single document (that is the redaction use case, a stretch goal only).

```
               ROOT            <- only this goes on-chain (32 bytes)
             /      \
          N01        N23
         /   \      /   \
       L0    L1   L2    L3     <- one leaf per document record
```

- **Leaf** = `SHA-256(0x00 ‖ canonicalJSON(record))`. The record includes `fileHash` **and** the confirmed metadata, so the leaf locks both the exact file and its confirmed details.
- **Internal node** = `SHA-256(0x01 ‖ left ‖ right)`, where `left` and `right` are the **raw 32 bytes**, not hex strings.
- **Why the prefixes:** `0x00`/`0x01` make a leaf hash and a node hash impossible to confuse, so nobody can pass off an internal node as a document.
- **Order:** leaves sorted by `recordId` ascending within the batch.
- **Odd node rule:** an unpaired node at any level is **promoted unchanged** to the next level (no duplication). Its proof simply has no sibling at that level.
- **Proof** = the sibling hash at each level from the leaf up, each tagged `left` or `right` (the sibling's side). For 1,000,000 documents that is 20 siblings, 640 bytes, 20 hashes to check.
- **Where it lives:** SQLite stores every record and every tree level; the contract stores only `root` + `leafCount`; `proof.json` holds one leaf and its path. Proofs are generated from the stored tree on request.

**Folding a proof (record 1 above):**

```
h = L1
h = SHA-256(0x01 ‖ L0 ‖ h)    // sibling L0 is on the left  -> N01
h = SHA-256(0x01 ‖ h ‖ N23)   // sibling N23 is on the right -> ROOT
```

---

## Locked formats (do not change without telling all three)

Everyone imports these from `@proofchain/core`; nobody re-implements them. A one-character difference here breaks every proof.

**Canonical record**

```json
{"date":"2026-06-14","docType":"DEGREE_CERTIFICATE","fileHash":"0x9b2c...e41a","issuer":"Pimpri Institute of Technology","recordId":"REC-000002","v":1}
```

| Field | Rule |
| --- | --- |
| `v` | integer `1` (scheme version) |
| `recordId` | `REC-` + 6-digit zero-padded counter, e.g. `REC-000002` (sorts correctly as a string) |
| `fileHash` | `0x` + 64 lowercase hex chars |
| `docType` | one of: `DEGREE_CERTIFICATE`, `MARKSHEET`, `SALARY_SLIP`, `OFFER_LETTER`, `EXPERIENCE_LETTER`, `OTHER` |
| `issuer` | Unicode NFC, trimmed, inner whitespace collapsed to one space, 1–120 chars |
| `date` | `YYYY-MM-DD`, valid calendar date, not in the future |

**canonicalJSON rules (`json-sorted-v1`):** keys sorted A→Z, no whitespace, UTF-8, no extra fields, values already normalised as above. For our flat record this is byte-identical to RFC 8785 (JCS).

**Hashing**

- `fileHash = SHA-256(bytes)`, where `fileNormalization` (recorded in `proof.scheme`) says which bytes: `"none"` = the raw file; `"text-v1"` = the file after the rule below. `detectNormalization({ fileName, mime })` picks it at upload (`"text-v1"` for a `.txt` name or `text/plain` MIME, else `"none"`); `verify()` applies the value in the proof.
- **`text-v1`** (`normalizeTextFile`): decode as UTF-8, strictly (invalid UTF-8 → error `INVALID_TEXT_ENCODING`; reject the upload); strip one leading BOM; convert CRLF and lone CR to LF; remove spaces and tabs at the end of every line; remove trailing newlines at end of file; apply Unicode NFC; re-encode as UTF-8.
- `leaf = SHA-256(0x00 ‖ utf8(canonicalJSON(record)))`
- `node = SHA-256(0x01 ‖ leftBytes ‖ rightBytes)` (32 raw bytes each)
- All hashes shown and stored as `0x` + lowercase hex.

**Batch IDs:** `BATCH-0001`, `BATCH-0002`, … On-chain key = `ethers.encodeBytes32String(batchId)`.

**Reference implementation (`core/src/canonical.js`):**

```javascript
// Normalise one string field: NFC, trim, collapse inner whitespace
export const normText = (s) => s.normalize('NFC').trim().replace(/\s+/g, ' ');

// Build the canonical JSON string for a record (flat object, keys sorted)
export function canonicalJSON(record) {
  const r = {
    v: 1,
    recordId: record.recordId,
    fileHash: record.fileHash.toLowerCase(),
    docType: record.docType,
    issuer: normText(record.issuer),
    date: record.date,
  };
  const keys = Object.keys(r).sort(); // A -> Z
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(r[k])).join(',') + '}';
}
```

---

## proof.json

`proof.json` is the receipt that travels with a document. It contains no file content, only what is needed to recompute the path from the document to the on-chain root. Every field in it is untrusted; the only trusted input is the root the verifier reads from the pinned contract.

```json
{
  "v": 1,
  "scheme": {
    "hash": "sha256",
    "leafPrefix": "0x00",
    "nodePrefix": "0x01",
    "canonicalization": "json-sorted-v1",
    "oddNode": "promote",
    "fileNormalization": "none"
  },
  "recordId": "REC-000002",
  "metadata": {
    "docType": "DEGREE_CERTIFICATE",
    "issuer": "Pimpri Institute of Technology",
    "date": "2026-06-14"
  },
  "fileHash": "0x9b2c...e41a",
  "leaf": "0x4d7f...08c3",
  "batchId": "BATCH-0007",
  "leafIndex": 1,
  "leafCount": 4,
  "siblings": [
    { "hash": "0xa1e0...77b2", "pos": "left" },
    { "hash": "0x5c93...d1f0", "pos": "right" }
  ],
  "root": "0xe82d...3a96",
  "anchor": {
    "chainId": 31337,
    "contract": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "txHash": "0x7c1b...9e02",
    "blockNumber": 12
  },
  "issuedAt": "2026-10-11T12:40:00Z"
}
```

Real hashes are 64 hex characters; they are shortened here.

| Field | Purpose | Check |
| --- | --- | --- |
| `v`, `scheme` | Exact hashing rules, so anyone can reproduce them | 0 |
| `fileHash` | SHA-256 of the registered file | 1 |
| `recordId` + `metadata` | Confirmed fields that went into the leaf | 2 |
| `leaf` | Expected leaf hash | 2 |
| `siblings` | One hash per level, bottom to top; `pos` = the sibling's side | 3 |
| `leafIndex`, `leafCount` | Position in the batch; sanity-check path length | 0, 3 |
| `root` | Root this proof claims to reach | 3, 4 |
| `batchId` | Which on-chain root to look up | 4 |
| `anchor` | **Display only.** Verifier never trusts it; it uses its own pinned chainId + contract | 0b |

---

## Verification checks and result codes

A document is valid **only if the root computed from the uploaded file equals the root stored on the pinned contract**. Checks 1–3 only diagnose which part was tampered; check 4 is where trust comes from. Run all checks, show each result, and report the first failure as the verdict.

| # | Check | Fails with |
| --- | --- | --- |
| 0 | proof.json well-formed: fields present, hex lengths, `v`, scheme matches ours, `leafIndex < leafCount`, siblings count matches expected path length | `FORMAT_INVALID` |
| 0b | `anchor.chainId` + `anchor.contract` equal the verifier's **pinned** values | `REGISTRY_MISMATCH` |
| 1 | SHA-256 of uploaded file = `proof.fileHash` | `DOCUMENT_MODIFIED` |
| 2 | leaf rebuilt from fileHash + recordId + metadata = `proof.leaf` | `METADATA_MODIFIED` |
| 3 | folding siblings from the leaf reaches `proof.root` | `PROOF_INVALID` |
| 4a | contract has a root for `batchId` | `BATCH_NOT_PUBLISHED` |
| 4b | `proof.root` = on-chain root, and `proof.leafCount` = on-chain leafCount | `ROOT_MISMATCH` |
| ✓ | all passed | `VALID` |

**Why editing proof.json cannot beat this:** an attacker can recompute fileHash, leaf and root so checks 1–3 pass, but their root will not equal the on-chain root. They cannot change the on-chain root (write-once, publisher-only) and cannot find siblings that reach the real root from a forged leaf (that needs a SHA-256 collision).

**Pinned contract:** the verifier's chainId and contract address come from its own config (`verifier/src/config.js`, built from `shared/deployment.json`), never from `proof.json`. Otherwise an attacker could deploy their own contract with a fake root and point the proof at it.

**Result object** returned by `verify()` in `@proofchain/core`:

```javascript
{
  // CHECK_RESULT[id] of the first check with pass === false; 'VALID' if none failed
  verdict: 'VALID' | 'FORMAT_INVALID' | 'REGISTRY_MISMATCH' | 'DOCUMENT_MODIFIED' | 'METADATA_MODIFIED'
         | 'PROOF_INVALID' | 'BATCH_NOT_PUBLISHED' | 'ROOT_MISMATCH',
  // Always these 7 checks, in this order, each { id, name, pass, computed, expected, detail }.
  // pass: true | false | null (null = skipped). A failed '0' skips every later check; otherwise
  // '0b' to '4a' all run, and a failed '4a' skips '4b'. detail: one sentence for the results table.
  checks: [
    { id: '0',  name: 'Proof format',    computed: null,                     expected: null },
    { id: '0b', name: 'Registry',        computed: 'eip155:<anchor>',        expected: 'eip155:<pinned>' },
    { id: '1',  name: 'File hash',       computed: '<hash of the file>',     expected: '<proof.fileHash>' },
    { id: '2',  name: 'Leaf',            computed: '<leaf from proof data>', expected: '<proof.leaf>' },
    { id: '3',  name: 'Merkle path',     computed: '<folded root>',          expected: '<proof.root>' },
    { id: '4a', name: 'Batch published', computed: '<on-chain root>',        expected: null },
    { id: '4b', name: 'Root',            computed: '<proof.root>',           expected: '<on-chain root>' },
  ],
  // Recomputed from the uploaded file itself, for display; null where not computable.
  // VALID implies computed.root === the on-chain root.
  computed: { fileHash, leaf, root },
}
// verify() never throws on bad file or proof input (that is FORMAT_INVALID);
// it throws TypeError only when `pinned` is misconfigured (a programming error).
```

`verify({ fileBytes, proof, chainBatch, pinned })` never talks to the chain itself; the caller reads `chainBatch = { root, leafCount }` (or `null` if unpublished) and passes it in.

**Copies people receive (WhatsApp, paper):** compressed or printed copies have different bytes and will fail; that is correct. The receipt QR carries `recordId` + `batchId`, so a person can fetch the original file + proof, verify that cryptographically, and compare it visually with what they were sent.

---

## Smart contract: RootRegistry

The contract stores one root per batch, can be written only by the publisher key, and can never be overwritten. That is what makes the roots a reference the registry cannot quietly rewrite.

- **Publisher key:** the private key of the deployer account (Hardhat account #0). Lives only in `server/.env` as `PUBLISHER_PRIVATE_KEY`. Never in a frontend.
- **Write-once:** `publishRoot` refuses if the batchId already has a root, and there is no update or delete function. Contract code cannot change after deployment.
- **Network:** local Hardhat node, `http://127.0.0.1:8545`, chainId `31337`. No Sepolia, no real ETH. On a fresh chain the first deploy from account #0 always lands at `0x5FbDB2315678afecb367f032d93F642f64180aa3`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RootRegistry {
    address public immutable publisher;

    struct Batch { bytes32 root; uint32 leafCount; uint64 publishedAt; }
    mapping(bytes32 => Batch) private batches;

    event RootPublished(bytes32 indexed batchId, bytes32 root, uint32 leafCount);

    constructor() { publisher = msg.sender; }

    function publishRoot(bytes32 batchId, bytes32 root, uint32 leafCount) external {
        require(msg.sender == publisher, "Not publisher");
        require(root != bytes32(0) && leafCount > 0, "Invalid batch");
        require(batches[batchId].root == bytes32(0), "Batch already published");
        batches[batchId] = Batch(root, leafCount, uint64(block.timestamp));
        emit RootPublished(batchId, root, leafCount);
    }

    function getBatch(bytes32 batchId) external view
        returns (bytes32 root, uint32 leafCount, uint64 publishedAt) {
        Batch memory b = batches[batchId];
        return (b.root, b.leafCount, b.publishedAt);
    }
}
```

**Required Hardhat tests:** publish succeeds; second publish of the same batchId reverts; non-publisher reverts; zero root reverts; `getBatch` of an unknown id returns zero root.

**Honest limit:** a single local node stands in for a public chain; whoever runs it could restart it. In production, roots go to a public chain or several independent witnesses.

---

## Stack, repo, ports, config

Plain JavaScript with ES modules everywhere (no TypeScript), one npm-workspaces monorepo, everything runs locally with no paid service. Developers use Windows + PowerShell, so every npm script must be cross-platform (no `rm`, `cp`, `export`; use small Node scripts).

```
proofchain/
  package.json            # npm workspaces: core, contracts, server, web, verifier
  CLAUDE.md, GEMINI.md    # this spec (identical copies)
  README.md               # front page + run order
  docs/concepts.md        # background and design reasoning
  core/                   # @proofchain/core: constants, canonical, hash, merkle, proof, verify (+ tests)
  contracts/              # Hardhat 2 (CommonJS package): RootRegistry.sol, scripts/deploy.js, test/
  shared/deployment.json  # written by deploy, committed: { chainId, address, abi }
  server/                 # Express API + SQLite + AI + storage/
  web/                    # React registry app (upload, confirm, records, batches, audit, demo)
  verifier/               # separate React app; talks ONLY to the chain, never to server
  samples/                # fictional demo documents
  scripts/                # seed.js, reset.js
```

| Part | Choice | Why |
| --- | --- | --- |
| Hashing | `@noble/hashes` (sha256) | Same synchronous code in Node and the browser |
| Chain | Hardhat 2 + ethers v6 | Local, free |
| Server | Express, `better-sqlite3`, `multer` | Synchronous SQLite, zero setup |
| Text | `pdf-parse`, `tesseract.js` | Pure JS; no system Tesseract install |
| AI | Gemini API free tier (`@google/genai`) + regex fallback | Free; fallback satisfies the local-fallback rule |
| Frontends | React + Vite + Tailwind v4 + react-router-dom | Team already knows it |

| Service | Port | Command |
| --- | --- | --- |
| Hardhat node | 8545 | `npm run chain` |
| Deploy contract | — | `npm run deploy` (writes `shared/deployment.json`) |
| Server | 4000 | `npm run server` |
| Registry app | 5173 | `npm run web` (proxies `/api` to 4000) |
| Verifier app | 5174 | `npm run verifier` |
| Demo data | — | `npm run seed` |
| Start over | — | `npm run reset` (hardhat_reset + wipe DB/storage + redeploy) |
| Tests | — | `npm test` (core + contracts) |

**`server/.env`:** `PORT=4000`, `RPC_URL=http://127.0.0.1:8545`, `PUBLISHER_PRIVATE_KEY=<Hardhat account #0 key>`, `GEMINI_API_KEY=<from AI Studio>`, `AI_MODE=gemini` (set `off` to demo the fallback).

**Verifier config:** imports `shared/deployment.json` at build time, so chainId and contract are pinned. It has **no** server URL configured.

**Gotcha:** a restarted Hardhat node loses all state. Run `npm run reset`, then `npm run seed`.

---

## API contract and database

Frontend and backend work in parallel against this contract; frontends start with mock responses of exactly these shapes. Errors are always `{ "error": "CODE", "message": "...", "details"?: {} }`. Every mutating call takes an `X-Actor` header (a name) for the audit log; missing → 400 `MISSING_ACTOR`.

| Method + path | Body | Returns | Owner |
| --- | --- | --- | --- |
| `GET /api/health` | — | `{ ok, chain, aiMode, contract }` | Archit |
| `POST /api/documents` | multipart `file` | `{ recordId, fileHash, status:"draft", suggestions:{ docType, issuer, date, confidence:{...}, evidence:{...} }, extractionPath:"ai"\|"fallback" }`; 409 `DUPLICATE` with `{ recordId, batchId }` | Mahendra |
| `POST /api/documents/:recordId/confirm` | `{ docType, issuer, date }` | `{ record, leaf, status:"pending" }`; 400 `VALIDATION` with field errors | Mahendra |
| `GET /api/documents` | query `status, docType, issuer, batchId` | `[ record ]` | Mahendra |
| `GET /api/documents/:recordId/file` | — | the stored file | Mahendra |
| `GET /api/documents/:recordId/proof` | — | `proof.json` (404 `NOT_ANCHORED` if not anchored; 409 `RECORD_INTEGRITY_FAILED` if the stored record no longer folds to its batch root: run the audit) | Archit |
| `POST /api/batches/seal` | — | `{ batchId, root, leafCount, txHash, blockNumber }`; 400 `NOTHING_PENDING` | Archit |
| `GET /api/batches` | — | `[ { batchId, root, leafCount, txHash, blockNumber, publishedAt, records:[recordId] } ]` newest first | Archit |
| `POST /api/audit` | — | `{ checkedAt, batches:[ { batchId, status:"OK"\|"MISMATCH", dbRoot, storedRoot, chainRoot, leafCount, chainLeafCount, changedRecords:[recordId], changedFiles:[recordId] } ], onChainOnly:[batchId] }` (read-only); 503 `CHAIN_UNREACHABLE` | Archit |
| `POST /api/demo/tamper` | `{ type:"stored_file"\|"db_metadata"\|"restore", recordId }` | `{ ok:true, detail }` (demo only; `restore` undoes the record's latest tamper) | Archit |
| `POST /api/explain` | `{ verdict, checks }` (no document, no DB lookup) | `{ explanation, path:"ai"\|"template" }` | Mahendra |
| `GET /api/audit-log` | — | `[ entry ]` newest first | Archit |

**SQLite schema (`server/src/db/schema.sql`):**

```sql
CREATE TABLE IF NOT EXISTS batches (
  batch_id TEXT PRIMARY KEY, root TEXT NOT NULL, leaf_count INTEGER NOT NULL,
  tree_json TEXT NOT NULL,                  -- all levels, bottom to top
  tx_hash TEXT, block_number INTEGER, published_at TEXT
);
CREATE TABLE IF NOT EXISTS records (
  record_id      TEXT PRIMARY KEY,          -- REC-000001
  file_hash      TEXT NOT NULL UNIQUE,
  file_name      TEXT NOT NULL,
  mime           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('draft','pending','anchored')),
  doc_type       TEXT, issuer TEXT, doc_date TEXT,   -- confirmed values (NULL while draft)
  leaf           TEXT,
  batch_id       TEXT REFERENCES batches(batch_id),
  leaf_index     INTEGER,
  ai_suggestions TEXT,                      -- JSON, kept for audit only
  extraction_path TEXT,                     -- 'ai' | 'fallback'
  created_by TEXT, confirmed_by TEXT,
  created_at TEXT NOT NULL, confirmed_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT,
  action TEXT NOT NULL,                     -- UPLOAD, CONFIRM, SEAL, PUBLISH, AUDIT, TAMPER, REJECT
  target TEXT, outcome TEXT, detail TEXT    -- detail = JSON
);
```

---

## AI: what it may and may not do

AI suggests and explains; it never decides. Only human-confirmed metadata enters a leaf, and no AI output can change whether verification passes.

| AI task | Input | Output | Fallback when AI is off or fails |
| --- | --- | --- | --- |
| Metadata extraction | extracted text (first ~4,000 chars) | `{ docType, issuer, date }` + confidence 0–1 + the source line for each | Regex for dates (`DD/MM/YYYY`, `14 June 2026`, ISO); keyword map for docType; issuer = first line matching *University*, *Institute*, *College*, *Pvt Ltd*, *Limited* |
| Failure explanation | verdict + checks (no file, no DB) | 2–3 plain sentences | Fixed template per result code |
| Category suggestion (optional) | extracted text | one docType | keyword map |

**Rules for the extraction call:**

- Ask Gemini for **JSON only** with a fixed schema; validate it. Unparseable or invalid output = treat as failed and run the fallback.
- `docType` must be one of the enum values; anything else becomes `OTHER` with low confidence.
- Every suggested value must quote the line it came from (`evidence`); a value with no evidence is dropped. The confirm screen shows that line next to the field.
- Timeout 8 s. Store the raw suggestions and `extractionPath` in the record for audit.
- `AI_MODE=off` forces the fallback, so we can show judges the system still works without AI.

---

## Work split (ownership)

Edit only files you own. Every source file starts with `// Owner: <name> | <purpose>`. Files marked `(frozen)` are shared; ask Archit before changing them.

| Person | Owns | Folders / files |
| --- | --- | --- |
| Archit | Core crypto lib, contract, sealing/publishing, proofs, audit, tamper endpoints, repo + merges | `core/`, `contracts/`, `shared/`, root config, `server/src/lib/chain.js`, `server/src/routes/{health,proofs,batches,audit,demo}.js`, `server/src/services/batching.js`, `verifier/src/chain.js`, all `(frozen)` files |
| Mahendra | Server foundation, upload, text extraction, AI + fallback, confirm, explain, registry upload/confirm UI | `server/src/routes/{documents,explain}.js`, `server/src/services/{storage,extraction,aiMetadata,fallbackMetadata,explain}.js`, `web/src/pages/{Upload,Confirm}.jsx` |
| Neel | Sample documents, seed script, verifier UI, registry list pages, tamper panel UI, README Demo section, slides | `samples/`, `scripts/seed.js`, `verifier/src/` (except `chain.js`, `config.js`), `web/src/pages/{Records,Batches,Audit,Tamper}.jsx`, `README.md` "Demo" section |

**Archit**

- [ ] Monorepo skeleton (workspaces, folders, scripts, `.env.example`) pushed first
- [ ] `core/`: `canonicalJSON`, `fileHash` (incl. `.txt` normalisation), `leafHash`, `nodeHash`, `buildTree`, `getProof`, `foldProof`, `expectedPathLength`, `buildProof`, `verify`
- [ ] `core` unit tests: 1, 2, 3, 4, 5, 7 leaves; every proof verifies; one flipped byte fails at the right check
- [ ] `contracts/`: RootRegistry, deploy script writing `shared/deployment.json`, Hardhat tests
- [ ] Server: seal (build tree, publish, mark anchored), batches list, proof endpoint
- [ ] Server: audit, tamper demo, audit log
- [ ] Help Neel wire `verify` + `getBatch` into the verifier
- [ ] Review and merge PRs at every sync

**Mahendra**

- [ ] `POST /api/documents`: validation, `fileHash` via `@proofchain/core`, duplicate check, store file, save draft
- [ ] Text extraction: pdf-parse, then tesseract.js for images and scans
- [ ] AI metadata extraction (Gemini, JSON-only, validated, 8 s timeout) + regex/keyword fallback + `AI_MODE=off`
- [ ] `POST /api/documents/:id/confirm` with validation, canonical record + leaf, status `pending`
- [ ] `GET /api/documents`, `GET /api/documents/:id/file`; stretch: `POST /api/explain` (registry app only)
- [ ] Registry web: Upload page and Confirm screen (suggestion, confidence, evidence line, editable field per value)
- [ ] Stretch: receipt PDF with QR

**Neel**

- [ ] `samples/`: 10 fictional documents (degree certificates, marksheets, salary slips from 3 made-up issuers) as PDFs, 1 scanned-style PNG, 1 `.txt`, plus a tampered copy of one PDF (salary 50,000 → 80,000)
- [ ] `scripts/seed.js`: uploads + confirms the samples through the API and seals two batches
- [ ] `verifier/` app: drop zones for document + proof.json, results table (check, pass/fail, computed vs expected), verdict banner, template explanations; mock `verify()` until core lands
- [ ] Registry web: Records list (filters), Batches list, Audit page, Tamper panel, Download proof button
- [ ] README "Demo" section, demo script, 5-slide deck

---

## Timeline: serial and parallel work

Work is serial only in the first 45 minutes and the last four hours. From H0.75 to H8 all three work in parallel against the locked formats and API contract, using mocks until the real piece lands. H = hours from hackathon start.

| Hours | Archit | Mahendra | Neel |
| --- | --- | --- | --- |
| H0–H0.75 | All: read this spec, lock formats | ← | ← |
| H0.75–H1.25 | Repo skeleton | Read spec, get Gemini key | Read spec, start samples |
| H1.25–H3 | Core lib + tests | Upload + storage | Sample documents |
| H3–H4 | Contract + deploy | Text extraction | Verifier UI (mocked) |
| **H4** | **Sync 1** | | |
| H4–H6 | Seal, publish, proofs | AI + fallback + confirm | List pages + tamper panel |
| H6–H8 | Audit + tamper endpoints; wire verifier with Neel | Upload + confirm UI | Verifier on real core |
| **H8** | **Sync 2** | | |
| H8–H10.5 | All: end-to-end run + bug fixes | ← | + README Demo, demo script, slides |
| **H10.5** | **Code freeze**; rehearse 3×, record backup video | ← | ← |

**Serial dependencies (what blocks what)**

1. **Formats + API contract locked** (all, by H0.75) → blocks everything.
2. **Repo skeleton pushed** (Archit, by H1.25) → everyone branches from it.
3. **`core` lib** (Archit, by H3) → Mahendra's leaf in confirm, Neel's real verifier. Until then Mahendra stubs `leafHash`, Neel mocks `verify()`.
4. **Contract + `shared/deployment.json`** (Archit, by H4) → seal endpoint and the verifier's chain read.
5. **Confirm endpoint** (Mahendra, by H5.5) → real `pending` records for sealing and for Neel's seed script.

**Sync 1 at H4 (15 min):** core tests green; contract deploys; an upload creates a draft with suggestions; verifier renders mocked checks. Everyone merges to `main`.

**Sync 2 at H8 (30 min):** full run on one laptop from a clean clone: seed → seal → download proof → verify genuine → verify tampered → tamper DB → audit → verify again. List bugs and assign owners.

**H8 to H10.5:** fix bugs. Stretch goals (receipt QR, AI explanation, field-level redaction) only if everything is green by H9.

---

## Git workflow

Repo: https://github.com/mahendraSpatil/flanker-h4vortexa

- Archit pushes to `main` (run `npm test` first; never force-push). Mahendra and Neel work on branches `mahendra` and `neel` and open PRs into `main`; Archit merges.
- Pull `main` into your branch (`git fetch origin; git merge origin/main; npm install`) whenever a dependency lands (core, contract) and before every PR.
- PRs at Sync 1 (H4), optionally H6, Sync 2 (H8), then small fix PRs until freeze (H10.5). Do not delete your branch after a merge; keep working on it.
- Only Archit edits the root `package.json`. Add dependencies to your own workspace: `npm install <pkg> -w server`. On a `package-lock.json` conflict: take `main`'s copy, run `npm install`, commit.
- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). Never commit `.env`, `server/storage/` contents or the SQLite file.
- AI coding tools never run git commands; humans commit.

---

## Demo script, PS checklist, honest limits

1. **Register:** upload a salary slip; show AI suggestions with evidence lines; correct one field; confirm. Mention `AI_MODE=off` still works.
2. **Seal:** seal the batch; show the root and the transaction on the local chain.
3. **Verify genuine:** open the separate verifier app, drop the PDF + proof.json → all checks green.
4. **Forge:** drop the tampered copy (₹50,000 → ₹80,000) with the same proof → `DOCUMENT_MODIFIED`.
5. **Forge the proof too:** a proof.json with recomputed fileHash, leaf and root → passes 1–3, fails with `ROOT_MISMATCH`.
6. **Insider attack:** Tamper panel edits the issuer in the DB → Audit flags the batch and the exact record; the verifier still rejects the forged document.
7. **Close:** "Verification proves this exact file was registered here. It does not prove the contents are true."

| PS B-01 requirement | Where we meet it |
| --- | --- |
| SHA-256 over a defined, reproducible form | `fileHash` + canonical record (`json-sorted-v1`), `.txt` normalisation |
| Batches summarised by a Merkle tree, root published | Seal batch → `publishRoot` |
| Membership proof for every record | `proof.json` |
| Roots stored where the registry cannot silently rewrite them | Write-once, publisher-only contract |
| Independent verifier with only document + proof + root | Separate verifier app, pinned contract, no server URL |
| Report which check failed | Result codes, checks 0–4 shown individually |
| Detect modified document, invalid proof, stored record vs reference | Checks 1–4 + Audit |
| Reject tampered document even if DB altered | Demo step 6 |
| AI extracts metadata, person confirms, AI never affects verification | Confirm screen; AI not in hash path; fallback path |
| No public blockchain required; genuine cryptographic checking | Local Hardhat; real SHA-256 recomputation |
| Common rules: fictional data, no paid services, local fallback | `samples/`, free tier + regex fallback |

**Honest limits:** a single local node stands in for a public chain; only the exact registered file verifies, so compressed or printed copies are checked by fetching the original via QR; verification proves registration, not truth or authorship; whoever holds the publisher key can register a fake document in a new batch.

---

## Rules for AI coding tools (Claude Code / Gemini)

- Read this whole file before writing code. The person you work for owns only the files listed under their name in "Work split"; do not edit anyone else's files. If a change is needed there, stop and say so.
- Plain JavaScript, ES modules (import/export). No TypeScript. CommonJS only inside `contracts/`.
- Never re-implement hashing, canonical JSON, Merkle or verification logic. Import them from `@proofchain/core`.
- Follow "Locked formats", "proof.json", "Verification checks" and "API contract" exactly: field names, casing, hex format, error shape. If one seems wrong, stop and say so instead of changing it.
- The verifier app must never call the server API or read the database.
- AI output never goes into a hash and never decides a verification result. Every AI call has a non-AI fallback.
- Fictional data only. No paid services.
- Windows + PowerShell: npm scripts must be cross-platform.
- Do not run git commands (no add, commit, push, checkout). Humans commit.
- Senior-quality code: small functions, clear names, input validation at every boundary, explicit error codes, brief comments only where non-obvious.
- Work in small steps. After each step, say what to run to check it works.


## UI guidelines

Visual reference: the "ProofChain UI Screens" canvas Archit shared (8 screens). Match its layout, states and data shapes; it is the target look, not a pixel spec.

One look across both apps, even though three people and two AI tools build them.

**Direction:** calm, audit-grade, technical. Light theme only. White cards on a slate-50 background, slate text, one accent (indigo-600) for primary actions and links. Emerald-600 and rose-600 mean pass/fail only; amber-500 only for pending/warnings; slate-400 for skipped. IBM Plex Sans for text and IBM Plex Mono for every hash, ID and address (one Google Fonts link in each app's index.html; system fonts as fallback).

**Shared UI kit** (owner: Neel). Master copy in `web/src/components/ui/`, identical copy in `verifier/src/components/ui/`. Build these before pages:

| Component | Purpose |
| --- | --- |
| Button | primary / secondary / danger, loading state |
| Card | white panel with title and optional actions |
| Badge | fixed colour per status: draft, pending, anchored, OK, MISMATCH, pass, fail, skipped |
| Hash | middle-truncated monospace hash (0x9b2c…e41a), full value on hover, copy button |
| FileDrop | drag-and-drop or click, shows name and size, accept list |
| DataTable | simple table with an empty state |
| Alert | shows an ApiError's code + message; info/success/error variants |
| Spinner, EmptyState | loading and nothing-yet states |

**Hero screens (spend polish here):**
- **Verifier:** verdict banner (VALID or the failure code, plus one plain sentence), then the 7 checks as a vertical list with computed vs expected hashes (highlight the first differing character), then the Merkle path drawn as a chain from the leaf through each sibling up to the on-chain root.
- **Confirm (registry):** document preview on the left (PDF in an iframe, image as img, text as pre); on the right one field per value showing the AI suggestion, a confidence bar, the quoted evidence line, and an "AI" or "Rules" tag for the extraction path.
- **Audit:** one row per batch; MISMATCH rows in red listing changed records and files.
- **Demo:** large labelled buttons per tamper type and restore, last result shown below.

**Rules:** every page handles loading, empty and error states. Never show a green tick without the hashes behind it. Target 1280 px wide; mobile not required. Tailwind only, plus `lucide-react` for icons; no other UI libraries.