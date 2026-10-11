// Owner: Archit | Test fixtures: the fixed v1 batch from vectors.json and a v2 batch with fields
import { readFileSync } from 'node:fs';
import {
  buildFieldTree,
  buildProof,
  buildTree,
  fileHash,
  getProof,
  leafHash,
  normalizeFields,
} from '../src/index.js';

export const VECTORS = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

const { anchor, issuedAt } = VECTORS.proof;
export const ANCHOR = anchor;
export const ISSUED_AT = issuedAt;
export const PINNED = Object.freeze({ chainId: anchor.chainId, contract: anchor.contract });

export const utf8 = (text) => new TextEncoder().encode(text);
export const toText = (bytes) => new TextDecoder().decode(bytes);

/** Only the five fields that go into a leaf. */
export const recordOf = ({ recordId, fileHash, docType, issuer, date }) => ({
  recordId,
  fileHash,
  docType,
  issuer,
  date,
});

/**
 * Fresh copy of the batch on every call, so tests can tamper with it freely.
 * Index 2 is the salary slip (Rs 50,000); index 4 is a .txt registered under text-v1.
 */
export function makeBatch() {
  const records = VECTORS.records.map(recordOf);
  const files = VECTORS.records.map((entry) => utf8(entry.file));
  const { root, levels } = buildTree(records.map(leafHash));
  const proofs = records.map((record, leafIndex) =>
    buildProof({
      record,
      batchId: VECTORS.batchId,
      leafIndex,
      leafCount: records.length,
      siblings: getProof(levels, leafIndex),
      root,
      anchor: ANCHOR,
      fileNormalization: VECTORS.records[leafIndex].fileNormalization,
      issuedAt: ISSUED_AT,
    }),
  );
  return { records, files, root, levels, proofs, chainBatch: { root, leafCount: records.length } };
}

// ---- v2: records that commit to their fields --------------------------------------------------

/** A salary slip as a PDF text layer would read; the tampered copy changes only the net pay. */
export const SLIP_TEXT = [
  'Sahyadri Analytics Pvt Ltd',
  'PAYSLIP FOR THE MONTH OF JULY 2026',
  'Employee name Meera Joshi Designation Data Analyst',
  'Employee ID SA-2031 Pay date 31/07/2026',
  'Total earnings 34,500 Total deductions 4,500',
  'Net Pay ₹ 30,000',
  'Fictional sample document for demonstration only.',
].join('\n');
export const TAMPERED_SLIP_TEXT = SLIP_TEXT.replace('₹ 30,000', '₹ 40,000');

/** Deterministic salt for fixtures: one byte repeated 16 times. */
export const saltOf = (n) => n.toString(16).padStart(2, '0').repeat(16);

const V2_DOCUMENTS = [
  {
    docType: 'DEGREE_CERTIFICATE',
    issuer: 'Pimpri Institute of Technology',
    date: '2026-06-14',
    text: 'DEGREE CERTIFICATE\nPimpri Institute of Technology\nCertificate No.: PIT/DEG/2026/0042\n',
    input: { certificateNo: 'PIT/DEG/2026/0042' },
  },
  {
    docType: 'MARKSHEET',
    issuer: 'Pimpri Institute of Technology',
    date: '2026-05-30',
    text: 'STATEMENT OF MARKS\nStudent name Rohan Deshpande\nSeat number PIT-CE-23-0118\n',
    input: { studentName: 'Rohan  Deshpande', seatNumber: 'pit-ce-23-0118' },
  },
  {
    docType: 'SALARY_SLIP',
    issuer: 'Sahyadri Analytics Pvt Ltd',
    date: '2026-07-31',
    text: SLIP_TEXT,
    input: {
      employeeName: 'Meera Joshi',
      employeeId: 'SA-2031',
      payPeriod: 'July 2026',
      grossPay: '34,500',
      netPay: 'Rs 30,000/-',
    },
  },
  {
    docType: 'OFFER_LETTER',
    issuer: 'Sahyadri Analytics Pvt Ltd',
    date: '2026-08-15',
    text: 'OFFER LETTER\nSahyadri Analytics Pvt Ltd\nWe are pleased to offer you the role of Analyst.\n',
    input: {},
  },
  {
    docType: 'SALARY_SLIP',
    issuer: 'Deccan Softworks Limited',
    date: '2026-08-31',
    fileNormalization: 'text-v1',
    text:
      'SALARY SLIP\r\nDeccan Softworks Limited\r\nEmployee name: Arjun Rao  \r\nEmployee ID: DS-0077\r\n' +
      'Pay period: August 2026\r\nGross pay: Rs 61,000\r\nNet pay: Rs 52,500/-\r\n',
    input: {
      employeeName: 'Arjun Rao',
      employeeId: 'DS-0077',
      payPeriod: '08/2026',
      grossPay: '61000',
      netPay: '52,500.00',
    },
  },
];

/** Index of the PDF-style salary slip (net pay ₹30,000) and the .txt slip in makeBatchV2(). */
export const V2_SLIP = 2;
export const V2_TXT_SLIP = 4;
export const V2_BATCH_ID = 'BATCH-0002';

/**
 * Build a batch the way the server does: normalise each document's field input, salt it, put
 * fieldsRoot in the record, tree over the v2 leaves, one proof per record.
 * @param {Array<{ docType, issuer, date, text, input?, fields?, fileNormalization? }>} documents
 *   `fields` (already normalised and salted) overrides `input`
 */
export function makeV2Batch(documents, batchId = V2_BATCH_ID) {
  const files = documents.map((doc) => utf8(doc.text));
  const fields = documents.map((doc, i) => doc.fields ?? saltedFields(doc, i));
  const records = documents.map((doc, i) => ({
    recordId: `REC-${String(101 + i).padStart(6, '0')}`,
    fileHash: fileHash(files[i], { normalization: doc.fileNormalization ?? 'none' }),
    fieldsRoot: buildFieldTree(fields[i]).root,
    docType: doc.docType,
    issuer: doc.issuer,
    date: doc.date,
  }));
  const { root, levels } = buildTree(records.map(leafHash));
  const proofs = records.map((record, leafIndex) =>
    buildProof({
      record,
      fields: fields[leafIndex],
      batchId,
      leafIndex,
      leafCount: records.length,
      siblings: getProof(levels, leafIndex),
      root,
      anchor: ANCHOR,
      fileNormalization: documents[leafIndex].fileNormalization ?? 'none',
      issuedAt: ISSUED_AT,
    }),
  );
  return {
    records,
    fields,
    files,
    root,
    levels,
    proofs,
    chainBatch: { root, leafCount: records.length },
  };
}

/** Fresh v2 batch of the five documents above (safe to mutate). */
export function makeBatchV2() {
  return makeV2Batch(V2_DOCUMENTS);
}

function saltedFields(doc, docIndex) {
  const { fields, errors } = normalizeFields(doc.docType, doc.input);
  if (Object.keys(errors).length > 0) throw new Error(`fixture fields: ${JSON.stringify(errors)}`);
  return fields.map((entry, i) => ({ ...entry, salt: saltOf(16 * docIndex + i + 1) }));
}
