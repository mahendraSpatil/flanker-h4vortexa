// Owner: Archit | Document fields: schemas, normalisers, salted field tree, single-field proofs, text extraction, diff
//
// v2 records commit to a document's fields (e.g. net pay) through fieldsRoot, the root of a salted
// Merkle tree with one leaf per field. Extraction and diff only EXPLAIN a failed file hash; they
// never decide a verification result.
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { normText, sortedJSON } from './canonical.js';
import { FIELD_SCHEME } from './constants.js';
import { hexToBytes, sha256Hex } from './hash.js';
import { expectedPositions, getProof } from './merkle.js';
import { buildLevels, foldPath } from './tree.js';

// ---- schemas --------------------------------------------------------------------------------------

/** How a field's value is normalised, checked and shown. */
export const FIELD_KINDS = Object.freeze(['name', 'id', 'month', 'date', 'amount']);

const field = (name, label, kind, required) => Object.freeze({ name, label, kind, required });

/**
 * Fields per docType, in schema order (the order of leaves in the field tree). Only fields the
 * sample documents really carry; a docType without an entry has no fields (fieldsRoot is then
 * EMPTY_FIELDS_ROOT). A field name means the same thing (label, kind) in every docType.
 */
export const FIELD_SCHEMAS = Object.freeze({
  SALARY_SLIP: Object.freeze([
    field('employeeName', 'Employee name', 'name', true),
    field('employeeId', 'Employee ID', 'id', false),
    field('payPeriod', 'Pay period', 'month', true),
    field('grossPay', 'Gross pay', 'amount', false),
    field('netPay', 'Net pay', 'amount', true),
  ]),
  MARKSHEET: Object.freeze([
    field('studentName', 'Student name', 'name', true),
    field('seatNumber', 'Seat number', 'id', false),
  ]),
  DEGREE_CERTIFICATE: Object.freeze([field('certificateNo', 'Certificate no.', 'id', false)]),
});

const NO_FIELDS = Object.freeze([]);
const DEFINITIONS = new Map(
  Object.values(FIELD_SCHEMAS)
    .flat()
    .map((def) => [def.name, def]),
);

/**
 * @param {string} docType
 * @returns {ReadonlyArray<{ name: string, label: string, kind: string, required: boolean }>}
 *   the docType's fields in schema order; empty for a docType without fields (or an unknown one)
 */
export function fieldSchema(docType) {
  return Object.hasOwn(FIELD_SCHEMAS, docType) ? FIELD_SCHEMAS[docType] : NO_FIELDS;
}

/**
 * @param {string} name e.g. "netPay"
 * @returns {{ name: string, label: string, kind: string, required: boolean } | null}
 */
export function fieldDefinition(name) {
  return DEFINITIONS.get(name) ?? null;
}

// ---- normalisation --------------------------------------------------------------------------------

/** Input that cannot be read as a value of its kind. Never guessed around: always thrown. */
export class FieldValueError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'FieldValueError';
    this.code = 'INVALID_FIELD_VALUE';
    this.kind = kind;
  }
}

const NAME_MAX_CHARS = 120;
const ID_MAX_CHARS = 64;
const AMOUNT_TEXT = /^(\d{1,15})(?:\.(\d{1,2}))?$/; // rupees once symbols and commas are gone
const CANONICAL_AMOUNT = /^(0|[1-9]\d{0,16})$/; // paise, no leading zeros
const MIN_YEAR = 1900;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_BY_NAME = new Map(
  MONTH_NAMES.flatMap((month, i) => [
    [month.toLowerCase(), i + 1],
    [month.slice(0, 3).toLowerCase(), i + 1],
  ]).concat([['sept', 9]]),
);

const NORMALIZERS = {
  name: normalizeName,
  id: normalizeId,
  month: normalizeMonth,
  date: normalizeDate,
  amount: normalizeAmount,
};

/**
 * Normalise a value as a person or a document writes it into the one form that is hashed.
 *   amount: rupees -> integer paise as a decimal string ("Rs 30,000/-" -> "3000000")
 *   name:   NFC, trimmed, single spaces, uppercase
 *   id:     uppercase, no whitespace
 *   month:  YYYY-MM ("March 2026", "03/2026", "2026-03")
 *   date:   YYYY-MM-DD ("2026-03-31", "31/03/2026" day first, "31 March 2026")
 * Not idempotent for amounts (input is rupees, output is paise); check stored values with
 * isCanonicalFieldValue instead.
 * @param {string} kind one of FIELD_KINDS
 * @param {string} raw
 * @returns {string}
 * @throws {FieldValueError} code 'INVALID_FIELD_VALUE' when raw cannot be read
 * @throws {TypeError} on an unknown kind (a programming error)
 */
