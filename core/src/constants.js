// Owner: Archit (frozen; ask before changing) | Locked scheme constants, enums and result codes (CLAUDE.md "Locked formats")

/** Hashing scheme shared by records and proof.json. `v` is the scheme version used in both. */
export const SCHEME = Object.freeze({
  v: 1,
  hash: 'sha256',
  leafPrefix: '0x00',
  nodePrefix: '0x01',
  canonicalization: 'json-sorted-v1',
  oddNode: 'promote',
});

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

/** A 32-byte hash as stored and shown everywhere: "0x" + 64 lowercase hex chars. */
export const HEX32 = /^0x[0-9a-f]{64}$/;

/** REC-000002: "REC-" + 6-digit zero-padded counter. */
export const RECORD_ID = /^REC-\d{6}$/;

/** BATCH-0007: "BATCH-" + 4-digit zero-padded counter. */
export const BATCH_ID = /^BATCH-\d{4}$/;
