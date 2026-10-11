// Owner: Mahendra | Rule-based suggestions (the path that must work fully with AI_MODE=off)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestMetadataByRules } from '../src/services/fallbackMetadata.js';

const today = '2026-10-11';
const suggest = (text) => suggestMetadataByRules(text, { today });

test('salary slip: type, company issuer, DD/MM/YYYY date; date of birth ignored', () => {
  const s = suggest(`ACME TECHNOLOGIES PVT. LTD.
Salary Slip for the month of June 2026
Employee: Riya Sharma   Date of Birth: 02/03/1999
Gross Salary 50,000   Net Pay 46,200
Date: 30/06/2026`);
  assert.equal(s.docType, 'SALARY_SLIP');
  assert.equal(s.issuer, 'ACME TECHNOLOGIES PVT. LTD.');
  assert.equal(s.date, '2026-06-30');
  assert.equal(s.evidence.date, 'Date: 30/06/2026');
  assert.equal(s.evidence.docType, 'Salary Slip for the month of June 2026');
});

test('degree certificate: "14th June 2026" and institute letterhead', () => {
  const s = suggest(`PIMPRI INSTITUTE OF TECHNOLOGY
DEGREE CERTIFICATE
This is to certify that Aarav Patil has been conferred the degree of Bachelor of Engineering
Awarded on 14th June 2026`);
  assert.equal(s.docType, 'DEGREE_CERTIFICATE');
  assert.equal(s.issuer, 'PIMPRI INSTITUTE OF TECHNOLOGY');
  assert.equal(s.date, '2026-06-14');
});

test('"June 3, 2026", ISO dates and issuer names inside sentences', () => {
  assert.equal(suggest('Result declared on June 3, 2026').date, '2026-06-03');
  assert.equal(suggest('Issued 2026-09-20').date, '2026-09-20');
  const offer = suggest('We are pleased to offer you the role of Analyst at Nimbus Solutions Limited.');
  assert.equal(offer.docType, 'OFFER_LETTER', '"pleased to offer" is a strong phrase');
  assert.equal(suggest('Your degree is attached').docType, null, 'one weak keyword is not enough');
  assert.equal(offer.issuer, 'Nimbus Solutions Limited');
  assert.ok(offer.confidence.issuer < 0.6, 'sentence matches get lower confidence');
});

test('future and impossible dates are never suggested', () => {
  assert.equal(suggest('Date: 2027-01-01').date, null);
  assert.equal(suggest('Date: 31/02/2026').date, null);
});

test('nothing found: null values, zero confidence, empty evidence', () => {
  assert.deepEqual(suggest('hello world'), {
    docType: null,
    issuer: null,
    date: null,
    confidence: { docType: 0, issuer: 0, date: 0 },
    evidence: { docType: '', issuer: '', date: '' },
  });
});

test('every suggested value has evidence that is a line of the text', () => {
  const text = 'Deccan College of Commerce\nStatement of Marks\nSGPA 8.4\nDate: 05.03.2026';
  const s = suggest(text);
  for (const field of ['docType', 'issuer', 'date']) {
    assert.notEqual(s[field], null, field);
    assert.ok(text.split('\n').includes(s.evidence[field]), `${field} evidence is a source line`);
  }
});
