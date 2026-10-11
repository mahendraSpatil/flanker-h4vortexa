// Owner: Archit | Assemble proof.json for one anchored record (shape locked in CLAUDE.md "proof.json")
import { normText } from './canonical.js';
import {
  BATCH_ID,
  FIELD_SCHEME,
  FILE_NORMALIZATION,
  HEX32,
  PROOF_VERSIONS,
  SCHEME,
} from './constants.js';
import { buildFieldTree, validateFields } from './fields.js';
import { leafHash, validateRecord } from './hash.js';
import { expectedPathLength, expectedPositions, foldProof } from './merkle.js';

// Key order of every object in proof.json, as in CLAUDE.md. v2 adds fieldsRoot and fields.
const PROOF_KEYS = [
  'v',
  'scheme',
  'recordId',
  'metadata',
  'fileHash',
  'leaf',
  'batchId',
  'leafIndex',
  'leafCount',
  'siblings',
  'root',
  'anchor',
  'issuedAt',
];
const PROOF_KEYS_V2 = PROOF_KEYS.toSpliced(PROOF_KEYS.indexOf('leaf'), 0, 'fieldsRoot', 'fields');
const SCHEME_KEYS = ['hash', 'leafPrefix', 'nodePrefix', 'canonicalization', 'oddNode'];
const METADATA_KEYS = ['docType', 'issuer', 'date'];
const SIBLING_KEYS = ['hash', 'pos'];
const ANCHOR_KEYS = ['chainId', 'contract', 'txHash', 'blockNumber'];

const NORMALIZATIONS = Object.values(FILE_NORMALIZATION);
const UINT32_MAX = 0xffffffff; // on-chain leafCount is a uint32
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const HEX32_MESSAGE = 'must be 0x followed by 64 lowercase hex characters';

/**
 * Build the proof.json object for one record. `leaf` is computed from the record, never accepted.
 * The result is self-checked (validateProof, sibling sides, fold reaches root), so the registry
 * never issues a proof that a correct verifier would reject.
 *
 * Output fields, in order: v, scheme { hash, leafPrefix, nodePrefix, canonicalization, oddNode,
 * fileNormalization }, recordId, metadata { docType, issuer, date }, fileHash, [fieldsRoot,
 * fields: v2 only], leaf, batchId, leafIndex, leafCount, siblings, root, anchor, issuedAt (ISO 8601 UTC).
 *
 * With `fields` the proof is v2: fieldsRoot = buildFieldTree(fields).root goes into the record
 * (a record.fieldsRoot, if given, must equal it). Without `fields` it is v1, as before field trees.
 *
 * @param {object} args
 * @param {{ recordId: string, fileHash: string, fieldsRoot?: string, docType: string, issuer: string, date: string }} args.record confirmed record
 * @param {Array<{ name: string, value: string, salt: string }>} [args.fields] normalised, salted, in schema order
 * @param {string} args.batchId e.g. "BATCH-0007"
 * @param {number} args.leafIndex
 * @param {number} args.leafCount
 * @param {import('./merkle.js').Sibling[]} args.siblings from getProof
 * @param {string} args.root batch root
 * @param {{ chainId: number, contract: string, txHash: string, blockNumber: number }} args.anchor display only
 * @param {'none' | 'text-v1'} args.fileNormalization how fileHash was computed
 * @param {string} [args.issuedAt] defaults to now; pass a fixed value for reproducible output
 * @returns {object} proof.json object
 * @throws {Error} code 'INVALID_RECORD' (bad record) or 'INVALID_PROOF' (any other bad argument)
 */
