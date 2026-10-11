// Owner: Mahendra | Confirm screen: review AI suggestions + evidence, edit, confirm metadata
import { DOC_TYPES, normText } from '@proofchain/core';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import * as documents from '../api/documents.js';

const ISSUER_MAX_CHARS = 120;
const FIELDS = ['docType', 'issuer', 'date'];
const FIELD_LABELS = { docType: 'Document type', issuer: 'Issuer', date: 'Issue date' };

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

/** Mirrors the server rules so mistakes show up before the request; the server stays the authority. */
function validate(values, today) {
  const errors = {};
  if (!DOC_TYPES.includes(values.docType)) errors.docType = 'Choose a document type.';
  const issuer = normText(values.issuer);
  if (!issuer) errors.issuer = 'Issuer is required.';
  else if ([...issuer].length > ISSUER_MAX_CHARS) errors.issuer = `At most ${ISSUER_MAX_CHARS} characters.`;
  if (!values.date) errors.date = 'Date is required.';
  else if (!isCalendarDate(values.date)) errors.date = 'Not a real date.';
  else if (values.date > today) errors.date = 'The date cannot be in the future.';
  return errors;
}

/** One shape for both sources: the upload response (router state) or a record from GET /api/documents. */
function toView(source) {
  const confirmed =
    source.status && source.status !== 'draft'
      ? { docType: source.docType, issuer: source.issuer, date: source.date, leaf: source.leaf, batchId: source.batchId }
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
        else setLoadError(`No record ${recordId}.`);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [recordId, view?.recordId]);

  // After navigating from one confirm URL to another, never show the previous record's form.
  const current = view?.recordId === recordId ? view : null;

  if (loadError) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Confirm metadata</h1>
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium underline">
          Upload a document
        </Link>
      </section>
    );
  }
  if (!current) return <p className="text-slate-600">Loading {recordId}…</p>;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Confirm metadata</h1>
        <p className="font-mono text-sm text-slate-600">{current.recordId}</p>
      </div>
      <p className="mt-2 max-w-3xl text-slate-600">
        Check each value against the document and correct anything wrong. Only the values you confirm go into the
        record's fingerprint (leaf); suggestions are never hashed.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <DocumentPreview view={current} />
        {/* key: a different record gets a fresh form */}
        <ConfirmForm key={current.recordId} view={current} />
      </div>
    </section>
  );
}

function DocumentPreview({ view }) {
  const url = documents.fileUrl(view.recordId);
  return (
    <div className="lg:sticky lg:top-6 lg:self-start">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-sm">
          <span className="truncate font-medium">{view.fileName ?? 'Document'}</span>
          <a href={url} target="_blank" rel="noreferrer" className="ml-4 shrink-0 text-slate-600 underline hover:text-slate-900">
            Open
          </a>
        </div>
        {view.mime?.startsWith('image/') ? (
          <img src={url} alt={`Uploaded document ${view.fileName ?? view.recordId}`} className="max-h-[70vh] w-full object-contain" />
        ) : (
          <iframe src={url} title={`Uploaded document ${view.fileName ?? view.recordId}`} className="h-[70vh] w-full" />
        )}
      </div>
      <dl className="mt-3 text-xs text-slate-500">
        <dt className="inline">File hash (SHA-256): </dt>
        <dd className="inline break-all font-mono">{view.fileHash}</dd>
      </dl>
    </div>
  );
}

function ConfirmForm({ view }) {
  const today = localToday();
  const suggestions = view.suggestions;
  const initial = view.confirmed ?? {
    docType: suggestions?.docType ?? '',
    issuer: suggestions?.issuer ?? '',
    date: suggestions?.date ?? '',
  };
  const [values, setValues] = useState({ docType: initial.docType ?? '', issuer: initial.issuer ?? '', date: initial.date ?? '' });
  const [errors, setErrors] = useState({});
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);
  const [anchored, setAnchored] = useState(view.status === 'anchored');

  if (result) return <ConfirmedPanel result={result} />;

  const readOnly = anchored || submitting;
  const setField = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    const found = validate(values, today);
    setErrors(found);
    setSubmitError(null);
    if (Object.keys(found).length > 0 || !checked) return;

    setSubmitting(true);
    try {
      setResult(await documents.confirm(view.recordId, values));
    } catch (err) {
      if (err.code === 'VALIDATION') setErrors(err.details?.fields ?? {});
      if (err.code === 'ALREADY_ANCHORED') setAnchored(true);
      setSubmitError(err.code === 'VALIDATION' ? 'The server rejected some fields. See the messages below.' : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <SourceBanner view={view} anchored={anchored} />

      {view.warnings.map((warning) => (
        <p key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {warning}
        </p>
      ))}

      <SuggestionField
        field="docType"
        suggestions={suggestions}
        value={values.docType}
        error={errors.docType}
        onUseSuggestion={setField}
        format={docTypeLabel}
      >
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
      </SuggestionField>

      <SuggestionField field="issuer" suggestions={suggestions} value={values.issuer} error={errors.issuer} onUseSuggestion={setField}>
        {(props) => (
          <input
            {...props}
            type="text"
            value={values.issuer}
            maxLength={ISSUER_MAX_CHARS + 20}
            readOnly={readOnly}
            placeholder="e.g. Pimpri Institute of Technology"
            onChange={(e) => setField('issuer', e.target.value)}
          />
        )}
      </SuggestionField>

      <SuggestionField field="date" suggestions={suggestions} value={values.date} error={errors.date} onUseSuggestion={setField}>
        {(props) => (
          <input {...props} type="date" value={values.date} max={today} readOnly={readOnly} onChange={(e) => setField('date', e.target.value)} />
        )}
      </SuggestionField>

      {!anchored && (
        <>
          <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4"
              disabled={submitting}
            />
            <span>
              I checked these details against the document. They will be locked into this record's fingerprint when
              the batch is sealed.
            </span>
          </label>

          {submitError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={!checked || submitting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? 'Confirming…' : view.status === 'pending' ? 'Update confirmed details' : 'Confirm and create record'}
          </button>
        </>
      )}
    </form>
  );
}

function SourceBanner({ view, anchored }) {
  if (anchored) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">
        This record is anchored in {view.confirmed?.batchId ?? 'a sealed batch'} and can no longer change.
      </p>
    );
  }
  if (view.status === 'pending') {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">
        Already confirmed. You can still correct it until the batch is sealed; that changes its leaf.
      </p>
    );
  }
  const byAi = view.extractionPath === 'ai';
  return (
    <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      <span className="font-medium">{byAi ? 'Suggested by AI (Gemini).' : 'Suggested by rules (AI off or unavailable).'}</span>{' '}
      Suggestions are advisory. You decide every value.
    </p>
  );
}

