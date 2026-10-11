# ProofChain

**Verifiable records and tamper detection.** VORTEXA 3.0 · Problem B-01 · Domain 3 (Blockchain & Decentralized Trust)

ProofChain is a document registry where anyone can prove a document is exactly the one that was registered, using only three things: the file, a small `proof.json`, and a Merkle root published to a write-once smart contract that the registry itself cannot rewrite. If anything has been tampered with, the independent verifier says exactly which check failed.

> Verification proves that *this exact file, with these confirmed details, was registered by this registry in this batch*. It does not prove that the contents are true or who wrote the document.

---

## How it works

```
 REGISTRY (untrusted)                     ANCHOR                      VERIFIER (independent)
┌──────────────────────────┐        ┌──────────────────┐        ┌───────────────────────────┐
│ upload → SHA-256 file    │        │ RootRegistry.sol │        │ input: document           │
│ AI suggests metadata     │        │ local Hardhat    │        │        + proof.json       │
│ human confirms           │ seal + │                  │  read  │ hash file → rebuild leaf  │
│ canonical record → leaf  │publish │ batchId → root   │ ─────▶ │ fold siblings → root      │
│ batch → Merkle tree      │ ─────▶ │ write-once,      │        │ compare with on-chain root│
│ issue proof.json         │        │ publisher-only   │        │ → verdict + failed check  │
│ audit: DB vs chain       │        └──────────────────┘        │ (never calls the registry)│
└──────────────────────────┘                                     └───────────────────────────┘
```

1. **Register:** a document is uploaded and fingerprinted (`fileHash = SHA-256(bytes)`). AI suggests issuer, date and type; a person confirms them.
2. **Seal:** confirmed records are grouped into a batch and built into a Merkle tree. Only the 32-byte root goes on-chain.
3. **Prove:** each document gets a `proof.json` with the sibling hashes from its leaf up to the root.
4. **Verify:** a separate app recomputes the root from the document and proof, and compares it with the root it reads directly from the contract.
5. **Audit:** the registry recomputes every batch from its own database and flags any record that no longer matches its published root.

Concepts and design decisions: [`docs/concepts.md`](docs/concepts.md). Full spec and formats: [`CLAUDE.md`](CLAUDE.md).

---

## Repository structure

```
core/        @proofchain/core: canonical JSON, hashing, Merkle tree, proofs, verification
contracts/   Hardhat project: RootRegistry.sol, deploy script, tests
shared/      deployment.json (pinned chainId, contract address, ABI)
server/      Express API, SQLite, file storage, text extraction, AI metadata
web/         Registry app: upload, confirm, records, batches, audit, tamper demo
verifier/    Independent verifier app (talks only to the chain)
samples/     Fictional demo documents
scripts/     seed and reset helpers
docs/        Concepts and design notes
```

---

## Running locally

**Prerequisites:** Node.js 24, npm. No paid services, no real cryptocurrency.

```powershell
npm install
Copy-Item server\.env.example server\.env    # then fill in the values (see below)
```

Run each of these in its own terminal, in this order:

| Step | Command | URL |
| --- | --- | --- |
| 1. Local chain | `npm run chain` | http://127.0.0.1:8545 |
| 2. Deploy contract (once per fresh chain) | `npm run deploy` | writes `shared/deployment.json` |
| 3. API server | `npm run server` | http://localhost:4000/api/health |
| 4. Registry app | `npm run web` | http://localhost:5273 |
| 5. Verifier app | `npm run verifier` | http://localhost:5274 |
| 6. Demo data (optional) | `npm run seed` | uploads, confirms and seals the samples |

**`server/.env`:** `PUBLISHER_PRIVATE_KEY` is Hardhat account #0's key (printed when the chain starts). `GEMINI_API_KEY` is a free key from Google AI Studio. Set `AI_MODE=off` to run without AI; the system falls back to rule-based extraction.

**Start over:** `npm run reset` resets the chain, wipes the database and stored files, and redeploys the contract. If you restarted the chain process, run this before anything else.

**Tests:** `npm test` (core library + contract).

---

## Verification results

| Code | Meaning |
| --- | --- |
| `VALID` | Root computed from the document equals the on-chain root |
| `FORMAT_INVALID` | `proof.json` is malformed or uses a different scheme |
| `REGISTRY_MISMATCH` | Proof was issued for a different chain or contract |
| `DOCUMENT_MODIFIED` | File bytes differ from the registered file |
| `METADATA_MODIFIED` | Confirmed details in the proof were changed |
| `PROOF_INVALID` | Sibling path does not reach the root the proof claims |
| `BATCH_NOT_PUBLISHED` | No root on-chain for that batch |
| `ROOT_MISMATCH` | Proof is self-consistent but its root is not the published one |

---

## Demo

TODO (Neel): demo script and screenshots.

---

## Honest limits

- A single local Hardhat node stands in for a public chain; whoever runs it could restart it. In production, roots would go to a public chain or several independent witnesses.
- Only the exact registered file verifies. A compressed (e.g. WhatsApp) or printed copy is checked by fetching the original through its receipt QR and comparing visually.
- Verification proves registration, not truth or authorship. Whoever holds the publisher key can register a false document in a new batch.
- All data in this repository is fictional.

---

## Team

| Name | Area |
| --- | --- |
| Archit | Core cryptography, smart contract, batching, proofs, audit |
| Mahendra | Server, upload and text extraction, AI metadata, registry upload/confirm UI |
| Neel | Verifier app, registry list pages, demo data, presentation |