export function buildProof({
  record,
  fields,
  batchId,
  leafIndex,
  leafCount,
  siblings,
  root,
  anchor,
  fileNormalization,
  issuedAt = new Date().toISOString(),
}) {
  const leafRecord = fields === undefined ? v1Record(record) : withFieldsRoot(record, fields);
  const leaf = leafHash(leafRecord);
  const proof = {
    v: fields === undefined ? SCHEME.v : FIELD_SCHEME.v,
    scheme: {
      hash: SCHEME.hash,
      leafPrefix: SCHEME.leafPrefix,
      nodePrefix: SCHEME.nodePrefix,
      canonicalization: SCHEME.canonicalization,
      oddNode: SCHEME.oddNode,
      fileNormalization,
    },
    recordId: record.recordId,
    metadata: { docType: record.docType, issuer: normText(record.issuer), date: record.date },
    fileHash: record.fileHash,
    ...(fields === undefined
      ? {}
      : {
          fieldsRoot: leafRecord.fieldsRoot,
          fields: fields.map(({ name, value, salt }) => ({ name, value, salt })),
        }),
    leaf,
    batchId,
    leafIndex,
    leafCount,
    siblings: Array.isArray(siblings)
      ? siblings.map((s) => ({ hash: lower(s?.hash), pos: s?.pos }))
      : siblings,
    root: lower(root),
    anchor: isObject(anchor)
      ? {
          chainId: anchor.chainId,
          contract: anchor.contract,
          txHash: lower(anchor.txHash),
          blockNumber: anchor.blockNumber,
        }
      : anchor,
    issuedAt,
  };
  const { ok, errors } = validateProof(proof);
  if (!ok) throw invalidProof(errors);
  const sides = proof.siblings.map((s) => s.pos).join();
  if (sides !== expectedPositions(leafIndex, leafCount).join()) {
    throw invalidProof({ siblings: `sides do not match leafIndex ${leafIndex} of ${leafCount}` });
  }
  if (foldProof(leaf, proof.siblings) !== proof.root) {
    throw invalidProof({ root: 'is not reached by folding the siblings from the leaf' });
  }
  return proof;
}

// A record with a fieldsRoot must come with its fields, or the proof would not rebuild its leaf
function v1Record(record) {
  if (record?.fieldsRoot !== undefined) {
    throw invalidProof({ fields: 'are required for a record with a fieldsRoot (v2)' });
  }
  return record;
}

function withFieldsRoot(record, fields) {
  const { ok, errors } = validateFields(record?.docType, fields);
  if (!ok) throw invalidProof(errors);
  const { root } = buildFieldTree(fields);
  if (record?.fieldsRoot !== undefined && record.fieldsRoot !== root) {
    throw invalidProof({ fieldsRoot: 'is not the root of fields' });
  }
  return { ...record, fieldsRoot: root };
}

/**
 * Structural check of a parsed proof.json (verification check 0): exact keys at every level
 * (v2 adds fieldsRoot and fields), v and scheme equal ours, metadata passes validateRecord with
 * the issuer already normalised, hex formats, 0 <= leafIndex < leafCount, siblings.length ===
 * expectedPathLength, and for v2 the fields fit the docType's schema (validateFields).
 * Never throws, whatever the input.
 * @param {unknown} proof
 * @returns {{ ok: boolean, errors: Object<string, string> }} errors maps a path such as
 *   "metadata.issuer" or "siblings[2].pos" to a message
 */
export function validateProof(proof) {
  if (!isObject(proof)) return { ok: false, errors: { proof: 'must be a JSON object' } };
  // A Map, then Object.fromEntries: a plain object would silently drop an error keyed "__proto__"
  const errors = new Map();
  const fail = (path, message) => {
    if (!errors.has(path)) errors.set(path, message);
  };
  const isV2 = proof.v === FIELD_SCHEME.v;
  checkKeys(proof, isV2 ? PROOF_KEYS_V2 : PROOF_KEYS, '', fail);
  if (!PROOF_VERSIONS.includes(proof.v)) fail('v', `must be one of ${PROOF_VERSIONS.join(', ')}`);
  checkScheme(proof.scheme, fail);
  checkRecordFields(proof, isV2, fail);
  if (!isHex32(proof.leaf)) fail('leaf', HEX32_MESSAGE);
  if (!isHex32(proof.root)) fail('root', HEX32_MESSAGE);
  if (typeof proof.batchId !== 'string' || !BATCH_ID.test(proof.batchId)) {
    fail('batchId', 'must be BATCH- followed by 4 digits');
  }
  checkPosition(proof, fail);
  checkAnchor(proof.anchor, fail);
  if (!isIsoUtc(proof.issuedAt)) {
    fail('issuedAt', 'must be an ISO 8601 UTC timestamp such as 2026-10-11T12:40:00Z');
  }
  return { ok: errors.size === 0, errors: Object.fromEntries(errors) };
}

function checkScheme(scheme, fail) {
  if (!isObject(scheme)) {
    fail('scheme', 'must be an object');
    return;
  }
  checkKeys(scheme, [...SCHEME_KEYS, 'fileNormalization'], 'scheme.', fail);
  for (const key of SCHEME_KEYS) {
    if (scheme[key] !== SCHEME[key]) fail(`scheme.${key}`, `must be "${SCHEME[key]}"`);
  }
  if (!NORMALIZATIONS.includes(scheme.fileNormalization)) {
    fail('scheme.fileNormalization', `must be one of ${NORMALIZATIONS.join(', ')}`);
  }
}

