// Owner: Archit (frozen; ask before changing) | Locked scheme constants, enums and result codes (CLAUDE.md "Locked formats")

/**
 * Hashing scheme shared by records and proof.json. `v` here is the base version (1); every
 * version uses these rules, and v2 adds the field tree below (see FIELD_SCHEME).
 */
export const SCHEME = Object.freeze({
  v: 1,
  hash: 'sha256',
  leafPrefix: '0x00',
  nodePrefix: '0x01',
  canonicalization: 'json-sorted-v1',
  oddNode: 'promote',
});

/**
 * v2 adds a salted Merkle tree over each document's fields; its root (fieldsRoot) goes into the
 * record. The prefixes differ from the batch tree's 0x00 / 0x01, so no hash can pass as another kind.
 */
export const FIELD_SCHEME = Object.freeze({
  v: 2,
  fieldLeafPrefix: '0x02',
  fieldNodePrefix: '0x03',
  emptyFieldsPrefix: '0x04',
});

/** Record and proof.json versions this code reads. New records are always the latest. */
export const PROOF_VERSIONS = Object.freeze([SCHEME.v, FIELD_SCHEME.v]);

/** How file bytes are prepared before hashing; recorded as proof.scheme.fileNormalization. */
export const FILE_NORMALIZATION = Object.freeze({
  NONE: 'none',
  TEXT_V1: 'text-v1',
});

export const DOC_TYPES = Object.freeze([
  'DEGREE_CERTIFICATE',
  'MARKSHEET',
  'SALARY_SLIP',
  'OFFER_LETTER',
  'EXPERIENCE_LETTER',
  'OTHER',
]);

/** Verification verdicts, in check order (see CLAUDE.md "Verification checks and result codes"). */
export const RESULT = Object.freeze({
  VALID: 'VALID',
  FORMAT_INVALID: 'FORMAT_INVALID',
  REGISTRY_MISMATCH: 'REGISTRY_MISMATCH',
  DOCUMENT_MODIFIED: 'DOCUMENT_MODIFIED',
  METADATA_MODIFIED: 'METADATA_MODIFIED',
  PROOF_INVALID: 'PROOF_INVALID',
  BATCH_NOT_PUBLISHED: 'BATCH_NOT_PUBLISHED',
  ROOT_MISMATCH: 'ROOT_MISMATCH',
});

/**
 * Result code for each check id when that check fails. Lookup only: integer-like keys
 * ('0', '1', ...) enumerate first in JS, so take check order from verify().checks.
 */
export const CHECK_RESULT = Object.freeze({
  0: RESULT.FORMAT_INVALID,
  '0b': RESULT.REGISTRY_MISMATCH,
  1: RESULT.DOCUMENT_MODIFIED,
  2: RESULT.METADATA_MODIFIED,
  '2b': RESULT.PROOF_INVALID,
  3: RESULT.PROOF_INVALID,
  '4a': RESULT.BATCH_NOT_PUBLISHED,
  '4b': RESULT.ROOT_MISMATCH,
});

/** Longest issuer allowed after normText, in Unicode code points. */
export const ISSUER_MAX_LENGTH = 120;

/** A 32-byte hash as stored and shown everywhere: "0x" + 64 lowercase hex chars. */
export const HEX32 = /^0x[0-9a-f]{64}$/;

/** REC-000002: "REC-" + 6-digit zero-padded counter. */
export const RECORD_ID = /^REC-\d{6}$/;

/** BATCH-0007: "BATCH-" + 4-digit zero-padded counter. */
export const BATCH_ID = /^BATCH-\d{4}$/;
