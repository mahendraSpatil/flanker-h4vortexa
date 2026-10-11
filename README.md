# B-01 ProofChain: Verifiable Records & Tamper Detection

**Domain:** 3, Blockchain & Decentralized Trust

---

## 1. Problem Overview

Certificates, contracts, and official records are usually stored by a single custodian, and everyone has to trust that custodian's database.

If the same database stores both a record and its fingerprint (hash), anyone who can alter the record can alter the fingerprint too. The stored value then proves nothing to an outside party.

A verifier needs:

1. A reference that the custodian cannot quietly rewrite.
2. A way to check a single record without downloading the whole registry.
3. A clear reason when a check fails.

**Scope limit:** verification proves that a document *matches a registered reference*. It does **not** prove who created the document or that its contents are true.

---

## 2. The Challenge (Requirements)

| Requirement | Practical meaning |
|---|---|
| SHA-256 fingerprints from a defined, reproducible form | Canonicalization, then hashing |
| Batches summarized by a Merkle tree, root published | Batching and Merkle tree construction |
| Every record can produce a membership proof | Merkle proof generation |
| Roots stored where the registry cannot silently rewrite them | Anchoring (append-only, hash-chained, or WORM store) |
| Independent verifier using only document + proof + published root | Standalone verifier, no registry DB access |
| Verifier reports which check failed | Distinct failure codes |
| Detect modified document, invalid proof, and stored record that no longer matches its published reference | Three tamper scenarios plus an audit job |
| Reject a tampered document even if the registry DB is altered | Verifier never trusts the DB |
| AI may extract metadata, suggest categories, explain failures | AI is advisory only, human-confirmed, never affects the verdict |
| No public blockchain; real cryptographic checking | No visual-only "green tick" |

---

## 3. Core Concepts

### 3.1 SHA-256 hash function

Maps any input to a fixed 256-bit (64 hex character) output.

- **Deterministic:** same input, same output.
- **Avalanche effect:** a tiny change produces a completely different hash.
- **One-way:** the input cannot be recovered from the hash.
- **Collision-resistant:** two different inputs with the same hash cannot be feasibly found.

This makes it suitable as a document fingerprint.

### 3.2 Canonicalization

Two byte-different files can represent the same document (re-saved PDF, reordered JSON keys, different line endings). Hashing inconsistently would make valid documents fail.

A **canonical form** guarantees the same document always yields the same bytes:

- Structured records: sorted keys, UTF-8, no extra whitespace, fixed date format (see JSON Canonicalization Scheme, RFC 8785).
- Files (e.g. PDF): hash the exact file bytes, optionally together with a canonical metadata record. State clearly which rule you use.

The verifier must apply the **same documented rule** independently.

### 3.3 Merkle tree

A binary tree of hashes:

- **Leaves:** hashes of individual records.
- **Parents:** hash of the two children concatenated.
- **Root:** one hash summarizing the entire batch.

Changing any record changes its leaf and every ancestor up to the root. One 32-byte root therefore commits to the whole batch, so only the root needs to be published.

### 3.4 Merkle membership proof

To prove a record is in a batch you only need the **sibling hashes along its path to the root**, about log2(n) hashes (roughly 20 for a million records).

Example with documents A, B, C, D:

```
            Root = H(H_AB + H_CD)
           /                      \
     H_AB = H(hA+hB)         H_CD = H(hC+hD)
      /        \               /        \
    hA         hB            hC         hD
```

Proof for C: `[hD (right), H_AB (left)]`.

Verifier steps:

1. Compute hC from the document.
2. Compute H_CD = H(hC + hD).
3. Compute Root' = H(H_AB + H_CD).
4. Compare Root' with the published root.

The proof must record left/right positions, since concatenation order matters.

### 3.5 Anchoring roots outside the registry's control

A published root is useless if the custodian can replace it. Options (no public blockchain needed):

- **Hash-chained root log:** each entry includes the previous entry's hash, so rewriting history breaks every later entry.
- **Signed roots (e.g. Ed25519):** proves the registry issued the root, but does not by itself stop later re-issuing; pair with an external store.
- **WORM / append-only storage:** e.g. object storage with object lock, which the registry process cannot modify.
- **Public Git repository / transparency log:** commit history is hash-chained and mirrored.
- **Independent witnesses:** several parties keep copies; disagreement exposes rewriting.

Pick one primary mechanism, explain why the registry cannot alter it, and state the trust assumption.

### 3.6 Independent verification

A separate program (CLI or web page) takes only:

1. the document
2. the proof
3. the published root