export function normalizeFieldValue(kind, raw) {
  const normalize = Object.hasOwn(NORMALIZERS, kind) ? NORMALIZERS[kind] : null;
  if (!normalize) throw new TypeError(`Unknown field kind: ${String(kind)}`);
  if (typeof raw !== 'string') throw new FieldValueError(kind, 'must be text');
  return normalize(raw);
}

/**
 * True when value is already in normalised form for its kind (what a leaf may contain).
 * @param {string} kind
 * @param {unknown} value
 * @returns {boolean} never throws
 */
export function isCanonicalFieldValue(kind, value) {
  if (typeof value !== 'string' || !Object.hasOwn(NORMALIZERS, kind)) return false;
  if (kind === 'amount') return CANONICAL_AMOUNT.test(value);
  try {
    return NORMALIZERS[kind](value) === value;
  } catch {
    return false;
  }
}

/**
 * Human-readable form of a normalised value: "3000000" -> "₹30,000", "2026-03" -> "March 2026".
 * @param {string} kind
 * @param {string} value normalised value
 * @returns {string}
 */
export function displayFieldValue(kind, value) {
  if (!isCanonicalFieldValue(kind, value)) return String(value);
  if (kind === 'amount') return `₹${rupeesText(value)}`;
  if (kind === 'month') {
    const [year, month] = value.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }
  if (kind === 'date') {
    const [year, month, day] = value.split('-').map(Number);
    return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
  }
  return value;
}

/**
 * A normalised value as a person would type it back in, so normalizeFieldValue returns the same
 * value: amounts in rupees ("3000000" -> "30,000"), everything else unchanged.
 * @param {string} kind
 * @param {string} value normalised value
 * @returns {string}
 */
export function fieldInputValue(kind, value) {
  return kind === 'amount' && CANONICAL_AMOUNT.test(value) ? rupeesText(value) : value;
}

function normalizeName(raw) {
  const value = normText(raw).toUpperCase().normalize('NFC');
  if (value === '') throw new FieldValueError('name', 'is empty');
  if (/\p{Cc}/u.test(value)) throw new FieldValueError('name', 'contains control characters');
  if (!/\p{L}/u.test(value)) throw new FieldValueError('name', 'must contain a letter');
  if ([...value].length > NAME_MAX_CHARS) {
    throw new FieldValueError('name', `must be at most ${NAME_MAX_CHARS} characters`);
  }
  return value;
}

function normalizeId(raw) {
  const value = raw.normalize('NFC').replace(/\s+/g, '').toUpperCase().normalize('NFC');
  if (value === '') throw new FieldValueError('id', 'is empty');
  if (/\p{Cc}/u.test(value)) throw new FieldValueError('id', 'contains control characters');
  if ([...value].length > ID_MAX_CHARS) {
    throw new FieldValueError('id', `must be at most ${ID_MAX_CHARS} characters`);
  }
  return value;
}

function normalizeAmount(raw) {
  const text = raw
    .normalize('NFC')
    .trim()
    .replace(/\s*\/-$/, '') // "30,000/-"
    .replace(/^(?:₹|rs\.?|inr)\s*/i, '')
    .replace(/\s*(?:₹|rs\.?|inr)$/i, '')
    .replace(/[,\s]/g, '');
  const parts = AMOUNT_TEXT.exec(text);
  if (!parts) {
    throw new FieldValueError('amount', 'must be an amount in rupees such as 30,000 or 30000.50');
  }
  const paise = BigInt(parts[1]) * 100n + BigInt((parts[2] ?? '').padEnd(2, '0'));
  return paise.toString();
}

function normalizeMonth(raw) {
  const text = normText(raw).toLowerCase();
  let year;
  let month;
  let parts;
  if ((parts = /^(\d{4})-(\d{2})$/.exec(text))) [year, month] = [+parts[1], +parts[2]];
  else if ((parts = /^(\d{1,2})[/.-](\d{4})$/.exec(text))) [month, year] = [+parts[1], +parts[2]];
  else if ((parts = /^([a-z]+)\.?[\s,-]*(\d{4})$/.exec(text))) {
    [month, year] = [MONTH_BY_NAME.get(parts[1]), +parts[2]];
  }
  if (!month || month < 1 || month > 12 || !(year >= MIN_YEAR)) {
    throw new FieldValueError('month', 'must be a month such as March 2026 or 2026-03');
  }
  return `${year}-${pad2(month)}`;
}

