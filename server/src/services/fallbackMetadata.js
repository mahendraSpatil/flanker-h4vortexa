// Owner: Mahendra | Rule-based metadata suggestions: date regexes, docType keyword map, issuer line match
//
// Runs whenever AI_MODE=off, Gemini fails, or Gemini returns nothing usable. Every suggestion carries
// the exact source line it came from (evidence); a value without evidence is never suggested.
// Confidences are deliberately modest: these are heuristics and a person confirms every field.
import { FIELD_SCHEMAS, extractFieldsWithEvidence, normText } from '@proofchain/core';

const MAX_LINES = 400;
/** A value read right after its own label (e.g. "Net Pay ₹ 50,000") is a strong but unconfirmed match. */
const LABELLED_FIELD_CONFIDENCE = 0.75;
const MAX_EVIDENCE_CHARS = 200;
const ISSUER_MAX_CHARS = 120;
/** Issuers are near the top of a document (letterhead); lines below this are a weaker match. */
const ISSUER_TOP_LINES = 12;

/** Empty suggestion set, same shape as the AI path. */
export function emptySuggestions() {
  return {
    docType: null,
    issuer: null,
    date: null,
    confidence: { docType: 0, issuer: 0, date: 0 },
    evidence: { docType: '', issuer: '', date: '' },
  };
}

/**
 * Suggest metadata without AI. Dates: DD/MM/YYYY, "14 June 2026", ISO. docType: keyword map.
 * Issuer: first line matching University, Institute, College, Pvt Ltd or Limited.
 * @param {string} text extracted document text
 * @param {{ today?: string }} [options] today's date as YYYY-MM-DD (dates after it are ignored)
 * @returns {import('./aiMetadata.js').MetadataSuggestions} same shape as the AI path
 */
export function suggestMetadataByRules(text, { today = localIsoDate(new Date()) } = {}) {
  const lines = toLines(text);
  const result = emptySuggestions();
  for (const found of [findDocType(lines), findIssuer(lines), findDate(lines, today)]) {
    if (!found) continue;
    result[found.field] = found.value;
    result.confidence[found.field] = round2(found.confidence);
    result.evidence[found.field] = evidenceOf(found.line);
  }
  return result;
}

/**
 * Suggest document fields (net pay, employee name, ...) without AI, with core's label-based
 * extractFieldsWithEvidence. Every docType's fields are read, so the confirm screen can prefill
 * them whichever docType the person picks. Values are normalised (amounts in paise).
 * @param {string} text extracted document text
 * @returns {{ [name: string]: { value: string, confidence: number, evidence: string } }} only fields found
 */
export function suggestFieldsByRules(text) {
  const suggestions = {};
  for (const docType of Object.keys(FIELD_SCHEMAS)) {
    for (const [name, hit] of Object.entries(extractFieldsWithEvidence(docType, text))) {
      if (!hit || suggestions[name]) continue;
      suggestions[name] = {
        value: hit.value,
        confidence: LABELLED_FIELD_CONFIDENCE,
        evidence: evidenceOf(hit.evidence),
      };
    }
  }
  return suggestions;
}

