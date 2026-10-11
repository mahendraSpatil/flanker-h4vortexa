// Owner: Mahendra | Confirm screen: review AI suggestions + evidence, edit, confirm metadata
// Layout follows "ProofChain UI Screens" screen 2.
import {
  DOC_TYPES,
  FieldValueError,
  ISSUER_MAX_LENGTH,
  canonicalJSON,
  displayFieldValue,
  fieldDefinition,
  fieldInputValue,
  fieldSchema,
  normText,
  normalizeFieldValue,
} from '@proofchain/core';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as documents from '../api/documents.js';
import { HashChip } from './Upload.jsx';

const FIELDS = ['docType', 'issuer', 'date'];
const FIELD_LABELS = { docType: 'Document type', issuer: 'Issuer', date: 'Date' };
/** Below this the field is highlighted with "check this". */
const LOW_CONFIDENCE = 0.7;

const docTypeLabel = (type) =>
  type
    .toLowerCase()
    .split('_')
    .map((word, i) => (i === 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The server draws the salts, so fieldsRoot exists only after confirm: the preview shows this instead. */
const FIELDS_ROOT_PREVIEW = '(computed on confirm from the salted fields)';
const PREVIEW_SENTINEL = `0x${'0'.repeat(64)}`;

/** A document field's value as the server will store it, or null when blank or unreadable. */
function readFieldValue(kind, raw) {
  if (!raw || raw.trim() === '') return null;
  try {
    return normalizeFieldValue(kind, raw);
  } catch (err) {
    if (err instanceof FieldValueError) return null;
    throw err;
  }
}

/** Errors for the selected docType's document fields, keyed "fields.<name>" like the server's. */
function validateDocumentFields(docType, fieldValues) {
  const errors = {};
  for (const { name, kind, required } of fieldSchema(docType)) {
    const raw = fieldValues[name] ?? '';
    if (raw.trim() === '') {
      if (required) errors[`fields.${name}`] = 'is required';
      continue;
    }
    try {
      normalizeFieldValue(kind, raw);
    } catch (err) {
      if (!(err instanceof FieldValueError)) throw err;
      errors[`fields.${name}`] = err.message;
    }
  }
  return errors;
}

/** The selected docType's non-blank field inputs, as sent to the server (it normalises them). */
function fieldsPayload(docType, fieldValues) {
  return Object.fromEntries(
    fieldSchema(docType)
      .filter(({ name }) => (fieldValues[name] ?? '').trim() !== '')
      .map(({ name }) => [name, fieldValues[name]]),
  );
}

/** Initial input text per field name: confirmed values, else suggestions, as a person would type them. */
function initialFieldValues(view) {
  const source = view.confirmed
    ? (view.confirmed.fields ?? []).map(({ name, value }) => [name, value])
    : Object.entries(view.suggestions?.fields ?? {}).map(([name, { value }]) => [name, value]);
  return Object.fromEntries(
    source
      .filter(([name]) => fieldDefinition(name))
      .map(([name, value]) => [name, fieldInputValue(fieldDefinition(name).kind, value)]),
  );
}

/**
 * Mirrors the server rules so mistakes show before the request; the server stays the authority.
 * Messages are fragments read after the field label, like the server's ("Issuer is required").
 */
function validate(values, today) {
  const errors = {};
  if (!DOC_TYPES.includes(values.docType)) errors.docType = 'is required';
  const issuer = normText(values.issuer);
  if (!issuer) errors.issuer = 'is required';
  else if ([...issuer].length > ISSUER_MAX_LENGTH) errors.issuer = `must be at most ${ISSUER_MAX_LENGTH} characters`;
  if (!values.date) errors.date = 'is required';
  else if (!isCalendarDate(values.date)) errors.date = 'must be a real date';
  else if (values.date > today) errors.date = 'must not be in the future';
  return errors;
}

/** One shape for both sources: the upload response (router state) or a record from GET /api/documents. */
function toView(source) {
  const confirmed =
    source.status && source.status !== 'draft'
      ? {
          docType: source.docType,
          issuer: source.issuer,
          date: source.date,
          fields: source.fields ?? [],
          leaf: source.leaf,
          batchId: source.batchId,
        }
      : null;
  return {
    recordId: source.recordId,
    fileHash: source.fileHash,
    fileName: source.fileName,
    mime: source.mime,
    status: source.status ?? 'draft',
    suggestions: source.suggestions ?? null,
    extractionPath: source.extractionPath ?? null,
    warnings: source.warnings ?? [],
    confirmed,
  };
}

export default function Confirm() {
  const { recordId } = useParams();
  const { state } = useLocation();
  const fromUpload = state?.upload?.recordId === recordId ? toView(state.upload) : null;
  const [view, setView] = useState(fromUpload);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (view?.recordId === recordId) return undefined;
    let cancelled = false;
    setLoadError(null);
    documents
      .list({ recordId })
      .then((records) => {
        if (cancelled) return;
        const record = records.find((r) => r.recordId === recordId);
        if (record) setView(toView(record));
        else setLoadError({ code: 'NOT_FOUND', message: `No record ${recordId}.` });
      })
      .catch((err) => !cancelled && setLoadError({ code: err.code, message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [recordId, view?.recordId]);

  // After navigating from one confirm URL to another, never show the previous record's form.
  const current = view?.recordId === recordId ? view : null;

  return (
    <section>
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link to="/" className="underline hover:text-slate-900">
          Upload
        </Link>{' '}
        / <span className="font-mono">{recordId}</span>
      </nav>

      {loadError ? (
        <div role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-mono text-xs font-semibold">{loadError.code}</p>
          <p>{loadError.message}</p>
        </div>
      ) : !current ? (
        <p className="mt-6 text-slate-500">Loading {recordId}…</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Confirm details</h1>
              <p className="mt-1 text-slate-600">
                Check each value against the document. Only what you confirm goes into the record's leaf.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge status={current.status} />
              <span className="max-w-56 truncate font-semibold text-slate-900">{current.fileName}</span>
              <HashChip value={current.fileHash} />
            </div>
          </div>

          <div className="mt-6 grid items-start gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <DocumentPanel view={current} />
            {/* key: a different record gets a fresh form */}
            <ConfirmForm key={current.recordId} view={current} />
          </div>
        </>
      )}
    </section>
  );
}

function StatusBadge({ status }) {
  const styles = {
    draft: 'bg-slate-100 text-slate-700',
    pending: 'bg-amber-100 text-amber-800',
    anchored: 'bg-emerald-100 text-emerald-800',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles[status] ?? styles.draft}`}>{status}</span>;
}

function Card({ title, aside, children, bodyClass = 'p-5' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {aside}
      </div>
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

// ---- left: the document -------------------------------------------------------------------------

function DocumentPanel({ view }) {
  const url = documents.fileUrl(view.recordId);
  const isText = view.mime === 'text/plain';
  const isImage = view.mime?.startsWith('image/');
  const evidence = [
    ...FIELDS.map((f) => view.suggestions?.evidence?.[f]),
    ...Object.values(view.suggestions?.fields ?? {}).map((s) => s.evidence),
  ].filter(Boolean);

  return (
    <Card
      title="Document"
      aside={
        <span className="text-xs text-slate-500">
          {isText && evidence.length > 0 ? "Highlighted lines are the AI's evidence" : (
            <a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
              Open in new tab
            </a>
          )}
        </span>
      }
      bodyClass="bg-slate-100 p-4"
    >
      {isText ? (
        <TextPreview url={url} evidence={evidence} />
      ) : isImage ? (
        <img src={url} alt={`Uploaded document ${view.fileName}`} className="mx-auto max-h-[75vh] w-full rounded bg-white object-contain shadow-sm" />
      ) : (
        <iframe src={url} title={`Uploaded document ${view.fileName}`} className="h-[75vh] w-full rounded bg-white shadow-sm" />
      )}
    </Card>
  );
}

/** Text files are shown as <pre> so the evidence lines can be highlighted. */
function TextPreview({ url, evidence }) {
  const [text, setText] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(res.statusText))))
      .then((body) => !cancelled && setText(body))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return <p className="text-sm text-rose-700">Could not load the file.</p>;
  if (text === null) return <p className="text-sm text-slate-500">Loading…</p>;

  const marks = new Set(evidence.map((line) => normText(line).toLowerCase()));
  return (
    <pre className="max-h-[75vh] overflow-auto rounded bg-white p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-800 shadow-sm">
      {text.split(/\r\n|\r|\n/).map((line, i) => (
        // eslint-disable-next-line react/no-array-index-key -- lines of a static file
        <span key={i} className={marks.has(normText(line).toLowerCase()) ? 'bg-yellow-200' : undefined}>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

// ---- right: the metadata form -------------------------------------------------------------------

function ConfirmForm({ view }) {
  const navigate = useNavigate();
  const today = localToday();
  const suggestions = view.suggestions;
  const initial = view.confirmed ?? {
    docType: suggestions?.docType ?? '',
    issuer: suggestions?.issuer ?? '',
    date: suggestions?.date ?? '',
  };
  const [values, setValues] = useState({ docType: initial.docType ?? '', issuer: initial.issuer ?? '', date: initial.date ?? '' });
  const [fieldValues, setFieldValues] = useState(() => initialFieldValues(view));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);
  const [anchored, setAnchored] = useState(view.status === 'anchored');

  const schema = fieldSchema(values.docType);
  const liveErrors = { ...validate(values, today), ...validateDocumentFields(values.docType, fieldValues) };
  const missingRequired = schema.filter(({ name, required }) => required && !(fieldValues[name] ?? '').trim());
  const canonical = useMemo(() => {
    if (Object.keys(liveErrors).length > 0) return null;
    const record = { recordId: view.recordId, fileHash: view.fileHash, fieldsRoot: PREVIEW_SENTINEL };
    return canonicalJSON({ ...record, docType: values.docType, issuer: values.issuer, date: values.date }).replace(
      PREVIEW_SENTINEL,
      FIELDS_ROOT_PREVIEW,
    );
    // liveErrors is derived from values and fieldValues
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, fieldValues, view.recordId, view.fileHash]);

  if (result) return <ConfirmedPanel result={result} />;

  const byAi = view.extractionPath === 'ai';
  const readOnly = anchored || submitting;
  const setField = (field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const setDocumentField = (name, value) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [`fields.${name}`]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setErrors(liveErrors);
    setSubmitError(null);
    if (Object.keys(liveErrors).length > 0) return;

    setSubmitting(true);
    try {
      setResult(
        await documents.confirm(view.recordId, {
          ...values,
          fields: fieldsPayload(values.docType, fieldValues),
        }),
      );
    } catch (err) {
      if (err.code === 'VALIDATION') setErrors(err.details?.fields ?? {});
      if (err.code === 'ALREADY_ANCHORED') setAnchored(true);
      setSubmitError({
        code: err.code,
        message: err.code === 'VALIDATION' ? 'The server rejected some fields. See the messages below.' : err.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      title="Metadata"
      aside={
        view.status === 'draft' && (
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${byAi ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
            {byAi ? 'Extracted by AI · Gemini' : 'Extracted by rules · AI off or unavailable'}
          </span>
        )
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <StateNote view={view} anchored={anchored} />
        {view.warnings.map((warning) => (
          <p key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {warning}
          </p>
        ))}

        <Field field="docType" suggestions={suggestions} byAi={byAi} error={errors.docType} value={values.docType} onUseSuggestion={setField} format={docTypeLabel}>
          {(props) => (
            <select {...props} value={values.docType} disabled={readOnly} onChange={(e) => setField('docType', e.target.value)}>
              <option value="" disabled>
                Choose a type…
              </option>
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {docTypeLabel(type)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field field="issuer" suggestions={suggestions} byAi={byAi} error={errors.issuer} value={values.issuer} onUseSuggestion={setField}>
          {(props) => (
            <input
              {...props}
              type="text"
              value={values.issuer}
              readOnly={readOnly}
              placeholder="e.g. Deccan Institute of Technology"
              onChange={(e) => setField('issuer', e.target.value)}
            />
          )}
        </Field>

        <Field
          field="date"
          suggestions={suggestions}
          byAi={byAi}
          error={errors.date}
          value={values.date}
          onUseSuggestion={setField}
          help="Must be a real date, not in the future."
        >
          {(props) => <input {...props} type="date" value={values.date} max={today} readOnly={readOnly} onChange={(e) => setField('date', e.target.value)} />}
        </Field>

        {values.docType && (
          <section aria-labelledby="document-fields-title" className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id="document-fields-title" className="text-sm font-semibold text-slate-900">
                Document fields
              </h3>
              <span className="text-xs text-slate-500">
                {schema.length > 0 ? 'Each value is salted and committed to by fieldsRoot' : ''}
              </span>
            </div>
            {schema.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {docTypeLabel(values.docType)} has no document fields; its record commits to the empty field root.
              </p>
            ) : (
              schema.map((def) => (
                <DocumentField
                  key={def.name}
                  def={def}
                  value={fieldValues[def.name] ?? ''}
                  suggestion={view.suggestions?.fields?.[def.name]}
                  byAi={byAi}
                  error={errors[`fields.${def.name}`]}
                  readOnly={readOnly}
                  onChange={setDocumentField}
                />
              ))
            )}
          </section>
        )}

        <div>
          <p className="text-sm font-semibold text-slate-900">Canonical record that will be hashed</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-slate-100">
            {canonical ?? 'Complete the fields above to see the exact text that will be hashed.'}
          </pre>
          <p className="mt-1 text-xs text-slate-500">
            leaf = SHA-256(0x00 ‖ this text); fieldsRoot = root of the fields' tree, each leaf SHA-256(0x02 ‖ name, salt,
            value). AI suggestions and OCR text are never hashed.
          </p>
        </div>

        {submitError && (
          <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="font-mono text-xs font-semibold">{submitError.code}</p>
            <p>{submitError.message}</p>
          </div>
        )}

        {!anchored && missingRequired.length > 0 && (
          <p className="text-sm text-amber-800">
            Fill the required fields to confirm: {missingRequired.map((def) => def.label).join(', ')}.
          </p>
        )}
        <div className="flex gap-3">
          {!anchored && (
            <button
              type="submit"
              disabled={submitting || missingRequired.length > 0}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {submitting ? 'Confirming…' : view.status === 'pending' ? 'Update and keep pending' : 'Confirm and mark pending'}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back
          </button>
        </div>
      </form>
    </Card>
  );
}

function StateNote({ view, anchored }) {
  if (anchored) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Anchored in <span className="font-mono">{view.confirmed?.batchId ?? 'a sealed batch'}</span>. It can no longer change.
      </p>
    );
  }
  if (view.status === 'pending') {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Already confirmed. You can still correct it until the batch is sealed; that changes its leaf.
      </p>
    );
  }
  return null;
}

function Field({ field, suggestions, byAi, value, error, help, onUseSuggestion, format = (v) => v, children }) {
  const id = `field-${field}`;
  const suggested = suggestions?.[field] ?? null;
  const confidence = suggestions?.confidence?.[field] ?? 0;
  const evidence = suggestions?.evidence?.[field] ?? '';
  const low = suggested !== null && confidence < LOW_CONFIDENCE;
  const edited = suggested !== null && value !== suggested && normText(value ?? '') !== suggested;
  const describedBy = [error && `${id}-error`, suggested && `${id}-evidence`, help && `${id}-help`].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`rounded-lg border p-4 ${error ? 'border-rose-300' : low ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-slate-900">
          {FIELD_LABELS[field]}
        </label>
        {edited && (
          <button type="button" onClick={() => onUseSuggestion(field, suggested)} className="text-xs font-medium text-indigo-600 underline">
            Edited · use suggestion ({format(suggested)})
          </button>
        )}
      </div>

      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        className: `mt-2 w-full rounded-md border bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none ${
          error ? 'border-rose-400' : 'border-slate-300'
        } read-only:bg-slate-50 disabled:bg-slate-50`,
      })}

      {suggested ? (
        <div id={`${id}-evidence`} className="mt-3 space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <span className={`rounded px-1.5 py-0.5 font-semibold ${byAi ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
              {byAi ? 'AI' : 'Rules'}
            </span>
            <span className="text-slate-500">Confidence</span>
            <ConfidenceBar value={confidence} low={low} />
          </div>
          <blockquote className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-xs break-words text-amber-900">
            “{evidence}”
          </blockquote>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No suggestion with evidence was found. Enter it from the document.</p>
      )}

      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm text-rose-700">
          {FIELD_LABELS[field]} {error}
        </p>
      )}
      {help && !error && (
        <p id={`${id}-help`} className="mt-2 text-xs text-slate-500">
          {help}
        </p>
      )}
    </div>
  );
}

