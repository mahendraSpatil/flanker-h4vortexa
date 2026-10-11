// Owner: Archit | Tests for fields.js: normalisers, schemas, the salted field tree, single-field proofs, extraction, diff
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPTY_FIELDS_ROOT,
  FIELD_SCHEMAS,
  FieldValueError,
  buildFieldTree,
  canonicalJSON,
  diffFields,
  displayFieldValue,
  extractFields,
  fieldDefinition,
  fieldInputValue,
  fieldLeafHash,
  fieldNodeHash,
  fieldProof,
  fieldSchema,
  isCanonicalFieldValue,
  leafHash,
  nodeHash,
  normalizeFieldValue,
  normalizeFields,
  sha256Hex,
  sortedJSON,
  validateFields,
  verifyFieldProof,
} from '../src/index.js';
import {
  REF_EMPTY_FIELDS_ROOT,
  refFieldLeaf,
  refFieldNode,
  refFieldsRoot,
  refLeafV2,
  sha256,
} from './reference.js';
import { utf8 } from './fixtures.js';

const VECTORS = JSON.parse(readFileSync(new URL('./field-vectors.json', import.meta.url), 'utf8'));
const SAMPLES = new URL('../../samples/', import.meta.url);
const MANIFEST = JSON.parse(readFileSync(new URL('manifest.json', SAMPLES), 'utf8'));
const SALT = 'deadbeefdeadbeefdeadbeefdeadbeef';

const normalized = (kind, raw) => normalizeFieldValue(kind, raw);
const rejects = (kind, raw) =>
  assert.throws(
    () => normalizeFieldValue(kind, raw),
    (err) =>
      err instanceof FieldValueError && err.code === 'INVALID_FIELD_VALUE' && err.kind === kind,
    `${kind} ${JSON.stringify(raw)}`,
  );
const salted = (values, start = 1) =>
  values.map(([name, value], i) => ({
    name,
    value,
    salt: (start + i).toString(16).padStart(32, '0'),
  }));

// ---- normalisers ---------------------------------------------------------------------------------

test('amount: rupees in any common format -> integer paise as a decimal string', () => {
  const cases = [
    ['30,000', '3000000'],
    ['30000', '3000000'],
    ['₹30000.00', '3000000'],
    ['₹ 30,000', '3000000'],
    ['Rs 30,000/-', '3000000'],
    ['Rs.30,000', '3000000'],
    ['rs 30,000 /-', '3000000'],
    ['INR 30,000', '3000000'],
    ['30,000 INR', '3000000'],
    ['  3 0,000  ', '3000000'],
    ['7,20,000', '72000000'],
    ['30,000.5', '3000050'],
    ['30,000.05', '3000005'],
    ['0', '0'],
    ['0.75', '75'],
    ['007', '700'],
    ['999999999999999.99', '99999999999999999'],
  ];
  for (const [raw, paise] of cases) assert.equal(normalized('amount', raw), paise, raw);
});

test('amount: anything that is not a plain rupee amount is rejected, never guessed', () => {
  for (const raw of [
    '',
    ' ',
    'Rs',
    '₹',
    'thirty thousand',
    '-500',
    '30,000.123',
    '.5',
    '30.000.00',
  ]) {
    rejects('amount', raw);
  }
  for (const raw of [
    '$30,000',
    '30k',
    '3e4',
    '1000000000000000',
    '30,000 USD',
    '₹ 30,000 ₹ 40,000',
  ]) {
    rejects('amount', raw);
  }
});

test('name: NFC, trimmed, single spaces, uppercase', () => {
  assert.equal(normalized('name', '  Meera   Joshi\t'), 'MEERA JOSHI');
  assert.equal(normalized('name', 'Zoë D’Souza'), 'ZOË D’SOUZA'); // decomposed -> NFC
  assert.equal(normalized('name', 'ananya r. iyer'), 'ANANYA R. IYER');
  for (const raw of ['', '   ', '12345', 'Meera\u0000Joshi', 'x'.repeat(121)]) rejects('name', raw);
});

test('id: uppercase with every space removed', () => {
  assert.equal(normalized('id', ' bw - 1042 '), 'BW-1042');
  assert.equal(normalized('id', 'kit/deg/2026/0412'), 'KIT/DEG/2026/0412');
  for (const raw of ['', ' \t ', 'A\u0007B', 'X'.repeat(65)]) rejects('id', raw);
});