function SuggestionField({ field, suggestions, value, error, onUseSuggestion, format = (v) => v, children }) {
  const id = `field-${field}`;
  const suggested = suggestions?.[field] ?? null;
  const confidence = suggestions?.confidence?.[field] ?? 0;
  const evidence = suggestions?.evidence?.[field] ?? '';
  const edited = suggested !== null && value !== suggested && normText(value ?? '') !== suggested;
  const describedBy = [error && `${id}-error`, suggested && `${id}-evidence`].filter(Boolean).join(' ') || undefined;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-900">
          {FIELD_LABELS[field]}
        </label>
        {edited && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Edited</span>}
      </div>

      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        className: `mt-2 w-full rounded-md border px-3 py-2 text-slate-900 ${
          error ? 'border-red-400 bg-red-50' : 'border-slate-300'
        } read-only:bg-slate-50 disabled:bg-slate-50`,
      })}

      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}

      {suggested ? (
        <div id={`${id}-evidence`} className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-600">
              Suggested: <span className="font-medium text-slate-900">{format(suggested)}</span>
            </span>
            {edited && (
              <button type="button" onClick={() => onUseSuggestion(field, suggested)} className="text-sm font-medium text-slate-700 underline hover:text-slate-900">
                Use suggestion
              </button>
            )}
          </div>
          <ConfidenceMeter value={confidence} />
          <figure>
            <figcaption className="text-xs text-slate-500">Found in the document:</figcaption>
            <blockquote className="mt-1 rounded border-l-4 border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs break-words text-slate-800">
              {evidence}
            </blockquote>
          </figure>
        </div>
      ) : (
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-500">No suggestion found. Enter it from the document.</p>
      )}
    </div>
  );
}

function ConfidenceMeter({ value }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const level = value >= 0.75 ? 'High' : value >= 0.45 ? 'Medium' : 'Low';
  const bar = value >= 0.75 ? 'bg-emerald-600' : value >= 0.45 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 w-32 overflow-hidden rounded-full bg-slate-200"
        role="meter"
        aria-label="Suggestion confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={`h-full ${bar}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-slate-600">
        {level} confidence · {percent}%
      </span>
    </div>
  );
}

function ConfirmedPanel({ result }) {
  const { record, leaf, canonical } = result;
  const [copied, setCopied] = useState(false);

  async function copyLeaf() {
    try {
      await navigator.clipboard.writeText(leaf);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-emerald-200 bg-white p-5" role="status">
      <div>
        <p className="text-sm font-medium text-emerald-800">Confirmed · status pending</p>
        <h2 className="mt-1 text-lg font-semibold">
          {record.recordId} is ready to be sealed into the next batch
        </h2>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">Type</dt>
        <dd>{docTypeLabel(record.docType)}</dd>
        <dt className="text-slate-500">Issuer</dt>
        <dd>{record.issuer}</dd>
        <dt className="text-slate-500">Date</dt>
        <dd>{record.date}</dd>
        <dt className="text-slate-500">Leaf</dt>
        <dd className="flex items-start gap-2">
          <code className="font-mono text-xs break-all">{leaf}</code>
          <button type="button" onClick={copyLeaf} className="shrink-0 text-xs font-medium underline">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </dd>
      </dl>
      {canonical && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">What was hashed (canonical record)</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs">{canonical}</pre>
          <p className="mt-1 text-xs text-slate-500">leaf = SHA-256(0x00 ‖ this exact text)</p>
        </details>
      )}
      <div className="flex gap-4 text-sm font-medium">
        <Link to="/" className="underline">
          Upload another
        </Link>
        <Link to="/records" className="underline">
          View records
        </Link>
      </div>
    </div>
  );
}
