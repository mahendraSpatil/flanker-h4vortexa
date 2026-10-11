// Owner: Archit | Independent verification: checks 0-4 over file + proof + on-chain batch
import { CHECK_RESULT, FIELD_SCHEME, FILE_NORMALIZATION, HEX32, RESULT } from './constants.js';
import { buildFieldTree, describeFields, diffFields, extractFields } from './fields.js';
import { fileHash, leafHash, normalizeTextFile } from './hash.js';
import { expectedPositions, foldProof } from './merkle.js';
import { validateProof } from './proof.js';

/**
 * @typedef {object} Check
 * @property {string} id '0' | '0b' | '1' | '2' | '2b' | '3' | '4a' | '4b'
 * @property {string} name human-readable check name, e.g. "File hash"
 * @property {boolean | null} pass null when the check was skipped
 * @property {string | null} computed value the verifier computed ('0b', '4b': the value proof.json claims)
 * @property {string | null} expected value it was compared against
 * @property {string} detail one sentence for the results table
 */

/** Every result has exactly these checks, in this order. */
const CHECKS = [
  ['0', 'Proof format'],
  ['0b', 'Registry'],
  ['1', 'File hash'],
  ['2', 'Leaf'],
  ['2b', 'Field values match fieldsRoot'],
  ['3', 'Merkle path'],
  ['4a', 'Batch published'],
  ['4b', 'Root'],
];
const ZERO_ROOT = '0x' + '0'.repeat(64);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** fieldDiff.reason when there is no text to read fields from (an image, a scan). */
export const FIELD_DIFF_NEEDS_TEXT =
  'field comparison needs a PDF with selectable text or a .txt file';
/** fieldDiff.note when the bytes differ but every registered field reads the same. */
export const FIELD_DIFF_CONTENT_MATCH =
  'File differs from the registered original, but every registered field matches (content match, not proof).';

/**
 * Run every check and report the first failure as the verdict. Pure and synchronous; never talks
 * to the chain: the caller reads getBatch(batchId) from the pinned contract and passes it in.
 * Never throws on bad file or proof input (that is FORMAT_INVALID); throws only when `pinned`
 * itself is misconfigured, which is a programming error.
 *
 * Check '0' gates everything: if it fails, every later check is skipped (pass null). Checks
 * '0b' to '4a' are independent and all run; '2b' is skipped for v1 proofs (no field tree) and
 * '4b' is skipped when '4a' fails.
 *
 * Fields never decide the verdict. When check 2b passes, `registeredFields` lists the values the
 * proof commits to. When a v2 verdict is DOCUMENT_MODIFIED, `fieldDiff` compares them with the
 * values read from the file's text: an explanation shown beside the verdict, nothing more.
 *
 * @param {object} args
 * @param {Uint8Array} args.fileBytes raw bytes of the uploaded document
 * @param {unknown} args.proof parsed proof.json (every field untrusted)
 * @param {{ root: string, leafCount: number } | null} args.chainBatch on-chain batch; null or a zero root = unpublished
 * @param {{ chainId: number, contract: string }} args.pinned verifier's own pinned registry
 * @param {string | null} [args.fileText] text of the uploaded file (a PDF's text layer), used only
 *   for fieldDiff; a text-v1 (.txt) file is decoded here, so callers need not pass it
 * @returns {{ verdict: string, checks: Check[], computed: { fileHash: string|null, leaf: string|null, root: string|null },
 *   registeredFields?: Array<{ name: string, label: string, value: string, display: string }>,
 *   fieldDiff?: { available: boolean, reason?: string, fields: Array<{ name: string, label: string,
 *     registered: string, found: string|null, status: 'match'|'changed'|'unreadable' }>, note?: string } }}
 *   verdict is CHECK_RESULT[id] of the first failing check, else VALID. `computed` is recomputed
 *   from the actual file (leaf from its hash, root by folding that leaf), for display.
 * @throws {TypeError} when pinned is not { chainId: positive integer, contract: 0x address }
 */
export function verify({ fileBytes, proof, chainBatch, pinned, fileText = null } = {}) {
  const registry = readPinned(pinned);
  const { results, computed } = runChecks(fileBytes, proof, readChainBatch(chainBatch), registry);
  const checks = CHECKS.map(([id, name]) => ({
    id,
    name,
    pass: null,
    computed: null,
    expected: null,
    detail: '',
    ...results[id],
  }));
  const failed = checks.find((check) => check.pass === false);
  const result = { verdict: failed ? CHECK_RESULT[failed.id] : RESULT.VALID, checks, computed };
  if (results['2b']?.pass === true) result.registeredFields = describeFields(proof.fields);
  if (result.verdict === RESULT.DOCUMENT_MODIFIED && proof.v === FIELD_SCHEME.v) {
    result.fieldDiff = explainFileChange(checks, proof, fileBytes, fileText);
  }
  return result;
}

