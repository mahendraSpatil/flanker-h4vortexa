// Owner: Archit | Tests for verify.js: every result code on a 5-record batch, invariants, never-throw fuzzing
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_RESULT,
  RESULT,
  buildProof,
  buildTree,
  fileHash,
  getProof,
  leafHash,
  verify,
} from '../src/index.js';
import { ANCHOR, ISSUED_AT, PINNED, VECTORS, makeBatch, utf8 } from './fixtures.js';

const IDS = ['0', '0b', '1', '2', '3', '4a', '4b'];
const CHECK_KEYS = ['id', 'name', 'pass', 'computed', 'expected', 'detail'];
const ALL_PASS = Object.fromEntries(IDS.map((id) => [id, true]));
const ALL_SKIPPED_AFTER_0 = Object.fromEntries(IDS.map((id) => [id, id === '0' ? false : null]));
const ZERO_ROOT = '0x' + '0'.repeat(64);
const OTHER_CONTRACT = '0x' + 'ab'.repeat(20);
const SLIP = 2; // salary slip, "Net salary: Rs 50,000"
const TXT = 4; // .txt registered under text-v1

/** Genuine verify() arguments for one record of a fresh batch (safe to mutate). */
function argsFor(index = SLIP) {
  const batch = makeBatch();
  return {
    fileBytes: batch.files[index],
    proof: batch.proofs[index],
    chainBatch: batch.chainBatch,
    pinned: PINNED,
  };
}

/** verify() plus the invariants every result must satisfy. */
function check(args) {
  const result = verify(args);
  assert.deepEqual(Object.keys(result), ['verdict', 'checks', 'computed']);
  assert.deepEqual(
    result.checks.map((c) => c.id),
    IDS,
  );
  for (const c of result.checks) {
    assert.deepEqual(Object.keys(c), CHECK_KEYS);
    assert.ok([true, false, null].includes(c.pass), `check ${c.id} pass`);
    assert.ok(typeof c.detail === 'string' && c.detail.length > 0, `check ${c.id} detail`);
  }
  const failed = result.checks.find((c) => c.pass === false);
  assert.equal(result.verdict, failed ? CHECK_RESULT[failed.id] : RESULT.VALID);
  if (result.verdict === RESULT.VALID) {
    assert.equal(result.computed.root, args.chainBatch.root.toLowerCase());
  }
  return result;
}

const passes = (result) => Object.fromEntries(result.checks.map((c) => [c.id, c.pass]));
const byId = (result, id) => result.checks.find((c) => c.id === id);
const flipLastHex = (hex) => hex.slice(0, -1) + (hex.endsWith('0') ? '1' : '0');
const forgedSlip = () => utf8(VECTORS.records[SLIP].file.replace('50,000', '80,000'));

test('genuine documents are VALID with every check passing', () => {
  for (let i = 0; i < VECTORS.records.length; i++) {
    const args = argsFor(i);
    const result = check(args);
    assert.equal(result.verdict, RESULT.VALID, `record ${i}`);
    assert.deepEqual(passes(result), ALL_PASS);
    assert.deepEqual(result.computed, {
      fileHash: args.proof.fileHash,
      leaf: args.proof.leaf,
      root: args.chainBatch.root,
    });
  }
  const result = check(argsFor(SLIP));
  const registry = `eip155:31337:${PINNED.contract.toLowerCase()}`;
  const { proof, chainBatch } = argsFor(SLIP);
  assert.deepEqual(
    result.checks.map(({ id, computed, expected }) => [id, computed, expected]),
    [
      ['0', null, null],
      ['0b', registry, registry],
      ['1', proof.fileHash, proof.fileHash],
      ['2', proof.leaf, proof.leaf],
      ['3', proof.root, proof.root],
      ['4a', chainBatch.root, null],
      ['4b', proof.root, chainBatch.root],
    ],
  );
});

test('VALID implies computed.root (recomputed from the file) equals the on-chain root', () => {
  for (let i = 0; i < VECTORS.records.length; i++) {
    const args = argsFor(i);
    const result = verify(args);
    assert.equal(result.verdict, RESULT.VALID);
    assert.equal(result.computed.root, args.chainBatch.root);
  }
});