/** Split text into trimmed, whitespace-collapsed, non-empty lines. */
export function toLines(text) {
  return String(text ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

/** Today's date in the server's local time zone, as YYYY-MM-DD. */
export function localIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return Boolean(match) && isCalendarDate(+match[1], +match[2], +match[3]);
}

function evidenceOf(line) {
  return line.length > MAX_EVIDENCE_CHARS ? line.slice(0, MAX_EVIDENCE_CHARS) : line;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---- docType ------------------------------------------------------------------------------------

/** Keyword map: each pattern counts once per document; the strongest total wins. */
const DOC_TYPE_RULES = [
  {
    type: 'DEGREE_CERTIFICATE',
    patterns: [
      [/\bdegree certificate\b|\bprovisional (degree )?certificate\b/i, 3],
      [/\b(bachelor|master|doctor) of\b|\bb\.? ?tech\b|\bm\.? ?tech\b|\bph\.? ?d\b/i, 2],
      [/\bconferred\b|\bhereby certif(y|ies) that\b.*\bdegree\b|\bconvocation\b/i, 1],
      [/\bdegree\b/i, 1],
    ],
  },
  {
    type: 'MARKSHEET',
    patterns: [
      [/\bmark ?sheet\b|\bstatement of marks\b|\bmarks? statement\b|\bgrade (card|sheet|report)\b|\btranscript\b/i, 3],
      [/\b[sc]\.? ?g\.? ?p\.? ?a\b/i, 2],
      [/\bmarks obtained\b|\bmax(imum)? marks\b|\bcredits?( earned)?\b|\bseat (no|number)\b/i, 1],
      [/\bsemester\b|\bsubject code\b/i, 1],
    ],
  },
  {
    type: 'SALARY_SLIP',
    patterns: [
      [/\bsalary slip\b|\bpay ?slip\b|\bpay stub\b|\bsalary statement\b/i, 3],
      [/\bnet (pay|salary|amount payable)\b|\bgross (pay|salary|earnings)\b/i, 2],
      [/\bbasic (pay|salary)\b|\bh\.?r\.?a\b|\bprovident fund\b|\bepf\b|\bdeductions?\b/i, 1],
      [/\bearnings\b|\bpay period\b|\bmonth of\b/i, 1],
    ],
  },
  {
    type: 'OFFER_LETTER',
    patterns: [
      [/\boffer letter\b|\bletter of offer\b|\boffer of (employment|appointment)\b|\bappointment letter\b/i, 3],
      [/\b(pleased|happy|delighted) to offer\b/i, 2],
      [/\bctc\b|\bdate of joining\b|\bjoining date\b|\bprobation\b|\bcompensation\b/i, 1],
    ],
  },
  {
    type: 'EXPERIENCE_LETTER',
    patterns: [
      [/\bexperience (letter|certificate)\b|\brelieving letter\b|\bservice certificate\b|\bemployment certificate\b/i, 3],
      [/\bworked (with|at|for) (us|our)\b|\bwas employed\b|\bhas worked\b/i, 2],
      [/\blast working day\b|\brelieved\b|\bduring (his|her|their) tenure\b/i, 1],
    ],
  },
];

function findDocType(lines) {
  const scored = DOC_TYPE_RULES.map(({ type, patterns }) => {
    let score = 0;
    let best = null; // [weight, line] of the strongest matched pattern, used as evidence
    for (const [pattern, weight] of patterns) {
      const line = lines.find((l) => pattern.test(l));
      if (!line) continue;
      score += weight;
      if (!best || weight > best[0]) best = [weight, line];
    }
    return { type, score, line: best?.[1] };
  }).sort((a, b) => b.score - a.score);

  const [top, runnerUp] = scored;
  if (!top || top.score < 2) return null; // one weak keyword is not enough to suggest anything
  let confidence = Math.min(0.85, 0.35 + 0.1 * top.score);
  if (runnerUp && runnerUp.score === top.score) confidence *= 0.6; // ambiguous between two types
  return { field: 'docType', value: top.type, confidence, line: top.line };
}

// ---- issuer -------------------------------------------------------------------------------------

const ISSUER_TERMS =
  /\b(university|universit(y|é)|institute|institution|college|school|academy|vidyapeeth|vidyalaya|pvt\.?|private limited|limited|ltd\.?|llp|inc\.?|corporation|corp\.?|technologies|solutions|enterprises)\b/i;
/** Lines that read like a sentence about someone, not a letterhead. */
const SENTENCE_HINTS =
  /\b(hereby|certify|certifies|certified|this is to|has been|have been|was|were|is pleased|we are|dear|sincerely|employed|studied|completed)\b/i;
const ISSUER_LABEL = /^(issued by|issuer|institution|university|college|company|employer|organi[sz]ation|from)\s*[:\-–]\s*(.+)$/i;

function findIssuer(lines) {
  const candidates = [];
  lines.forEach((line, index) => {
    const labelled = ISSUER_LABEL.exec(line);
    const value = cleanIssuer(labelled ? labelled[2] : line);
    if (!value || !ISSUER_TERMS.test(value)) return;
    if (value.length > ISSUER_MAX_CHARS) return;

    let confidence = labelled ? 0.7 : 0.6;
    if (index >= ISSUER_TOP_LINES) confidence -= 0.15;
    if (looksLikeSentence(value)) {
      // A sentence mentioning an organisation: suggest just the capitalised name, with less confidence.
      const span = organisationSpan(value);
      if (!span) return;
      candidates.push({ value: span, confidence: confidence - 0.15, line, index });
      return;
    }
    candidates.push({ value, confidence, line, index });
  });
  if (candidates.length === 0) return null;

  // Highest confidence wins; among equals the earliest line (letterheads come first).
  candidates.sort((a, b) => b.confidence - a.confidence || a.index - b.index);
  const best = candidates[0];
  if (best.confidence < 0.3) return null;
  return { field: 'issuer', value: best.value, confidence: best.confidence, line: best.line };
}

const NAME_CONNECTORS = new Set(['of', 'and', 'the', 'for', 'in', '&']);

/** Letterheads are short and capitalised; sentences have verbs and several lowercase words. */
function looksLikeSentence(value) {
  const words = value.split(' ');
  const lowercaseWords = words.filter((w) => /^[a-z]/.test(w) && !NAME_CONNECTORS.has(w)).length;
  return SENTENCE_HINTS.test(value) || words.length > 12 || lowercaseWords >= 3;
}

/** "...the role of Analyst at Nimbus Solutions Limited." -> "Nimbus Solutions Limited" */
const COMPANY_WORD = '(?:Technologies|Solutions|Enterprises|Industries|Corporation|Systems|Services|Labs)';
const COMPANY_SUFFIX = '(?:Pvt\\.?\\s*Ltd\\.?|Private\\s+Limited|Limited|Ltd\\.?|LLP|Inc\\.?)';
const NAME_WORDS = "(?:[A-Z][\\w&.'-]*\\s+)";
const ORG_SPAN = new RegExp(
  // Company: "Nimbus Solutions Limited", "Acme Pvt Ltd"
  `(${NAME_WORDS}{1,5}?(?:${COMPANY_WORD}(?:\\s+${COMPANY_SUFFIX})?|${COMPANY_SUFFIX}))` +
    // Education: "Modern College of Arts and Science", "Pimpri Institute of Technology"
    `|(${NAME_WORDS}{0,4}?(?:University|Institute|College|Academy|School)(?:\\s+of(?:\\s+(?:[A-Z][\\w&.'-]*|and|&)){1,6})?)`,
);

function organisationSpan(sentence) {
  const match = ORG_SPAN.exec(sentence);
  if (!match) return '';
  const span = (match[1] ?? match[2]).replace(/\s+(and|&)$/i, '');
  return cleanIssuer(span);
}

function cleanIssuer(raw) {
  const value = normText(raw.replace(/^[\s\-–•*#|:,.]+|[\s\-–•*#|:,]+$/g, ''));
  return value.length >= 3 ? value : '';
}

// ---- date ---------------------------------------------------------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SEP = '[\\s\\-/.,]+';
const monthNumber = (name) => MONTHS[name.slice(0, 3).toLowerCase()];

/** Each pattern yields { y, m, d, confidence } candidates; validated against the calendar afterwards. */
const DATE_PATTERNS = [
  // 2026-06-14
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, read: (x) => ({ y: +x[1], m: +x[2], d: +x[3], confidence: 0.6 }) },
  // 14 June 2026, 14th Jun, 2026, 14-Jun-2026
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?${SEP}${MONTH}\\.?${SEP}(\\d{4})\\b`, 'gi'),
    read: (x) => ({ y: +x[3], m: monthNumber(x[2]), d: +x[1], confidence: 0.6 }),
  },
  // June 14, 2026
  {
    re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    read: (x) => ({ y: +x[3], m: monthNumber(x[1]), d: +x[2], confidence: 0.6 }),
  },
  // 14/06/2026, 14-06-2026, 14.06.2026 (Indian DD/MM first; MM/DD only when DD/MM is impossible)
  { re: /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/g, read: readNumericDate },
];

function readNumericDate(x) {
  const a = +x[1];
  const b = +x[2];
  const y = +x[3];
  if (a > 12 && b <= 12) return { y, m: b, d: a, confidence: 0.6 }; // unambiguous DD/MM
  if (b > 12 && a <= 12) return { y, m: a, d: b, confidence: 0.45 }; // must be MM/DD
  if (a === b) return { y, m: b, d: a, confidence: 0.6 };
  return { y, m: b, d: a, confidence: 0.45 }; // 03/04/2026: assume DD/MM, but say we are unsure
}

/** Lines whose dates are not the document's date. */
const NOT_ISSUE_DATE = /\b(birth|d\.?\s?o\.?\s?b|born|valid (till|until|upto|up to)|expir(y|es|ation)|due date)\b/i;
/** Lines that usually carry the issue date. */
const ISSUE_DATE_HINT = /\b(date[d]?|issued?|issue date|awarded|declared|result|joining|relieving|effective|place and date)\b/i;

function findDate(lines, today) {
  let best = null;
  lines.forEach((line, index) => {
    if (NOT_ISSUE_DATE.test(line)) return;
    for (const { re, read } of DATE_PATTERNS) {
      re.lastIndex = 0;
      for (const match of line.matchAll(re)) {
        const { y, m, d, confidence } = read(match);
        if (!m || !isCalendarDate(y, m, d)) continue;
        const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (value > today || y < 1900) continue;
        const score = confidence + (ISSUE_DATE_HINT.test(line) ? 0.15 : 0);
        if (!best || score > best.confidence || (score === best.confidence && index < best.index)) {
          best = { field: 'date', value, confidence: Math.min(score, 0.8), line, index };
        }
      }
    }
  });
  return best;
}

function isCalendarDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