test('month: YYYY-MM from names, abbreviations, MM/YYYY and ISO', () => {
  const cases = [
    ['March 2026', '2026-03'],
    ['MARCH 2026', '2026-03'],
    ['mar 2026', '2026-03'],
    ['Mar-2026', '2026-03'],
    ['Sept, 2026', '2026-09'],
    ['03/2026', '2026-03'],
    ['3-2026', '2026-03'],
    ['2026-03', '2026-03'],
  ];
  for (const [raw, month] of cases) assert.equal(normalized('month', raw), month, raw);
  for (const raw of [
    '',
    '2026',
    'Smarch 2026',
    '13/2026',
    '00/2026',
    '2026-3',
    '2026-13',
    'March 26',
    'March 1800',
  ]) {
    rejects('month', raw);
  }
});

test('date: YYYY-MM-DD from ISO, day-first numbers and day month year', () => {
  const cases = [
    ['2026-03-31', '2026-03-31'],
    ['31/03/2026', '2026-03-31'],
    ['31-03-2026', '2026-03-31'],
    ['31.03.2026', '2026-03-31'],
    ['1/4/2026', '2026-04-01'],
    ['31 March 2026', '2026-03-31'],
    ['31st Mar 2026', '2026-03-31'],
    ['29 Feb 2024', '2024-02-29'],
  ];
  for (const [raw, date] of cases) assert.equal(normalized('date', raw), date, raw);
  for (const raw of [
    '',
    '2026-02-30',
    '29/02/2025',
    '31/04/2026',
    '2026/03/31',
    'March 31 2026',
    '00/01/2026',
  ]) {
    rejects('date', raw);
  }
});

test('normalizeFieldValue: non-text input is a FieldValueError, an unknown kind a TypeError', () => {
  for (const raw of [30000, null, undefined, ['30,000']]) rejects('amount', raw);
  assert.throws(() => normalizeFieldValue('salary', '30,000'), TypeError);
});

test('isCanonicalFieldValue accepts exactly the normalised forms', () => {
  assert.equal(isCanonicalFieldValue('amount', '3000000'), true);
  assert.equal(isCanonicalFieldValue('amount', '0'), true);
  for (const value of ['03000000', '30,000', '₹30000', '3000000.0', '', 3000000]) {
    assert.equal(isCanonicalFieldValue('amount', value), false, String(value));
  }
  assert.equal(isCanonicalFieldValue('name', 'MEERA JOSHI'), true);
  assert.equal(isCanonicalFieldValue('name', 'Meera Joshi'), false);
  assert.equal(isCanonicalFieldValue('name', 'MEERA  JOSHI'), false);
  assert.equal(isCanonicalFieldValue('id', 'BW-1042'), true);
  assert.equal(isCanonicalFieldValue('id', 'BW 1042'), false);
  assert.equal(isCanonicalFieldValue('month', '2026-03'), true);
  assert.equal(isCanonicalFieldValue('month', 'March 2026'), false);
  assert.equal(isCanonicalFieldValue('date', '2026-03-31'), true);
  assert.equal(isCanonicalFieldValue('date', '2026-02-30'), false);
  assert.equal(isCanonicalFieldValue('colour', 'RED'), false);
});

test('displayFieldValue and fieldInputValue: readable forms that normalise back to the value', () => {
  const cases = [
    ['amount', '3000000', '₹30,000', '30,000'],
    ['amount', '72000000', '₹7,20,000', '7,20,000'],
    ['amount', '3000050', '₹30,000.50', '30,000.50'],
    ['amount', '75', '₹0.75', '0.75'],
    ['month', '2026-03', 'March 2026', '2026-03'],
    ['date', '2026-03-01', '1 March 2026', '2026-03-01'],
    ['name', 'MEERA JOSHI', 'MEERA JOSHI', 'MEERA JOSHI'],
    ['id', 'BW-1042', 'BW-1042', 'BW-1042'],
  ];
  for (const [kind, value, display, input] of cases) {
    assert.equal(displayFieldValue(kind, value), display, `${kind} ${value}`);
    assert.equal(fieldInputValue(kind, value), input, `${kind} ${value}`);
    assert.equal(normalizeFieldValue(kind, input), value, `${kind} ${value} round trip`);
  }
});

