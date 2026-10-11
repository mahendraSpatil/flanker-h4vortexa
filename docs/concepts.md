# ProofChain: Concepts and Design Decisions

> **Background reading.** This file explains the ideas behind ProofChain and why we chose each design. [`CLAUDE.md`](../CLAUDE.md) is the source of truth for every format, field name, result code and API. If the two ever disagree, `CLAUDE.md` wins.

**Problem:** VORTEXA 3.0 · B-01 ProofChain: Verifiable Records & Tamper Detection · Domain 3, Blockchain & Decentralized Trust

---

## 1. Problem overview

Certificates, contracts and official records are usually stored by a single custodian, and everyone has to trust that custodian's database.

If the same database stores both a record and its fingerprint (hash), anyone who can alter the record can alter the fingerprint too. The stored value then proves nothing to an outside party.

A verifier needs:

1. A reference that the custodian cannot quietly rewrite.
2. A way to check a single record without downloading the whole registry.
3. A clear reason when a check fails.

**Scope limit:** verification proves that a document *matches a registered reference*. It does **not** prove who created the document or that its contents are true.

---

## 2. Requirements and how we meet them

| PS requirement | What it means in practice | How ProofChain does it |
|---|---|---|
| SHA-256 fingerprints from a defined, reproducible form | Canonicalize, then hash | `fileHash` over exact file bytes (`.txt` normalized); canonical record in `json-sorted-v1` |
| Batches summarized by a Merkle tree, root published | Batching + tree construction | "Seal batch" builds the tree and calls `publishRoot` |
| Every record can produce a membership proof | Merkle proof generation | `proof.json` per anchored record |
| Roots stored where the registry cannot silently rewrite them | External, append-only anchor | Write-once, publisher-only `RootRegistry` contract on a local Hardhat chain |
| Independent verifier using only document + proof + published root | No registry DB access | Separate verifier app; reads the root from a pinned contract; no server URL configured |
| Verifier reports which check failed | Distinct failure codes | Checks 0–4, each shown with computed vs expected values |
| Detect modified document, invalid proof, and stored record that no longer matches its published reference | Tamper scenarios + audit | Verification checks + audit job comparing DB roots with on-chain roots |
| Reject a tampered document even if the registry DB is altered | Verifier never trusts the DB | Verifier trusts only the on-chain root |
| AI may extract metadata, suggest categories, explain failures | AI is advisory, human-confirmed | AI suggests; a person confirms; AI output never enters a hash or a verdict |
| No public blockchain; real cryptographic checking | No visual-only "green tick" | Local chain; every check recomputes real SHA-256 hashes |

---

## 3. Core concepts

### 3.1 SHA-256

Maps any input to a fixed 256-bit (64 hex character) output.

- **Deterministic:** same input, same output.
- **Avalanche effect:** a one-bit change gives a completely different hash.
- **One-way:** the input cannot be recovered from the hash.
- **Collision-resistant:** finding two inputs with the same hash is computationally infeasible.

This makes it suitable as a document fingerprint.

### 3.2 Canonicalization (the "reproducible form")

Two byte-different inputs can represent the same thing (reordered JSON keys, different line endings). Hashing them inconsistently would make valid documents fail, so we fix one byte representation for everything we hash.

**Our rules:**

- **Files (PDF, images):** hash the exact file bytes, no normalization. A re-saved PDF is a different file, and rejecting it is correct; normalizing PDF text would let someone swap a signature image undetected.
- **Plain-text files (`.txt`), rule `text-v1`:** decode the bytes as UTF-8 strictly (a file that is not valid UTF-8 is rejected at upload), strip one leading BOM, convert CRLF and lone CR to LF, remove spaces and tabs at the end of every line, remove trailing newlines at the end of the file, apply Unicode NFC, re-encode as UTF-8, then hash. The registry picks `text-v1` for a `.txt` name or `text/plain` MIME type and records it in `proof.scheme.fileNormalization`, so the verifier applies exactly the same rule. A harmless invisible change (line endings, trailing blanks, a BOM) no longer breaks the hash.
- **Records:** the canonical record `{v, recordId, fileHash, docType, issuer, date}` is serialized with keys sorted, no whitespace, UTF-8, and normalized values (trimmed, NFC, ISO dates, fixed docType list). We call this `json-sorted-v1`.