/** One document field: input prefilled from the suggestion, evidence quote, confidence, normalised preview. */
function DocumentField({ def, value, suggestion, byAi, error, readOnly, onChange }) {
  const id = `field-doc-${def.name}`;
  const suggestedInput = suggestion ? fieldInputValue(def.kind, suggestion.value) : null;
  const confidence = suggestion?.confidence ?? 0;
  const low = suggestion !== undefined && confidence < LOW_CONFIDENCE;
  const normalized = readFieldValue(def.kind, value);
  const edited = suggestion !== undefined && normalized !== suggestion.value;
  const describedBy = [error && `${id}-error`, suggestion && `${id}-evidence`, `${id}-help`].filter(Boolean).join(' ');

  return (
    <div className={`rounded-lg border p-4 ${error ? 'border-rose-300' : low ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-slate-900">
          {def.label}
          {def.kind === 'amount' && <span className="font-normal text-slate-500"> (₹)</span>}
          {def.required ? (
            <span className="ml-1 text-rose-600" aria-hidden="true">
              *
            </span>
          ) : (
            <span className="ml-2 text-xs font-normal text-slate-500">optional</span>
          )}
        </label>
        {edited && (
          <button type="button" onClick={() => onChange(def.name, suggestedInput)} className="text-xs font-medium text-indigo-600 underline">
            Edited · use suggestion ({suggestedInput})
          </button>
        )}
      </div>

      <input
        id={id}
        type="text"
        value={value}
        readOnly={readOnly}
        required={def.required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        placeholder={FIELD_PLACEHOLDERS[def.kind]}
        onChange={(e) => onChange(def.name, e.target.value)}
        className={`mt-2 w-full rounded-md border bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none read-only:bg-slate-50 ${
          error ? 'border-rose-400' : 'border-slate-300'
        } ${def.kind === 'name' ? '' : 'font-mono'}`}
      />

      {suggestion ? (
        <div id={`${id}-evidence`} className="mt-3 space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <span className={`rounded px-1.5 py-0.5 font-semibold ${byAi ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
              {byAi ? 'AI' : 'Rules'}
            </span>
            <span className="text-slate-500">Confidence</span>
            <ConfidenceBar value={confidence} low={low} />
          </div>
          <blockquote className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-xs break-words text-amber-900">
            “{suggestion.evidence}”
          </blockquote>
        </div>
      ) : (
        !readOnly && <p className="mt-2 text-xs text-slate-500">No suggestion with evidence was found. Enter it from the document.</p>
      )}

      {error ? (
        <p id={`${id}-error`} className="mt-2 text-sm text-rose-700">
          {def.label} {error}
        </p>
      ) : (
        <p id={`${id}-help`} className="mt-2 text-xs text-slate-500">
          {normalized !== null ? (
            <>
              Recorded as <span className="font-semibold text-slate-700">{displayFieldValue(def.kind, normalized)}</span>
              {normalized !== value && (
                <>
                  {' '}
                  · hashed as <span className="font-mono">{normalized}</span>
                </>
              )}
            </>
          ) : (
            FIELD_HELP[def.kind]
          )}
        </p>
      )}
    </div>
  );
}