// ---- schemas and a person's input ----------------------------------------------------------------

test('schemas: salary slip fields as in samples/, one meaning per field name', () => {
  assert.deepEqual(
    fieldSchema('SALARY_SLIP').map(({ name, kind, required }) => [name, kind, required]),
    [
      ['employeeName', 'name', true],
      ['employeeId', 'id', false],
      ['payPeriod', 'month', true],
      ['grossPay', 'amount', false],
      ['netPay', 'amount', true],
    ],
  );
  assert.deepEqual(fieldSchema('OFFER_LETTER'), []);
  assert.deepEqual(fieldSchema('EXPERIENCE_LETTER'), []);
  assert.deepEqual(fieldSchema('OTHER'), []);
  assert.deepEqual(fieldSchema('__proto__'), []);
  assert.equal(fieldDefinition('netPay').label, 'Net pay');
  assert.equal(fieldDefinition('nope'), null);
  assert.ok(Object.isFrozen(FIELD_SCHEMAS.SALARY_SLIP[0]));
});

test('normalizeFields returns schema order whatever the input order', () => {
  const input = { netPay: '30,000', payPeriod: 'July 2026', employeeName: ' meera joshi ' };
  const { fields, errors } = normalizeFields('SALARY_SLIP', input);
  assert.deepEqual(errors, {});
  assert.deepEqual(fields, [
    { name: 'employeeName', value: 'MEERA JOSHI' },
    { name: 'payPeriod', value: '2026-07' },
    { name: 'netPay', value: '3000000' },
  ]);
  const reversed = Object.fromEntries(Object.entries(input).reverse());
  assert.deepEqual(normalizeFields('SALARY_SLIP', reversed).fields, fields);
});

test('normalizeFields: required, unknown, blank and unreadable values', () => {
  const { fields, errors } = normalizeFields('SALARY_SLIP', {
    employeeName: '',
    employeeId: '   ',
    payPeriod: 'Smarch',
    netPay: '30,000',
    salary: '1',
  });
  assert.deepEqual(fields, [{ name: 'netPay', value: '3000000' }]);
  assert.deepEqual(Object.keys(errors).sort(), ['employeeName', 'payPeriod', 'salary']);
  assert.equal(errors.employeeName, 'is required');
  assert.match(errors.salary, /is not a field of SALARY_SLIP/);
  assert.deepEqual(normalizeFields('OFFER_LETTER', {}), { fields: [], errors: {} });
  assert.deepEqual(normalizeFields('OFFER_LETTER', null), { fields: [], errors: {} });
  const proto = normalizeFields('OFFER_LETTER', JSON.parse('{"__proto__":"x"}'));
  assert.ok(Object.hasOwn(proto.errors, '__proto__'));
});

test('validateFields: schema order, required, normalised values, salts, exact keys', () => {
  const good = salted([
    ['employeeName', 'MEERA JOSHI'],
    ['payPeriod', '2026-07'],
    ['netPay', '3000000'],
  ]);
  assert.deepEqual(validateFields('SALARY_SLIP', good), { ok: true, errors: {} });
  const bad = {
    reordered: [good[1], good[0], good[2]],
    repeated: [good[0], good[0], good[1], good[2]],
    'unknown name': [...good, { name: 'bonus', value: '1', salt: SALT }],
    'missing required': [good[0], good[1]],
    'value not normalised': [good[0], good[1], { ...good[2], value: '30,000' }],
    'uppercase salt': [good[0], good[1], { ...good[2], salt: SALT.toUpperCase() }],
    'short salt': [good[0], good[1], { ...good[2], salt: 'abcd' }],
    'extra key': [good[0], good[1], { ...good[2], label: 'Net pay' }],
    'missing key': [good[0], good[1], { name: 'netPay', value: '3000000' }],
    'not an object': [good[0], good[1], 'netPay'],
    'sparse (found by the fuzz run)': [good[0], , good[2]], // eslint-disable-line no-sparse-arrays
    'longer than the schema': [...good, ...good],
  };
  for (const [name, fields] of Object.entries(bad)) {
    assert.equal(validateFields('SALARY_SLIP', fields).ok, false, name);
  }
  assert.deepEqual(validateFields('SALARY_SLIP', 'x').errors, { fields: 'must be an array' });
  assert.equal(validateFields('OFFER_LETTER', []).ok, true);
  assert.equal(validateFields('OFFER_LETTER', [good[0]]).ok, false);
});