For our flat record of strings and one small integer, `json-sorted-v1` produces the same bytes as the JSON Canonicalization Scheme (RFC 8785): both sort keys by UTF-16 code units and use standard JSON string escaping.

OCR and AI output are **never** hashed. OCR is not deterministic (two scans of the same page give slightly different text), so hashing it would make untouched documents fail.

### 3.3 Merkle tree

A binary tree of hashes built **across documents**: one leaf per document record, one root per batch.

- **Leaf:** `SHA-256(0x00 ‖ canonicalJSON(record))`. The record contains the `fileHash` and the human-confirmed metadata, so the leaf locks both the exact file and its confirmed details.
- **Internal node:** `SHA-256(0x01 ‖ left ‖ right)`, where `left` and `right` are the raw 32 bytes of the children.
- **Root:** the single hash left at the top.
- **Leaf order:** sorted by `recordId` within the batch.
- **Odd node rule:** an unpaired node at any level is **promoted unchanged** to the next level. (Duplicating the last node instead allows two different batches to share a root, a known Bitcoin bug, CVE-2012-2459.)

Changing anything in any record changes its leaf and every ancestor up to the root, so one 32-byte root commits to the whole batch and its order. Only the root needs to be published.

The `0x00` / `0x01` prefixes (domain separation) make a leaf hash and an internal node hash impossible to confuse. Without them, an attacker could present an internal node as if it were a document leaf, with a shorter proof, and pass.

### 3.4 Membership proof

To prove a record is in a batch you only need the **sibling hashes along its path to the root**: about log₂(n) of them, 20 for a million records (640 bytes).

Example with four records A, B, C, D:

```
                ROOT = H(0x01 ‖ N_AB ‖ N_CD)
               /                            \
   N_AB = H(0x01 ‖ L_A ‖ L_B)      N_CD = H(0x01 ‖ L_C ‖ L_D)
        /        \                       /        \
      L_A        L_B                   L_C        L_D

   L_x = H(0x00 ‖ canonicalJSON(record_x))
```

Proof for C: `siblings = [ {L_D, right}, {N_AB, left} ]`. `pos` is the **sibling's** side, which decides the concatenation order.

Verifier steps:

1. Hash the uploaded file → `fileHash`.
2. Rebuild `L_C` from `fileHash` + the metadata in the proof.
3. `h = H(0x01 ‖ L_C ‖ L_D)` → `N_CD` (sibling on the right).
4. `h = H(0x01 ‖ N_AB ‖ h)` → computed root (sibling on the left).
5. Compare the computed root with the root read from the contract.

Odd-node example with five records: level 1 is `N01, N23, L4` (L4 promoted), level 2 is `N0123, L4` (promoted again), root is `H(0x01 ‖ N0123 ‖ L4)`. The proof for L4 has only one sibling: `[ {N0123, left} ]`.

### 3.5 Anchoring roots outside the registry's control

A published root is useless if the custodian can replace it. Options include a hash-chained log, signed roots, WORM storage, a public Git repository, or independent witnesses.

**Our choice:** a `RootRegistry` smart contract on a local Hardhat chain.

- `publishRoot(batchId, root, leafCount)` can only be called by the **publisher key** (the deployer account; its private key lives only on the server).
- It is **write-once**: a batchId that already has a root is rejected, and the contract has no update or delete function. Contract code cannot change after deployment.
- Anyone can read a root with `getBatch(batchId)`.

**Why this is enough for the PS:** the registry's database and the published roots are now separate. Editing the database cannot change a published root, so the audit and the verifier both catch the edit.