It must not call the registry database and must not trust proof fields it can recompute itself. This is what removes trust in the custodian.

### 3.7 Failure taxonomy

| Code | Meaning | Detection |
|---|---|---|
| `DOCUMENT_MODIFIED` | Document differs from the registered one | Recomputed leaf hash differs from the proof's leaf hash |
| `PROOF_INVALID` | Proof malformed or inconsistent | Path does not fold to the root the proof claims, or bad structure |
| `ROOT_MISMATCH` | Proof is internally consistent but root is not the published one | Computed root differs from published root |
| `ROOT_NOT_FOUND` | No published batch with that ID | Batch not in the root log |
| `OK` | All checks passed | |

If the path folds to the proof's own claimed root but that differs from the published root, it is `ROOT_MISMATCH`. If it does not fold to its own claimed root, it is `PROOF_INVALID`.

### 3.8 Tamper scenarios

1. **Modified document:** hash changes, leaf mismatches, `DOCUMENT_MODIFIED`.
2. **Invalid proof:** a sibling hash is altered or order is wrong, `PROOF_INVALID`.
3. **Registry DB altered:** an **audit job** recomputes leaves and the tree from stored records and compares to the published root, flagging "stored record no longer matches its published reference". Meanwhile the independent verifier still rejects the tampered document because it trusts only the published root.

### 3.9 The AI component and its boundary

Allowed:

- Extract metadata (issuer, date, document type).
- Suggest categories.
- Explain failures in plain language.

Constraints:

- A person must confirm extracted metadata.
- AI must **never** influence whether verification succeeds.

Keep AI in a separate module outside the verification path, and show the verifier gives identical results with AI disabled.

### 3.10 What the system does not prove

It proves integrity relative to a registered reference. It does not prove issuer legitimacy, truthfulness of contents, or honesty at registration time. Issuer digital signatures (Ed25519 / X.509) can be added as an extension; label them as such.

---

## 4. Proposed Architecture

```
Registry (untrusted)               External anchor            Verifier (independent)
┌──────────────────────┐          ┌───────────────┐          ┌─────────────────────┐
│ ingest → canonicalize│          │ append-only   │          │ input: doc + proof  │
│ → SHA-256 leaf       │          │ root log      │ ──────▶  │        + root       │
│ batch → Merkle tree  │ publish  │ (hash-chained,│          │ recompute leaf      │
│ store proofs in DB   │ ───────▶ │  signed, WORM)│          │ fold path → root    │
│ AI: metadata assist  │          └───────────────┘          │ compare → verdict   │
└──────────────────────┘                                     └─────────────────────┘
```

**Suggested stack:** Python or Node, FastAPI, SQLite/Postgres, JSON proof format, standalone `verify` CLI plus a small web page, an LLM API for the advisory features.

### Suggested proof format (example)

```json
{
  "version": 1,
  "batch_id": "batch-0007",
  "leaf_hash": "<hex>",
  "index": 2,
  "path": [
    {"hash": "<hex>", "position": "right"},
    {"hash": "<hex>", "position": "left"}
  ],
  "claimed_root": "<hex>"
}
```

---

## 5. Pitfalls to Avoid

- **Second-preimage attacks:** use domain separation: leaves `H(0x00 || data)`, internal nodes `H(0x01 || left || right)`.
- **Odd number of leaves:** choose and document a rule (promote the last node, or duplicate it; promotion is safer).
- **Unstable canonicalization:** test that hashes match across machines.
- **Verifier depending on registry code or DB:** breaks independence.
- **Visual-only "verified" indicator:** show real intermediate hashes.
- **AI output feeding the verdict:** keep it fully separate.

---

## 6. Demo Flow

1. Register 8 documents; show the batch root published to the external log.
2. Verify one document successfully and display the proof path.
3. Change one byte of the document: `DOCUMENT_MODIFIED`.
4. Corrupt a proof hash: `PROOF_INVALID`.
5. Tamper with the registry DB (record and stored root); run the audit job to flag it; show the independent verifier still rejects the forged document.
6. Show the AI explaining a failure in plain language, then disable AI and show the verdict is unchanged.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| Custodian | The party that holds and controls the registry |
| Fingerprint / hash | Fixed-size digest identifying a document |
| Canonical form | Single agreed byte representation of a document |
| Leaf | Hash of one record in a Merkle tree |
| Merkle root | Single hash summarizing a whole batch |
| Membership proof | Sibling hashes proving a leaf is under a root |
| Anchor | External, tamper-evident place where roots are published |
| WORM | Write once, read many storage |
| Audit job | Recomputes stored data and compares with published roots |