// ---- the field tree ------------------------------------------------------------------------------

test('field tree known vectors: leaves, roots of 1/2/3/5 fields and the empty root', () => {
  assert.deepEqual(VECTORS.leaves, VECTORS.fields.map(fieldLeafHash));
  for (const [n, root] of Object.entries(VECTORS.roots)) {
    const fields = VECTORS.fields.slice(0, Number(n));
    assert.equal(buildFieldTree(fields).root, root, `${n} fields`);
    assert.equal(refFieldsRoot(fields), root, `${n} fields (reference)`);
  }
  assert.equal(EMPTY_FIELDS_ROOT, VECTORS.emptyFieldsRoot);
  assert.equal(EMPTY_FIELDS_ROOT, sha256(Buffer.from([0x04])));
  assert.deepEqual(buildFieldTree([]), { root: EMPTY_FIELDS_ROOT, leaves: [] });
  // 1 field: the root is its leaf; 3 fields: the third leaf is promoted
  assert.equal(VECTORS.roots[1], VECTORS.leaves[0]);
  const [l0, l1, l2] = VECTORS.leaves;
  assert.equal(VECTORS.roots[3], refFieldNode(refFieldNode(l0, l1), l2));
  assert.equal(fieldNodeHash(l0, l1), refFieldNode(l0, l1));
});

test('v2 record vector: canonical JSON and leaf include fieldsRoot and v:2', () => {
  const { canonical, leaf, ...record } = VECTORS.record;
  assert.equal(record.fieldsRoot, VECTORS.roots[5]);
  assert.equal(canonicalJSON(record), canonical);
  assert.match(canonical, /"fieldsRoot":"0x[0-9a-f]{64}","fileHash"/);
  assert.match(canonical, /"v":2}$/);
  assert.equal(leafHash(record), leaf);
  assert.equal(refLeafV2(record), leaf);
  const { fieldsRoot, ...v1 } = record;
  assert.match(canonicalJSON(v1), /"v":1}$/);
  assert.notEqual(leafHash(v1), leaf);
});

test('field tree of 1 to 9 random fields matches the reference', () => {
  for (let n = 1; n <= 9; n++) {
    const fields = Array.from({ length: n }, (_, i) => ({
      name: `f${i}`,
      value: `VALUE ${i * 7}`,
      salt: sha256(Buffer.from(`salt ${n}/${i}`)).slice(2, 34),
    }));
    const { root, leaves } = buildFieldTree(fields);
    assert.deepEqual(leaves, fields.map(refFieldLeaf));
    assert.equal(root, refFieldsRoot(fields), `${n} fields`);
  }
});

test('schema order is part of the root: the same fields reordered give another root', () => {
  const fields = VECTORS.fields;
  const swapped = [fields[1], fields[0], ...fields.slice(2)];
  assert.notEqual(buildFieldTree(swapped).root, buildFieldTree(fields).root);
  assert.equal(validateFields('SALARY_SLIP', swapped).ok, false);
  assert.equal(validateFields('SALARY_SLIP', fields).ok, true);
});

test('every value, name and salt is bound: changing one changes the root', () => {
  const { root } = buildFieldTree(VECTORS.fields);
  VECTORS.fields.forEach((entry, i) => {
    for (const change of [
      { value: entry.value + '1' },
      { name: entry.name + 'X' },
      { salt: SALT.replace('d', 'c') },
    ]) {
      const edited = VECTORS.fields.map((f, j) => (j === i ? { ...f, ...change } : f));
      assert.notEqual(buildFieldTree(edited).root, root, `field ${i} ${JSON.stringify(change)}`);
    }
  });
});