// recordId, fileHash, metadata (and fieldsRoot in v2) are exactly the record that went into the leaf
function checkRecordFields(proof, isV2, fail) {
  const metadata = isObject(proof.metadata) ? proof.metadata : null;
  if (metadata) checkKeys(metadata, METADATA_KEYS, 'metadata.', fail);
  else fail('metadata', 'must be an object');
  const { errors } = validateRecord({
    recordId: proof.recordId,
    fileHash: proof.fileHash,
    ...(isV2 ? { fieldsRoot: proof.fieldsRoot ?? null } : {}),
    docType: metadata?.docType,
    issuer: metadata?.issuer,
    date: metadata?.date,
  });
  for (const [field, message] of Object.entries(errors)) {
    if (['recordId', 'fileHash', 'fieldsRoot'].includes(field)) fail(field, message);
    else if (metadata) fail(`metadata.${field}`, message);
  }
  if (isV2) {
    const fieldCheck = validateFields(metadata?.docType, proof.fields);
    for (const [path, message] of Object.entries(fieldCheck.errors)) fail(path, message);
  }
  // Display shows exactly the hashed value, so it must already be in canonical form
  if (metadata && !errors.issuer && metadata.issuer !== normText(metadata.issuer)) {
    fail('metadata.issuer', 'must already be normalised (NFC, trimmed, single spaces)');
  }
}

function checkPosition(proof, fail) {
  const { leafIndex, leafCount, siblings } = proof;
  const countOk = Number.isSafeInteger(leafCount) && leafCount >= 1 && leafCount <= UINT32_MAX;
  if (!countOk) fail('leafCount', `must be an integer from 1 to ${UINT32_MAX}`);
  const indexOk =
    Number.isSafeInteger(leafIndex) && leafIndex >= 0 && (!countOk || leafIndex < leafCount);
  if (!indexOk) {
    fail('leafIndex', countOk ? `must be an integer from 0 to ${leafCount - 1}` : 'must be >= 0');
  }
  if (!Array.isArray(siblings)) {
    fail('siblings', 'must be an array');
    return;
  }
  // Report only the first bad entry; a huge forged array should not produce a huge report
  for (let i = 0; i < siblings.length; i++) {
    if (!checkSibling(siblings[i], `siblings[${i}]`, fail)) break;
  }
  if (countOk && indexOk) {
    const length = expectedPathLength(leafIndex, leafCount);
    if (siblings.length !== length) {
      fail(
        'siblings',
        `must have ${length} entries for leafIndex ${leafIndex} of ${leafCount}, got ${siblings.length}`,
      );
    }
  }
}

function checkSibling(entry, path, fail) {
  if (!isObject(entry)) {
    fail(path, 'must be an object with hash and pos');
    return false;
  }
  let ok = checkKeys(entry, SIBLING_KEYS, `${path}.`, fail);
  if (!isHex32(entry.hash)) {
    fail(`${path}.hash`, HEX32_MESSAGE);
    ok = false;
  }
  if (entry.pos !== 'left' && entry.pos !== 'right') {
    fail(`${path}.pos`, 'must be "left" or "right"');
    ok = false;
  }
  return ok;
}

function checkAnchor(anchor, fail) {
  if (!isObject(anchor)) {
    fail('anchor', 'must be an object');
    return;
  }
  checkKeys(anchor, ANCHOR_KEYS, 'anchor.', fail);
  if (!Number.isSafeInteger(anchor.chainId) || anchor.chainId < 1) {
    fail('anchor.chainId', 'must be a positive integer');
  }
  if (typeof anchor.contract !== 'string' || !ADDRESS.test(anchor.contract)) {
    fail('anchor.contract', 'must be 0x followed by 40 hex characters');
  }
  if (!isHex32(anchor.txHash)) fail('anchor.txHash', HEX32_MESSAGE);
  if (!Number.isSafeInteger(anchor.blockNumber) || anchor.blockNumber < 0) {
    fail('anchor.blockNumber', 'must be a non-negative integer');
  }
}

// Exact key set: every listed key present, nothing else
function checkKeys(object, keys, prefix, fail) {
  let ok = true;
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) {
      fail(prefix + key, 'is required');
      ok = false;
    }
  }
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) {
      fail(prefix + key, 'is not allowed');
      ok = false;
    }
  }
  return ok;
}

function invalidProof(errors) {
  const summary = Object.entries(errors).map(([path, message]) => `${path} ${message}`);
  return Object.assign(new Error(`Invalid proof: ${summary.join('; ')}`), {
    code: 'INVALID_PROOF',
    errors,
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHex32(value) {
  return typeof value === 'string' && HEX32.test(value);
}

function isIsoUtc(value) {
  return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : value;
}