test('one flipped file byte (50,000 -> 80,000) -> DOCUMENT_MODIFIED; checks 2, 3, 4a, 4b pass', () => {
  const args = argsFor(SLIP);
  const forged = forgedSlip();
  assert.equal(forged.filter((byte, i) => byte !== args.fileBytes[i]).length, 1);
  const result = check({ ...args, fileBytes: forged });
  assert.equal(result.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.deepEqual(passes(result), { ...ALL_PASS, 1: false });
  assert.equal(byId(result, '1').computed, fileHash(forged));
  assert.notEqual(result.computed.root, args.chainBatch.root);
});

test('every single-bit flip, truncation or extension of the file fails at check 1', () => {
  const args = argsFor(SLIP);
  const bytes = args.fileBytes;
  const variants = [bytes.slice(0, -1), Uint8Array.from([...bytes, 0x20]), new Uint8Array(0)];
  for (let i = 0; i < bytes.length; i++) {
    const copy = bytes.slice();
    copy[i] ^= 0x01;
    variants.push(copy);
  }
  for (const fileBytes of variants) {
    assert.equal(verify({ ...args, fileBytes }).verdict, RESULT.DOCUMENT_MODIFIED);
  }
});

test('metadata edited in proof.json -> METADATA_MODIFIED; checks 1, 3, 4a, 4b pass', () => {
  const edits = {
    issuer: (proof) => (proof.metadata.issuer = 'Sahyadri Analytics Limited'),
    date: (proof) => (proof.metadata.date = '2026-07-30'),
    docType: (proof) => (proof.metadata.docType = 'OFFER_LETTER'),
    recordId: (proof) => (proof.recordId = 'REC-000009'),
  };
  for (const [field, edit] of Object.entries(edits)) {
    const args = argsFor(SLIP);
    edit(args.proof);
    const result = check(args);
    assert.equal(result.verdict, RESULT.METADATA_MODIFIED, field);
    assert.deepEqual(passes(result), { ...ALL_PASS, 2: false }, field);
  }
});

test('corrupted sibling hash -> PROOF_INVALID; check 4b still passes', () => {
  const args = argsFor(SLIP);
  args.proof.siblings[1].hash = flipLastHex(args.proof.siblings[1].hash);
  const result = check(args);
  assert.equal(result.verdict, RESULT.PROOF_INVALID);
  assert.deepEqual(passes(result), { ...ALL_PASS, 3: false });
});

test('flipped sibling side -> PROOF_INVALID, reported as a side mismatch', () => {
  const args = argsFor(SLIP);
  args.proof.siblings[0].pos = args.proof.siblings[0].pos === 'left' ? 'right' : 'left';
  const result = check(args);
  assert.equal(result.verdict, RESULT.PROOF_INVALID);
  assert.deepEqual(passes(result), { ...ALL_PASS, 3: false });
  assert.match(byId(result, '3').detail, /^Sibling sides \[left, left, right\] do not fit/);
});

test('leafIndex moved to another position with the same path length -> PROOF_INVALID', () => {
  // leafIndex is not hashed anywhere; only the sibling sides bind it to the path
  for (const leafIndex of [0, 1, 3]) {
    const args = argsFor(SLIP);
    args.proof.leafIndex = leafIndex;
    const result = check(args);
    assert.equal(result.verdict, RESULT.PROOF_INVALID, `leafIndex ${leafIndex}`);
    assert.deepEqual(passes(result), { ...ALL_PASS, 3: false });
    assert.equal(byId(result, '3').computed, args.proof.root); // the fold alone still reaches the root
  }
});

test('siblings in the wrong order -> PROOF_INVALID', () => {
  const args = argsFor(SLIP);
  args.proof.siblings.reverse(); // sides read right, left, right either way; hashes do not fold
  assert.equal(check(args).verdict, RESULT.PROOF_INVALID);
});

test('fake root in proof.json -> PROOF_INVALID (4b fails too)', () => {
  const args = argsFor(SLIP);
  args.proof.root = flipLastHex(args.proof.root);
  const result = check(args);
  assert.equal(result.verdict, RESULT.PROOF_INVALID);
  assert.deepEqual(passes(result), { ...ALL_PASS, 3: false, '4b': false });
});

test('attacker-built proof over the forged file -> ROOT_MISMATCH with checks 1-3 passing', () => {
  const batch = makeBatch();
  const forged = forgedSlip();
  const forgedRecord = { ...batch.records[SLIP], fileHash: fileHash(forged) };
  const leaves = batch.records.map(leafHash);
  leaves[SLIP] = leafHash(forgedRecord);
  const fake = buildTree(leaves);
  const proof = buildProof({
    record: forgedRecord,
    batchId: VECTORS.batchId,
    leafIndex: SLIP,
    leafCount: leaves.length,
    siblings: getProof(fake.levels, SLIP),
    root: fake.root,
    anchor: ANCHOR,
    fileNormalization: 'none',
    issuedAt: ISSUED_AT,
  });
  const result = check({ fileBytes: forged, proof, chainBatch: batch.chainBatch, pinned: PINNED });
  assert.equal(result.verdict, RESULT.ROOT_MISMATCH);
  assert.deepEqual(passes(result), { ...ALL_PASS, '4b': false });
  assert.equal(byId(result, '4b').computed, fake.root);
  assert.equal(byId(result, '4b').expected, batch.root);
});

test('unpublished batch (null, zero or malformed root) -> BATCH_NOT_PUBLISHED; 4b skipped', () => {
  const unpublished = [
    null,
    undefined,
    { root: ZERO_ROOT, leafCount: 0 },
    { root: '0x1234', leafCount: 5 },
    { leafCount: 5 },
  ];
  for (const chainBatch of unpublished) {
    const result = check({ ...argsFor(SLIP), chainBatch });
    assert.equal(result.verdict, RESULT.BATCH_NOT_PUBLISHED, JSON.stringify(chainBatch));
    assert.deepEqual(passes(result), { ...ALL_PASS, '4a': false, '4b': null });
  }
});

test('anchor naming another registry -> REGISTRY_MISMATCH; checks 1 to 4b still run', () => {
  const pinnedElsewhere = [
    { chainId: 31337, contract: OTHER_CONTRACT },
    { chainId: 1, contract: PINNED.contract },
  ];
  for (const pinned of pinnedElsewhere) {
    const result = check({ ...argsFor(SLIP), pinned });
    assert.equal(result.verdict, RESULT.REGISTRY_MISMATCH);
    assert.deepEqual(passes(result), { ...ALL_PASS, '0b': false });
  }
  // An attacker pointing proof.anchor at their own contract gets the same verdict
  const args = argsFor(SLIP);
  args.proof.anchor.contract = OTHER_CONTRACT;
  assert.equal(check(args).verdict, RESULT.REGISTRY_MISMATCH);
});

test('registry comparison ignores address case', () => {
  const pinned = { chainId: PINNED.chainId, contract: PINNED.contract.toLowerCase() };
  assert.equal(check({ ...argsFor(SLIP), pinned }).verdict, RESULT.VALID);
});

test('leafCount differing from the chain -> ROOT_MISMATCH', () => {
  const args = argsFor(SLIP);
  const result = check({ ...args, chainBatch: { root: args.chainBatch.root, leafCount: 6 } });
  assert.equal(result.verdict, RESULT.ROOT_MISMATCH);
  assert.deepEqual(passes(result), { ...ALL_PASS, '4b': false });
  assert.match(byId(result, '4b').detail, /leafCount 5 differs from on-chain 6/);
});

test('chainBatch root in any case and a bigint leafCount are accepted', () => {
  const args = argsFor(SLIP);
  const root = '0x' + args.chainBatch.root.slice(2).toUpperCase();
  assert.equal(check({ ...args, chainBatch: { root, leafCount: 5n } }).verdict, RESULT.VALID);
});

test('malformed input -> FORMAT_INVALID without throwing; every later check skipped', () => {
  const upper = (hex) => '0x' + hex.slice(2).toUpperCase();
  const cases = {
    'missing field': (a) => delete a.proof.leaf,
    'uppercase hex': (a) => (a.proof.root = upper(a.proof.root)),
    'short fileHash': (a) => (a.proof.fileHash = a.proof.fileHash.slice(0, 40)),
    'extra sibling': (a) => a.proof.siblings.push({ ...a.proof.siblings[0] }),
    'missing sibling': (a) => a.proof.siblings.pop(),
    'leafIndex >= leafCount': (a) => (a.proof.leafIndex = a.proof.leafCount),
    'negative leafIndex': (a) => (a.proof.leafIndex = -1),
    'proof = null': (a) => (a.proof = null),
    'proof as a JSON string': (a) => (a.proof = JSON.stringify(a.proof)),
    'proof as an array': (a) => (a.proof = [a.proof]),
    'other hash scheme': (a) => (a.proof.scheme.hash = 'keccak256'),
    'other odd-node rule': (a) => (a.proof.scheme.oddNode = 'duplicate'),
    'version 2': (a) => (a.proof.v = 2),
    'unexpected field': (a) => (a.proof.note = 'trust me'),
    'issuer not normalised': (a) => (a.proof.metadata.issuer += ' '),
    'impossible date': (a) => (a.proof.metadata.date = '2026-02-30'),
    'bad batchId': (a) => (a.proof.batchId = 'BATCH-7'),
    'string leafCount': (a) => (a.proof.leafCount = '5'),
    'fileBytes missing': (a) => (a.fileBytes = undefined),
    'fileBytes as ArrayBuffer': (a) => (a.fileBytes = a.fileBytes.buffer),
    'fileBytes as string': (a) => (a.fileBytes = VECTORS.records[SLIP].file),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const args = argsFor(SLIP);
    mutate(args);
    let result;
    assert.doesNotThrow(() => (result = check(args)), name);
    assert.equal(result.verdict, RESULT.FORMAT_INVALID, name);
    assert.deepEqual(passes(result), ALL_SKIPPED_AFTER_0, name);
    assert.deepEqual(result.computed, { fileHash: null, leaf: null, root: null }, name);
  }
});

test('.txt registered under text-v1 verifies VALID after its line endings change', () => {
  const args = argsFor(TXT);
  const { file, normalizedFile } = VECTORS.records[TXT];
  assert.equal(args.proof.scheme.fileNormalization, 'text-v1');
  assert.match(file, /\r\n/);
  const variants = [
    file.replace(/\r\n/g, '\n'), // LF
    file.replace(/\r\n/g, '\r'), // old Mac CR
    file.replace(/\r\n/g, ' \t\n'), // trailing blanks
    normalizedFile,
  ];
  for (const text of variants) {
    assert.equal(check({ ...args, fileBytes: utf8(text) }).verdict, RESULT.VALID);
  }
  const edited = utf8(file.replace('2023', '2021'));
  assert.equal(check({ ...args, fileBytes: edited }).verdict, RESULT.DOCUMENT_MODIFIED);
});

test('text-v1 file that is not valid UTF-8 -> DOCUMENT_MODIFIED, not a crash', () => {
  const args = argsFor(TXT);
  const result = check({ ...args, fileBytes: Uint8Array.from([0x45, 0xff, 0x58]) });
  assert.equal(result.verdict, RESULT.DOCUMENT_MODIFIED);
  assert.equal(byId(result, '1').computed, null);
  assert.match(byId(result, '1').detail, /not valid UTF-8/);
  assert.deepEqual(result.computed, { fileHash: null, leaf: null, root: null });
});

test('checks 0b to 4a are independent: every failure is reported, the first is the verdict', () => {
  const args = argsFor(SLIP);
  const result = check({
    ...args,
    fileBytes: forgedSlip(),
    chainBatch: null,
    pinned: { chainId: 31337, contract: OTHER_CONTRACT },
  });
  assert.equal(result.verdict, RESULT.REGISTRY_MISMATCH);
  assert.deepEqual(passes(result), { ...ALL_PASS, '0b': false, 1: false, '4a': false, '4b': null });
});

test('misconfigured pinned registry throws TypeError (a programming error)', () => {
  const args = argsFor(SLIP);
  const bad = [
    undefined,
    null,
    {},
    { chainId: '31337', contract: PINNED.contract },
    { chainId: 0, contract: PINNED.contract },
    { chainId: 31337, contract: '0x1234' },
    { chainId: 31337 },
  ];
  for (const pinned of bad) assert.throws(() => verify({ ...args, pinned }), TypeError);
  assert.throws(() => verify(), TypeError);
});

test('verify does not mutate its inputs', () => {
  const args = argsFor(SLIP);
  const deepFreeze = (value) => {
    if (value && typeof value === 'object') Object.values(Object.freeze(value)).forEach(deepFreeze);
    return value;
  };
  const before = JSON.stringify(args.proof);
  const fileCopy = args.fileBytes.slice();
  deepFreeze(args.proof);
  deepFreeze(args.chainBatch);
  assert.equal(check(args).verdict, RESULT.VALID);
  assert.equal(check({ ...args, fileBytes: forgedSlip() }).verdict, RESULT.DOCUMENT_MODIFIED);
  assert.equal(JSON.stringify(args.proof), before);
  assert.deepEqual(args.fileBytes, fileCopy);
});

// Deterministic PRNG so a failing fuzz case can be replayed
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pathsOf(value, path = []) {
  const children =
    value && typeof value === 'object'
      ? Object.keys(value).flatMap((key) => pathsOf(value[key], [...path, key]))
      : [];
  return [path, ...children];
}

test('fuzz: 1500 random proof.json mutations never throw and never pass with altered content', () => {
  const random = mulberry32(Number(process.env.FUZZ_SEED ?? 20261011)); // FUZZ_SEED replays/explores
  const pick = (items) => items[Math.floor(random() * items.length)];
  const junk = [undefined, null, 0, 1, 2, 3, 4, 5, -1, 1.5, 2 ** 32, '', 'x', '0x', 'left', true];
  junk.push(ZERO_ROOT, '0x' + 'F'.repeat(64), [], {}, { hash: ZERO_ROOT, pos: 'left' });
  // Everything except the display-only anchor and issuedAt; VALID requires all of it unchanged
  const SECURED = ['v', 'scheme', 'recordId', 'metadata', 'fileHash', 'leaf', 'batchId'];
  SECURED.push('leafIndex', 'leafCount', 'siblings', 'root');
  // The chain as the verifier app sees it: it reads the batch that proof.batchId names
  const published = new Map([
    [VECTORS.batchId, { root: VECTORS.root, leafCount: VECTORS.leaves.length }],
  ]);

  for (let round = 0; round < 1500; round++) {
    const args = argsFor(pick([SLIP, TXT, 0]));
    const original = structuredClone(args.proof);
    for (let edits = 1 + Math.floor(random() * 3); edits > 0; edits--) {
      const path = pick(pathsOf(args.proof).filter((p) => p.length > 0));
      const parent = path.slice(0, -1).reduce((node, key) => node?.[key], args.proof);
      if (!parent || typeof parent !== 'object') continue;
      const key = path[path.length - 1];
      const current = parent[key];
      const action = random();
      if (action < 0.2) delete parent[key];
      else if (action < 0.6 && typeof current === 'string' && current.length > 0) {
        const at = Math.floor(random() * current.length);
        parent[key] =
          current.slice(0, at) + pick([...'0123456789abcdefABX -']) + current.slice(at + 1);
      } else parent[key] = structuredClone(pick(junk));
    }
    args.chainBatch = published.get(args.proof.batchId) ?? null;
    let result;
    assert.doesNotThrow(() => (result = check(args)), `round ${round}`);
    if (result.verdict === RESULT.VALID) {
      for (const field of SECURED) {
        assert.deepEqual(args.proof[field], original[field], `round ${round}: ${field}`);
      }
    }
  }
});