function runChecks(fileBytes, proof, chain, registry) {
  const format = checkFormat(fileBytes, proof);
  if (!format.pass) {
    const skipped = skip('proof.json must be well-formed first (check 0)');
    const results = Object.fromEntries(CHECKS.map(([id]) => [id, skipped]));
    return { results: { ...results, 0: format }, computed: recompute(null, proof) };
  }
  const file = checkFile(fileBytes, proof);
  return {
    results: {
      0: format,
      '0b': checkRegistry(proof.anchor, registry),
      1: file,
      2: checkLeaf(proof),
      '2b':
        proof.v === FIELD_SCHEME.v
          ? checkFields(proof)
          : skip('v1 proofs carry no field values (check 2b is for v2 proofs)'),
      3: checkPath(proof),
      '4a': checkPublished(chain, proof.batchId),
      '4b': chain ? checkRoot(proof, chain) : skip('the batch has no root on chain (check 4a)'),
    },
    computed: recompute(file.computed, proof),
  };
}

function checkFormat(fileBytes, proof) {
  const { errors } = validateProof(proof);
  const problems = Object.entries(errors).map(([path, message]) => `${path} ${message}`);
  if (!(fileBytes instanceof Uint8Array)) problems.unshift('fileBytes must be a Uint8Array');
  if (problems.length > 0)
    return { pass: false, detail: `Malformed input: ${problems.join('; ')}.` };
  const { scheme, leafIndex, leafCount, siblings } = proof;
  return {
    pass: true,
    detail:
      `Well-formed v${proof.v} proof (${scheme.fileNormalization}): leafIndex ${leafIndex} ` +
      `of ${leafCount}, ${siblings.length} sibling(s).`,
  };
}

// anchor is display-only; trust comes from the verifier's own pinned registry
function checkRegistry(anchor, registry) {
  const pass =
    anchor.chainId === registry.chainId &&
    anchor.contract.toLowerCase() === registry.contract.toLowerCase();
  return {
    pass,
    computed: caip10(anchor.chainId, anchor.contract),
    expected: caip10(registry.chainId, registry.contract),
    detail: pass
      ? 'proof.anchor names the pinned registry.'
      : 'proof.anchor names a different chain or contract; only the pinned registry is trusted.',
  };
}

function checkFile(fileBytes, proof) {
  const expected = proof.fileHash;
  let computed;
  try {
    computed = fileHash(fileBytes, { normalization: proof.scheme.fileNormalization });
  } catch (error) {
    const reason =
      error?.code === 'INVALID_TEXT_ENCODING'
        ? 'it is not valid UTF-8 text, so it cannot be the registered text-v1 file'
        : 'it could not be hashed';
    return { pass: false, computed: null, expected, detail: `Not the registered file: ${reason}.` };
  }
  const pass = computed === expected;
  return {
    pass,
    computed,
    expected,
    detail: pass
      ? 'The file hashes to proof.fileHash.'
      : 'Not the registered file: its SHA-256 differs from proof.fileHash.',
  };
}

// Uses proof.fileHash, not the file, so this check isolates metadata edits from file edits
function checkLeaf(proof) {
  const computed = leafHash(recordOf(proof, proof.fileHash));
  const pass = computed === proof.leaf;
  const parts = proof.v === FIELD_SCHEME.v ? 'fileHash, fieldsRoot' : 'fileHash';
  return {
    pass,
    computed,
    expected: proof.leaf,
    detail: pass
      ? `recordId, ${parts} and metadata rebuild proof.leaf.`
      : `recordId, ${parts} or metadata in proof.json do not rebuild proof.leaf.`,
  };
}

// The disclosed values must be exactly the ones committed to by the record's fieldsRoot
function checkFields(proof) {
  const computed = buildFieldTree(proof.fields).root;
  const pass = computed === proof.fieldsRoot;
  const count = proof.fields.length;
  return {
    pass,
    computed,
    expected: proof.fieldsRoot,
    detail: pass
      ? `The ${count} field value(s) in proof.fields rebuild fieldsRoot.`
      : 'The field values in proof.fields do not rebuild fieldsRoot.',
  };
}