**Trust assumption (stated openly):** a single local node stands in for a public chain, and whoever operates it could reset it. In production, roots would be published to a public chain or to several independent witnesses whose copies must agree.

### 3.6 Independent verification

The verifier is a separate app that takes only:

1. the document
2. its `proof.json`
3. the root, which it reads itself from the contract

It never calls the registry API or database, and it does not trust any proof field it can recompute.

The chainId and contract address are **pinned in the verifier's own config**, never taken from `proof.json`. Otherwise an attacker could deploy their own contract with a fake root and point a forged proof at it.

### 3.7 Failure taxonomy

All checks run and are shown; the verdict is the first failure. A document is valid only if the root computed from the uploaded file equals the on-chain root.

| # | Code | Meaning | Detection |
|---|---|---|---|
| 0 | `FORMAT_INVALID` | Proof is malformed | Missing fields, bad hex, unknown scheme, `leafIndex ≥ leafCount`, wrong number of siblings |
| 0b | `REGISTRY_MISMATCH` | Proof was issued by a different registry | `anchor.chainId` / `anchor.contract` differ from the pinned values |
| 1 | `DOCUMENT_MODIFIED` | File differs from the registered one | SHA-256 of the file ≠ `proof.fileHash` |
| 2 | `METADATA_MODIFIED` | Confirmed details were changed | Leaf rebuilt from fileHash + metadata ≠ `proof.leaf` |
| 3 | `PROOF_INVALID` | Path is inconsistent | Folding the siblings does not reach `proof.root` |
| 4a | `BATCH_NOT_PUBLISHED` | No published root for this batch | Contract returns a zero root |
| 4b | `ROOT_MISMATCH` | Proof is self-consistent but not anchored | `proof.root` ≠ on-chain root (or leafCount differs) |
| ✓ | `VALID` | All checks passed | |

If the path folds to the proof's own claimed root but that root differs from the published one, the result is `ROOT_MISMATCH`. If it does not fold to its own claimed root, it is `PROOF_INVALID`.

**Why editing `proof.json` cannot beat this:** an attacker who changes a document can recompute `fileHash`, `leaf` and `root` so checks 1–3 pass. Check 4 still fails, because they cannot change the on-chain root and cannot find siblings that reach the real root from a forged leaf (that would need a SHA-256 collision).

### 3.8 Tamper scenarios

1. **Modified document:** file hash changes → `DOCUMENT_MODIFIED`.
2. **Modified metadata in a proof:** rebuilt leaf differs → `METADATA_MODIFIED`.
3. **Corrupted proof:** a sibling hash is altered or its side is wrong → `PROOF_INVALID`.
4. **Fully forged proof:** document, fileHash, leaf and root all recomputed by the attacker → `ROOT_MISMATCH`.
5. **Registry database altered:** the **audit job** recomputes every leaf and root from stored records and compares them with the on-chain roots, flagging the batch and the exact records that changed ("stored record no longer matches its published reference"). The independent verifier still rejects the forged document because it trusts only the on-chain root.

### 3.9 The AI component and its boundary

Allowed:

- Extract metadata (issuer, date, document type) from the document text, quoting the line each value came from.
- Suggest a category.
- Explain a verification failure in plain language.

Constraints:

- A person confirms every extracted value before it enters the record; only confirmed values go into the leaf.
- AI output never enters a hash and never influences a verdict.
- Every AI task has a rule-based fallback. With `AI_MODE=off`, the system still works and verification results are identical.

### 3.10 What the system does not prove

It proves integrity relative to a registered reference: this exact file, with these confirmed details, was registered by this registry in this batch. It does not prove issuer legitimacy, truthfulness of contents, or honesty at registration time. Issuer digital signatures (Ed25519 / X.509) could be added as an extension.