test('domain separation: field leaves and nodes never equal record leaves or batch nodes', () => {
  const entry = VECTORS.fields[4];
  const bytes = utf8(sortedJSON(entry));
  assert.equal(fieldLeafHash(entry), sha256Hex(Uint8Array.from([0x02, ...bytes])));
  // The same bytes as a record leaf (0x00), as a bare hash, and the empty-root prefix all differ
  const asRecordLeaf = sha256Hex(Uint8Array.from([0x00, ...bytes]));
  const unprefixed = sha256Hex(bytes);
  assert.equal(new Set([fieldLeafHash(entry), asRecordLeaf, unprefixed]).size, 3);
  const [a, b] = VECTORS.leaves;
  assert.notEqual(fieldNodeHash(a, b), nodeHash(a, b));
  assert.notEqual(EMPTY_FIELDS_ROOT, sha256Hex(new Uint8Array(0)));
  assert.equal(REF_EMPTY_FIELDS_ROOT, EMPTY_FIELDS_ROOT);
});

test('buildFieldTree rejects malformed fields', () => {
  const ok = VECTORS.fields[0];
  const bad = [
    null,
    'fields',
    [null],
    [{ ...ok, salt: 'xyz' }],
    [{ ...ok, salt: undefined }],
    [{ ...ok, value: 3000000 }],
    [{ ...ok, name: '' }],
    [ok, ok], // repeated name
    [ok, , VECTORS.fields[1]], // eslint-disable-line no-sparse-arrays
  ];
  for (const fields of bad)
    assert.throws(() => buildFieldTree(fields), TypeError, JSON.stringify(fields));
});

// ---- single-field disclosure ---------------------------------------------------------------------

test('fieldProof / verifyFieldProof: every field of 1 to 7 fields round-trips', () => {
  for (let n = 1; n <= 7; n++) {
    const fields = salted(Array.from({ length: n }, (_, i) => [`f${i}`, `V${i}`]));
    const { root } = buildFieldTree(fields);
    for (let i = 0; i < n; i++) {
      const disclosure = fieldProof(fields, i);
      assert.deepEqual(disclosure.field, fields[i]);
      assert.equal(disclosure.count, n);
      assert.equal(verifyFieldProof(disclosure, root), true, `${n} fields, field ${i}`);
      assert.equal(verifyFieldProof(disclosure, root.toUpperCase().replace('0X', '0x')), true);
    }
  }
});

test('verifyFieldProof rejects any tampered disclosure and never throws', () => {
  const fields = VECTORS.fields;
  const { root } = buildFieldTree(fields);
  const genuine = fieldProof(fields, 4); // netPay
  const flip = (hex) => hex.slice(0, -1) + (hex.endsWith('0') ? '1' : '0');
  const tampered = {
    value: { ...genuine, field: { ...genuine.field, value: '4000000' } },
    salt: { ...genuine, field: { ...genuine.field, salt: SALT.replace('e', 'f') } },
    name: { ...genuine, field: { ...genuine.field, name: 'grossPay' } },
    sibling: {
      ...genuine,
      siblings: genuine.siblings.map((s, i) => (i === 0 ? { ...s, hash: flip(s.hash) } : s)),
    },
    side: {
      ...genuine,
      siblings: genuine.siblings.map((s) => ({ ...s, pos: s.pos === 'left' ? 'right' : 'left' })),
    },
    index: { ...genuine, index: 3 },
    count: { ...genuine, count: 6 },
  };
  for (const [name, disclosure] of Object.entries(tampered)) {
    assert.equal(verifyFieldProof(disclosure, root), false, name);
  }
  assert.equal(verifyFieldProof(genuine, flip(root)), false);
  for (const junk of [undefined, null, {}, { field: null }, 'x', { ...genuine, siblings: null }]) {
    assert.doesNotThrow(() => assert.equal(verifyFieldProof(junk, root), false));
  }
  assert.equal(verifyFieldProof(genuine, undefined), false);
  assert.throws(() => fieldProof(fields, 5), RangeError);
  assert.throws(() => fieldProof([], 0), RangeError);
});

// ---- extraction and diff -------------------------------------------------------------------------

/**
 * The text of a PDF in three layouts real extractors produce: lines (pdf.js items joined at
 * hasEOL, as the verifier does), one item per line, and everything on one line.
 */
async function pdfTextLayouts(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const items = [];
  for (let n = 1; n <= doc.numPages; n++) {
    items.push(...(await (await doc.getPage(n)).getTextContent()).items);
  }
  await doc.destroy();
  const lines = items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join('');
  return {
    lines,
    'item per line': items.map((item) => item.str).join('\n'),
    'one line': lines.replace(/\s+/g, ' '),
  };
}