function checkPath(proof) {
  const { leaf, leafIndex, leafCount, siblings, root } = proof;
  const sides = siblings.map((sibling) => sibling.pos);
  const expectedSides = expectedPositions(leafIndex, leafCount);
  const sidesOk = sides.join() === expectedSides.join();
  const computed = foldProof(leaf, siblings);
  const reachesRoot = computed === root;
  let detail = 'Folding the siblings from proof.leaf reaches proof.root.';
  if (!sidesOk) {
    detail =
      `Sibling sides [${sides.join(', ')}] do not fit leafIndex ${leafIndex} of ${leafCount} ` +
      `(expected [${expectedSides.join(', ')}]).`;
  } else if (!reachesRoot) {
    detail = 'Folding the siblings from proof.leaf does not reach proof.root.';
  }
  return { pass: sidesOk && reachesRoot, computed, expected: root, detail };
}

function checkPublished(chain, batchId) {
  return chain
    ? { pass: true, computed: chain.root, detail: `${batchId} has a root on the pinned contract.` }
    : { pass: false, detail: `The pinned contract has no root for ${batchId}.` };
}

function checkRoot(proof, chain) {
  const problems = [];
  if (proof.root !== chain.root) problems.push('proof.root differs from the on-chain root');
  if (proof.leafCount !== chain.leafCount) {
    problems.push(`proof.leafCount ${proof.leafCount} differs from on-chain ${chain.leafCount}`);
  }
  return {
    pass: problems.length === 0,
    computed: proof.root,
    expected: chain.root,
    detail:
      problems.length === 0
        ? 'proof.root and leafCount equal the values published on chain.'
        : `${problems.join('; ')}.`,
  };
}

// Values from the actual file: leaf from its hash, root by folding that leaf up the proof's path
function recompute(actualFileHash, proof) {
  if (!actualFileHash) return { fileHash: null, leaf: null, root: null };
  const leaf = leafHash(recordOf(proof, actualFileHash));
  return { fileHash: actualFileHash, leaf, root: foldProof(leaf, proof.siblings) };
}

function recordOf(proof, hash) {
  const { docType, issuer, date } = proof.metadata;
  const record = { recordId: proof.recordId, fileHash: hash, docType, issuer, date };
  return proof.v === FIELD_SCHEME.v ? { ...record, fieldsRoot: proof.fieldsRoot } : record;
}

// Explanation of a DOCUMENT_MODIFIED: which registered fields the file still shows, and which not
function explainFileChange(checks, proof, fileBytes, fileText) {
  const untrusted = checks.find((check) => check.id !== '1' && check.pass !== true);
  if (untrusted) {
    return unavailable(
      `the proof itself failed check ${untrusted.id}, so its field values are not known to be registered`,
    );
  }
  if (proof.fields.length === 0) {
    return unavailable(`no fields are registered for ${proof.metadata.docType}`);
  }
  const text =
    typeof fileText === 'string' && fileText.trim() !== ''
      ? fileText
      : textFileOf(fileBytes, proof);
  if (text === null) return unavailable(FIELD_DIFF_NEEDS_TEXT);
  const fields = diffFields(proof.fields, extractFields(proof.metadata.docType, text));
  return fields.every((row) => row.status === 'match')
    ? { available: true, fields, note: FIELD_DIFF_CONTENT_MATCH }
    : { available: true, fields };
}

// A text-v1 file is its own text; anything else needs the caller's extracted text
function textFileOf(fileBytes, proof) {
  if (proof.scheme.fileNormalization !== FILE_NORMALIZATION.TEXT_V1) return null;
  try {
    return new TextDecoder().decode(normalizeTextFile(fileBytes));
  } catch {
    return null;
  }
}

function unavailable(reason) {
  return { available: false, reason, fields: [] };
}

// null unless the chain returned a well-formed, non-zero root (fail closed)
function readChainBatch(chainBatch) {
  const root = typeof chainBatch?.root === 'string' ? chainBatch.root.toLowerCase() : null;
  if (root === null || !HEX32.test(root) || root === ZERO_ROOT) return null;
  const { leafCount } = chainBatch;
  return { root, leafCount: typeof leafCount === 'bigint' ? Number(leafCount) : leafCount };
}

function readPinned(pinned) {
  const ok =
    pinned !== null &&
    typeof pinned === 'object' &&
    Number.isSafeInteger(pinned.chainId) &&
    pinned.chainId > 0 &&
    typeof pinned.contract === 'string' &&
    ADDRESS.test(pinned.contract);
  if (!ok) {
    throw new TypeError(
      'verify: pinned must be { chainId: positive integer, contract: 0x + 40 hex } from the verifier config',
    );
  }
  return pinned;
}

function skip(reason) {
  return { pass: null, computed: null, expected: null, detail: `Skipped: ${reason}.` };
}

// CAIP-10 account id, e.g. eip155:31337:0x5fbd...; lowercased so equal values look equal
function caip10(chainId, contract) {
  return `eip155:${chainId}:${contract.toLowerCase()}`;
}