**Copies people receive:** a compressed (e.g. WhatsApp) or printed copy has different bytes and will not verify; that is correct behaviour. The receipt QR carries `recordId` and `batchId`, so a person can fetch the original file and proof, verify that cryptographically, and compare it visually with the copy they were given.

---

## 4. Architecture

```
 REGISTRY (untrusted)                     ANCHOR                      VERIFIER (independent)
┌──────────────────────────┐        ┌──────────────────┐        ┌───────────────────────────┐
│ upload → SHA-256 file    │        │ RootRegistry.sol │        │ input: document           │
│ AI suggests metadata     │        │ local Hardhat    │        │        + proof.json       │
│ human confirms           │ seal + │                  │  read  │ hash file → rebuild leaf  │
│ canonical record → leaf  │publish │ batchId → root   │ ─────▶ │ fold siblings → root      │
│ batch → Merkle tree      │ ─────▶ │ write-once,      │        │ compare with on-chain root│
│ store tree, issue proofs │        │ publisher-only   │        │ → verdict + failed check  │
│ audit: DB vs chain       │        └──────────────────┘        │ (never calls the registry)│
└──────────────────────────┘                                     └───────────────────────────┘
```

**Stack:** Node.js (ES modules) + Express, SQLite, React + Vite, Hardhat + ethers, `@noble/hashes` for SHA-256 in both Node and the browser, Gemini free tier with a rule-based fallback.

**Where each piece lives:** SQLite stores every record and every tree level; the contract stores only `root` + `leafCount` per batch; `proof.json` carries one leaf and its path. Proofs are generated from the stored tree on request.

The exact `proof.json` format, record schema and API are defined in [`CLAUDE.md`](../CLAUDE.md) and are not repeated here to avoid drift.

---

## 5. Pitfalls we avoid

- **Second-preimage attacks:** domain separation (`0x00` leaves, `0x01` nodes).
- **Odd number of leaves:** promote the unpaired node; never duplicate it.
- **Hex strings instead of bytes:** internal nodes hash the raw 32-byte children, not their hex text.
- **Unstable canonicalization:** one shared implementation in `@proofchain/core`, used by the server and the verifier, with tests.
- **Verifier depending on the registry:** the verifier has no server URL and reads roots only from the pinned contract.
- **Trusting the proof's anchor:** chainId and contract address are pinned in the verifier.
- **Visual-only "verified" indicator:** every check shows its computed and expected hashes.
- **AI output feeding the verdict:** AI only suggests and explains, behind a human confirmation step.

---

## 6. Demo flow

1. Register a salary slip: show AI suggestions with their source lines, correct one field, confirm.
2. Seal the batch: show the root and the transaction on the local chain.
3. Verify the genuine document in the separate verifier app: all checks green, proof path shown.
4. Verify a forged copy (₹50,000 changed to ₹80,000) with the same proof → `DOCUMENT_MODIFIED`.
5. Verify the forged copy with a fully recomputed proof → passes checks 1–3, fails with `ROOT_MISMATCH`.
6. Edit the issuer in the registry database → the audit flags the batch and the record; the verifier still rejects the forged document.
7. Set `AI_MODE=off`: metadata extraction falls back to rules, and every verification result is unchanged.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| Custodian / registry | The party that holds and controls the document database |
| Fingerprint / hash | Fixed-size digest identifying some bytes |
| Canonical form | The single agreed byte representation of a record |
| Canonical record | `{v, recordId, fileHash, docType, issuer, date}` in `json-sorted-v1` |
| Leaf | Hash of one canonical record |
| Merkle root | Single hash summarizing a whole batch |
| Membership proof | Sibling hashes proving a leaf is under a root (`proof.json`) |
| Anchor | The external, tamper-evident place roots are published (our contract) |
| Publisher key | The only account allowed to publish roots |
| Write-once | A published root can never be changed or deleted |
| Pinned contract | The chainId and address the verifier trusts, set in its own config |
| Audit job | Recomputes stored records and trees and compares them with on-chain roots |