const expectedFields = (doc) => {
  const { fields, errors } = normalizeFields(doc.docType, doc.fields);
  assert.deepEqual(errors, {}, doc.file);
  return Object.fromEntries(fields.map(({ name, value }) => [name, value]));
};

test('extractFields reads every registered field of every salary slip in samples/', async () => {
  const slips = MANIFEST.documents.filter((doc) => doc.docType === 'SALARY_SLIP');
  assert.equal(slips.length, 3);
  for (const doc of slips) {
    const expected = expectedFields(doc);
    assert.equal(Object.keys(expected).length, 5, doc.file);
    for (const [layout, text] of Object.entries(await pdfTextLayouts(new URL(doc.file, SAMPLES)))) {
      assert.deepEqual(extractFields('SALARY_SLIP', text), expected, `${doc.file} (${layout})`);
    }
  }
});

test('extractFields on the tampered slip: same fields except netPay (50,000 -> 80,000)', async () => {
  const { tampered } = MANIFEST;
  const original = MANIFEST.documents.find((doc) => doc.file === tampered.basedOn);
  const expected = { ...expectedFields(original), netPay: '8000000' };
  for (const [layout, text] of Object.entries(
    await pdfTextLayouts(new URL(tampered.file, SAMPLES)),
  )) {
    const found = extractFields('SALARY_SLIP', text);
    assert.deepEqual(found, expected, layout);
    const rows = diffFields(normalizeFields('SALARY_SLIP', original.fields).fields, found);
    assert.deepEqual(
      rows
        .filter((row) => row.status !== 'match')
        .map(({ name, registered, found: value, status }) => [name, registered, value, status]),
      [['netPay', '5000000', '8000000', 'changed']],
      layout,
    );
  }
});

test('extractFields reads the marksheet and degree samples, and the .txt certificate', async () => {
  for (const doc of MANIFEST.documents.filter((d) => Object.keys(d.fields).length > 0)) {
    if (doc.docType === 'SALARY_SLIP') continue;
    const path = new URL(doc.file, SAMPLES);
    const text = doc.file.endsWith('.txt')
      ? readFileSync(path, 'utf8')
      : (await pdfTextLayouts(path)).lines;
    assert.deepEqual(extractFields(doc.docType, text), expectedFields(doc), doc.file);
  }
});

test('extractFields: labels with colons, values on the next line, CRLF; missing -> null', () => {
  const text =
    'Pay slip\r\nEmployee Name :\r\n  Ananya   Iyer \r\nEmp. No.: ab-77\r\nPay period - Sept 2026\r\nGross Salary Rs. 1,00,000\r\nNet Salary (₹) 88,000/-';
  assert.deepEqual(extractFields('SALARY_SLIP', text), {
    employeeName: 'ANANYA IYER',
    employeeId: 'AB-77',
    payPeriod: '2026-09',
    grossPay: '10000000',
    netPay: '8800000',
  });
  assert.deepEqual(extractFields('SALARY_SLIP', 'nothing here'), {
    employeeName: null,
    employeeId: null,
    payPeriod: null,
    grossPay: null,
    netPay: null,
  });
  assert.deepEqual(extractFields('OFFER_LETTER', 'Net Pay 5,000'), {});
  assert.deepEqual(extractFields('SALARY_SLIP', undefined).netPay, null);
});

test('diffFields: match, changed and unreadable, with labels, in registered order', () => {
  const registered = [
    { name: 'employeeName', value: 'MEERA JOSHI' },
    { name: 'payPeriod', value: '2026-07' },
    { name: 'netPay', value: '3000000' },
  ];
  assert.deepEqual(
    diffFields(registered, {
      employeeName: 'MEERA JOSHI',
      payPeriod: null,
      netPay: '4000000',
      grossPay: '1',
    }),
    [
      {
        name: 'employeeName',
        label: 'Employee name',
        registered: 'MEERA JOSHI',
        found: 'MEERA JOSHI',
        status: 'match',
      },
      {
        name: 'payPeriod',
        label: 'Pay period',
        registered: '2026-07',
        found: null,
        status: 'unreadable',
      },
      {
        name: 'netPay',
        label: 'Net pay',
        registered: '3000000',
        found: '4000000',
        status: 'changed',
      },
    ],
  );
  assert.deepEqual(diffFields([], {}), []);
});