function normalizeDate(raw) {
  const text = normText(raw).toLowerCase();
  let year;
  let month;
  let day;
  let parts;
  if ((parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) {
    [year, month, day] = [+parts[1], +parts[2], +parts[3]];
  } else if ((parts = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) {
    [day, month, year] = [+parts[1], +parts[2], +parts[3]]; // day first, as on Indian documents
  } else if ((parts = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{4})$/.exec(text))) {
    [day, month, year] = [+parts[1], MONTH_BY_NAME.get(parts[2]), +parts[3]];
  }
  if (!isCalendarDate(year, month, day) || year < MIN_YEAR) {
    throw new FieldValueError('date', 'must be a date such as 2026-03-31 or 31/03/2026');
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isCalendarDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger) || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// "7200000" paise -> "72,000"; Indian digit grouping (7,20,000), paise only when not zero
function rupeesText(paise) {
  const amount = BigInt(paise);
  const rupees = groupIndian((amount / 100n).toString());
  const cents = amount % 100n;
  return cents === 0n ? rupees : `${rupees}.${pad2(cents)}`;
}

function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const groups = [digits.slice(-3)];
  let rest = digits.slice(0, -3);
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return groups.join(',');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ---- a person's input -> fields in schema order --------------------------------------------------

/**
 * Normalise confirmed field values for a docType, in schema order (never input order). Blank
 * values count as not given; a required field that is not given is an error.
 * @param {string} docType
 * @param {unknown} input { [fieldName]: value as typed } (amounts in rupees)
 * @returns {{ fields: Array<{ name: string, value: string }>, errors: Object<string, string> }}
 *   errors maps a field name to a message fragment ("is required", "must be ...")
 */
export function normalizeFields(docType, input) {
  const values = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const schema = fieldSchema(docType);
  const errors = new Map(); // a plain object would drop an error keyed "__proto__"
  for (const name of Object.keys(values)) {
    if (!schema.some((def) => def.name === name)) errors.set(name, `is not a field of ${docType}`);
  }
  const fields = [];
  for (const { name, kind, required } of schema) {
    const raw = Object.hasOwn(values, name) ? values[name] : undefined;
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      if (required) errors.set(name, 'is required');
      continue;
    }
    try {
      fields.push({ name, value: normalizeFieldValue(kind, raw) });
    } catch (err) {
      if (!(err instanceof FieldValueError)) throw err;
      errors.set(name, err.message);
    }
  }
  return { fields, errors: Object.fromEntries(errors) };
}

// ---- structural check of a field list (check 0) ---------------------------------------------------

/** 16 random bytes as 32 lowercase hex characters (no 0x prefix). */
export const FIELD_SALT = /^[0-9a-f]{32}$/;
const FIELD_KEYS = ['name', 'value', 'salt'];

/**
 * Check a field list against a docType's schema: exact keys { name, value, salt } on each entry,
 * known names in strict schema order (so no duplicates), every required field present, values in
 * normalised form, salts of 32 lowercase hex characters. Never throws.
 * @param {string} docType
 * @param {unknown} fields
 * @returns {{ ok: boolean, errors: Object<string, string> }} errors maps "fields[2].value" (or
 *   "fields") to a message
 */
export function validateFields(docType, fields) {
  if (!Array.isArray(fields)) return { ok: false, errors: { fields: 'must be an array' } };
  const schema = fieldSchema(docType);
  if (fields.length > schema.length) {
    return { ok: false, errors: { fields: `must have at most ${schema.length} entries` } };
  }
  const errors = new Map();
  const fail = (path, message) => errors.has(path) || errors.set(path, message);
  let lastIndex = -1;
  // An index loop, not forEach: forEach skips the holes of a sparse array
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    const path = `fields[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(path, 'must be an object with name, value and salt');
      continue;
    }
    for (const key of FIELD_KEYS)
      if (!Object.hasOwn(entry, key)) fail(`${path}.${key}`, 'is required');
    for (const key of Object.keys(entry)) {
      if (!FIELD_KEYS.includes(key)) fail(`${path}.${key}`, 'is not allowed');
    }
    const index = schema.findIndex((def) => def.name === entry.name);
    if (index === -1) fail(`${path}.name`, `must be a field of ${docType}`);
    else if (index <= lastIndex) fail(`${path}.name`, 'is out of schema order or repeated');
    else {
      lastIndex = index;
      if (!isCanonicalFieldValue(schema[index].kind, entry.value)) {
        fail(`${path}.value`, `must be a normalised ${schema[index].kind}`);
      }
    }
    if (typeof entry.salt !== 'string' || !FIELD_SALT.test(entry.salt)) {
      fail(`${path}.salt`, 'must be 32 lowercase hex characters');
    }
  }
  for (const { name, required } of schema) {
    if (required && !fields.some((entry) => entry?.name === name)) {
      fail('fields', `must include ${name}`);
    }
  }
  return { ok: errors.size === 0, errors: Object.fromEntries(errors) };
}

// ---- the salted field tree ------------------------------------------------------------------------

const FIELD_LEAF_PREFIX = hexToBytes(FIELD_SCHEME.fieldLeafPrefix);
const FIELD_NODE_PREFIX = hexToBytes(FIELD_SCHEME.fieldNodePrefix);
const HASH_HEX_ANY_CASE = /^0x[0-9a-fA-F]{64}$/;

/** fieldsRoot of a record with no fields: SHA-256(0x04). */
export const EMPTY_FIELDS_ROOT = sha256Hex(hexToBytes(FIELD_SCHEME.emptyFieldsPrefix));

/**
 * fieldLeaf = SHA-256(0x02 ‖ utf8(json-sorted-v1 { name, salt, value })). The salt keeps a field's
 * value from being guessed out of its leaf when other fields are disclosed.
 * @param {{ name: string, value: string, salt: string }} entry
 * @returns {string} "0x" + 64 lowercase hex
 * @throws {TypeError} when name/value are not strings or salt is not 32 lowercase hex
 */
export function fieldLeafHash(entry) {
  const { name, value, salt } = entry ?? {};
  if (typeof name !== 'string' || name === '' || typeof value !== 'string') {
    throw new TypeError('fieldLeafHash: name and value must be strings');
  }
  if (typeof salt !== 'string' || !FIELD_SALT.test(salt)) {
    throw new TypeError('fieldLeafHash: salt must be 32 lowercase hex characters');
  }
  return sha256Hex(concatBytes(FIELD_LEAF_PREFIX, utf8ToBytes(sortedJSON({ name, salt, value }))));
}

/**
 * fieldNode = SHA-256(0x03 ‖ leftBytes ‖ rightBytes), over the raw 32 bytes of each child.
 * @param {string} leftHex
 * @param {string} rightHex
 * @returns {string}
 * @throws {TypeError} when a child is not a 32-byte hex hash
 */
export function fieldNodeHash(leftHex, rightHex) {
  return sha256Hex(concatBytes(FIELD_NODE_PREFIX, childBytes(leftHex), childBytes(rightHex)));
}

/**
 * Field tree over fields in the order given (schema order: see normalizeFields / validateFields).
 * Odd node promoted, as in the batch tree. Zero fields -> EMPTY_FIELDS_ROOT.
 * @param {Array<{ name: string, value: string, salt: string }>} fields
 * @returns {{ root: string, leaves: string[] }}
 * @throws {TypeError} on a malformed entry or a repeated name
 */
export function buildFieldTree(fields) {
  const leaves = fieldLeaves(fields, 'buildFieldTree');
  if (leaves.length === 0) return { root: EMPTY_FIELDS_ROOT, leaves };
  const levels = buildLevels(leaves, fieldNodeHash);
  return { root: levels[levels.length - 1][0], leaves };
}

/**
 * Single-field disclosure: one field plus the sibling path that ties it to fieldsRoot, so that
 * field can be shown without revealing the others.
 * @param {Array<{ name: string, value: string, salt: string }>} fields as passed to buildFieldTree
 * @param {number} index position of the disclosed field
 * @returns {{ field: { name: string, value: string, salt: string }, index: number, count: number,
 *   siblings: Array<{ hash: string, pos: 'left' | 'right' }> }}
 * @throws {TypeError} on malformed fields; {RangeError} when index is out of range
 */
export function fieldProof(fields, index) {
  const leaves = fieldLeaves(fields, 'fieldProof');
  if (!Number.isSafeInteger(index) || index < 0 || index >= leaves.length) {
    throw new RangeError(`fieldProof: index must be an integer from 0 to ${leaves.length - 1}`);
  }
  const { name, value, salt } = fields[index];
  return {
    field: { name, value, salt },
    index,
    count: leaves.length,
    siblings: getProof(buildLevels(leaves, fieldNodeHash), index),
  };
}

/**
 * Check a single-field disclosure against a fieldsRoot (e.g. from a verified proof.json).
 * Sibling sides must fit index/count, as in verification check 3. Never throws.
 * @param {unknown} disclosure as returned by fieldProof
 * @param {string} fieldsRoot
 * @returns {boolean}
 */
export function verifyFieldProof(disclosure, fieldsRoot) {
  try {
    const { field: entry, index, count, siblings } = disclosure;
    if (!Array.isArray(siblings) || typeof fieldsRoot !== 'string') return false;
    const sides = siblings.map((sibling) => sibling?.pos).join();
    if (sides !== expectedPositions(index, count).join()) return false;
    const root = foldPath(fieldLeafHash(entry), siblings, fieldNodeHash, 'verifyFieldProof');
    return root === fieldsRoot.toLowerCase();
  } catch {
    return false;
  }
}

function fieldLeaves(fields, caller) {
  if (!Array.isArray(fields)) throw new TypeError(`${caller}: fields must be an array`);
  const names = new Set();
  // Array.from, not map: a hole in a sparse array must fail like any other missing entry
  return Array.from(fields, (entry, i) => {
    if (names.has(entry?.name)) throw new TypeError(`${caller}: fields[${i}] repeats a name`);
    names.add(entry?.name);
    return fieldLeafHash(entry);
  });
}

function childBytes(hex) {
  if (typeof hex !== 'string' || !HASH_HEX_ANY_CASE.test(hex)) {
    throw new TypeError('fieldNodeHash: children must be 0x + 64 hex characters');
  }
  return hexToBytes(hex);
}

/**
 * Registered fields for display, in the order given.
 * @param {Array<{ name: string, value: string }>} fields
 * @returns {Array<{ name: string, label: string, value: string, display: string }>}
 */
export function describeFields(fields) {
  return fields.map(({ name, value }) => {
    const def = fieldDefinition(name);
    return {
      name,
      label: def?.label ?? name,
      value,
      display: def ? displayFieldValue(def.kind, value) : value,
    };
  });
}

// ---- reading fields back out of document text (explanation only) ---------------------------------

const EVIDENCE_MAX_CHARS = 160;
// Separator between a label and its value: spaces or a line break, optionally ":" or a dash
const SEP = String.raw`\s*(?:[:–—-]\s*)?`;
// End of a label: not followed by a letter or digit (a \b would fail after "No.")
const END = String.raw`(?![\p{L}\p{N}])`;
const AMOUNT = String.raw`(?:\(\s*(?:₹|rs\.?|inr)\s*\)\s*)?((?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*\/-)?)`;
const MONTH = String.raw`([a-z]{3,9}\.?[\s,-]*\d{4}|\d{4}-\d{2}|\d{1,2}[/.-]\d{4})`;
const ID = String.raw`([\p{L}\p{N}][\p{L}\p{N}/._#-]*)`;
// Up to 7 words on one line (single spaces only); cut at the next label below
const NAME = String.raw`(\p{L}[\p{L}\p{M}.'’-]*(?: \p{L}[\p{L}\p{M}.'’-]*){0,6})`;
// Words that start the next label on a payslip or marksheet line, never part of a name
const NAME_STOP_WORDS = new Set(
  (
    'designation employee emp department dept pay date pan uan bank location grade month id code ' +
    'seat roll programme program semester course branch prn enrolment enrollment registration ' +
    'father mother gender dob'
  ).split(' '),
);

const rule = (label, value, pick = (raw) => raw) => ({
  pattern: new RegExp(label + END + SEP + value, 'giu'),
  pick,
});
const withDigit = (raw) => (/\d/.test(raw) ? raw : null);
const beforeNextLabel = (raw) => {
  const words = raw.split(' ');
  const stop = words.findIndex((word) =>
    NAME_STOP_WORDS.has(word.toLowerCase().replace(/[.:]+$/, '')),
  );
  return (stop === -1 ? words : words.slice(0, stop)).join(' ') || null;
};

/** Label-anchored rules per field name; each value is read right after its label. */
const EXTRACTION_RULES = {
  employeeName: rule(
    String.raw`\b(?:(?:employee|emp\.?)\s*name|name\s+of\s+(?:the\s+)?employee)`,
    NAME,
    beforeNextLabel,
  ),
  employeeId: rule(String.raw`\b(?:employee|emp\.?)\s*(?:id|code|no\.?|number)`, ID, withDigit),
  payPeriod: rule(
    String.raw`\b(?:pay\s*period|(?:for\s+)?the\s+month\s+of|salary\s+month|month)`,
    MONTH,
  ),
  grossPay: rule(
    String.raw`\b(?:gross\s*(?:pay|salary|earnings|total)|total\s+(?:earnings|gross))`,
    AMOUNT,
  ),
  netPay: rule(
    String.raw`\bnet\s*(?:pay(?:able)?|salary|amount(?:\s+payable)?|take[\s-]*home)`,
    AMOUNT,
  ),
  studentName: rule(
    String.raw`\b(?:(?:student|candidate)(?:'s|’s)?\s*name|name\s+of\s+(?:the\s+)?(?:student|candidate))`,
    NAME,
    beforeNextLabel,
  ),
  seatNumber: rule(
    String.raw`\b(?:exam(?:ination)?\s+)?(?:seat|roll)\s*(?:no\.?|number)`,
    ID,
    withDigit,
  ),
  certificateNo: rule(String.raw`\bcertificate\s*(?:no\.?|number|#)`, ID, withDigit),
};

/**
 * Read each schema field of docType out of a document's text, normalised; null when it is not
 * found or cannot be read. Deterministic and label based: lines are whitespace-collapsed and a
 * value may sit on its label's line or the next one, so it tolerates the different line layouts
 * of PDF text extractors. EXPLANATION ONLY: never used to decide a verification result.
 * @param {string} docType
 * @param {string} text
 * @returns {Object<string, string | null>} one key per schema field, in schema order
 */
export function extractFields(docType, text) {
  const found = extractFieldsWithEvidence(docType, text);
  return Object.fromEntries(Object.entries(found).map(([name, hit]) => [name, hit?.value ?? null]));
}

/**
 * extractFields plus the text each value was read from (whitespace-collapsed, as quoted on the
 * confirm screen).
 * @param {string} docType
 * @param {string} text
 * @returns {Object<string, { value: string, evidence: string } | null>}
 */
export function extractFieldsWithEvidence(docType, text) {
  const lines = String(text ?? '')
    .normalize('NFC')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const joined = lines.join('\n');
  return Object.fromEntries(
    fieldSchema(docType).map(({ name, kind }) => [
      name,
      findField(EXTRACTION_RULES[name], kind, joined),
    ]),
  );
}

function findField({ pattern, pick }, kind, joined) {
  for (const match of joined.matchAll(pattern)) {
    const raw = pick(match[1]);
    if (!raw) continue;
    try {
      return { value: normalizeFieldValue(kind, raw), evidence: evidenceOf(joined, match) };
    } catch (err) {
      if (!(err instanceof FieldValueError)) throw err;
    }
  }
  return null;
}

// The whole line(s) a match spans, joined by single spaces; just the label and value when those
// lines are long (text extracted as one run-on line)
function evidenceOf(joined, match) {
  const start = joined.lastIndexOf('\n', match.index) + 1;
  const endBreak = joined.indexOf('\n', match.index + match[0].trimEnd().length);
  const lines = joined.slice(start, endBreak === -1 ? undefined : endBreak).replace(/\n/g, ' ');
  return lines.length <= EVIDENCE_MAX_CHARS ? lines : match[0].replace(/\s+/g, ' ').trim();
}

/**
 * Compare registered values with values read from a document. EXPLANATION ONLY.
 * @param {Array<{ name: string, value: string }>} registered e.g. proof.fields, in schema order
 * @param {Object<string, string | null>} extracted from extractFields
 * @returns {Array<{ name: string, label: string, registered: string, found: string | null,
 *   status: 'match' | 'changed' | 'unreadable' }>} one row per registered field
 */
export function diffFields(registered, extracted) {
  return registered.map(({ name, value }) => {
    const found = extracted?.[name] ?? null;
    let status = 'changed';
    if (found === null) status = 'unreadable';
    else if (found === value) status = 'match';
    return { name, label: fieldDefinition(name)?.label ?? name, registered: value, found, status };
  });
}