const FIELD_PLACEHOLDERS = {
  name: 'e.g. Sameer Patil',
  id: 'e.g. BW-1042',
  month: 'e.g. March 2026',
  date: 'e.g. 31/03/2026',
  amount: 'e.g. 50,000',
};

const FIELD_HELP = {
  name: 'Stored in capitals with single spaces.',
  id: 'Stored in capitals without spaces.',
  month: 'Month and year, e.g. March 2026 or 03/2026.',
  date: 'Day first, e.g. 31/03/2026, or 2026-03-31.',
  amount: 'In rupees; ₹, Rs, commas and /- are fine. Stored in paise.',
};

function ConfidenceBar({ value, low }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
        role="meter"
        aria-label="Suggestion confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={`h-full rounded-full ${low ? 'bg-amber-600' : 'bg-indigo-600'}`} style={{ width: `${percent}%` }} />
      </div>
      <span className={`font-semibold ${low ? 'text-amber-700' : 'text-slate-700'}`}>
        {percent}%{low ? ' · check this' : ''}
      </span>
    </>
  );
}

function ConfirmedPanel({ result }) {
  const { record, leaf, canonical } = result;
  return (
    <Card title="Metadata" aside={<StatusBadge status="pending" />}>
      <div className="space-y-4" role="status">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Confirmed</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            <span className="font-mono">{record.recordId}</span> is pending and will be sealed into the next batch
          </h2>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Type</dt>
          <dd>{docTypeLabel(record.docType)}</dd>
          <dt className="text-slate-500">Issuer</dt>
          <dd>{record.issuer}</dd>
          <dt className="text-slate-500">Date</dt>
          <dd>{record.date}</dd>
          {(record.fields ?? []).map((field) => (
            <Fragment key={field.name}>
              <dt className="text-slate-500">{field.label}</dt>
              <dd>
                {field.display}{' '}
                {field.display !== field.value && <span className="font-mono text-xs text-slate-500">({field.value})</span>}
              </dd>
            </Fragment>
          ))}
          <dt className="text-slate-500">Leaf</dt>
          <dd>
            <HashChip value={leaf} />
          </dd>
        </dl>
        {canonical && (
          <div>
            <p className="text-sm font-semibold text-slate-900">Canonical record that was hashed</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs break-all whitespace-pre-wrap text-slate-100">{canonical}</pre>
            <p className="mt-1 text-xs text-slate-500">leaf = SHA-256(0x00 ‖ this text)</p>
          </div>
        )}
        <div className="flex gap-3">
          <Link to="/" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            Upload another
          </Link>
          <Link to="/records" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            View records
          </Link>
        </div>
      </div>
    </Card>
  );
}
