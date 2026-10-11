// Owner: Mahendra | Upload page: pick a document, upload it, continue to the confirm screen
// Layout follows "ProofChain UI Screens" screen 1. Small local helpers (HashChip, icons) can be
// swapped for Neel's shared kit in web/src/components/ui/ once it lands.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getActor } from '../api/client.js';
import * as documents from '../api/documents.js';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = { '.pdf': 'PDF', '.png': 'PNG', '.jpg': 'JPG', '.jpeg': 'JPG', '.txt': 'TXT' };
const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain';
const TEXT_METHOD = {
  'pdf-text': 'PDF text layer (no OCR needed)',
  ocr: 'OCR (tesseract.js)',
  plain: 'plain text file',
};

const extensionOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

/** Same rules as the server, checked early so people don't wait for an upload that will fail. */
function checkFile(file) {
  if (!ACCEPTED[extensionOf(file.name)]) return 'Only PDF, PNG, JPG or TXT files are accepted.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_BYTES) return 'Files must be 10 MB or smaller.';
  return null;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Upload() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // upload response
  const [error, setError] = useState(null); // { code?, message }
  const [duplicate, setDuplicate] = useState(null); // { fileName, recordId, batchId, status }
  const drafts = useDrafts(result?.recordId);

  async function upload(picked) {
    setError(null);
    setDuplicate(null);
    setResult(null);
    const problem = checkFile(picked);
    if (problem) {
      setFile(null);
      setError({ code: 'UNSUPPORTED_TYPE', message: problem });
      return;
    }
    if (!getActor().trim()) {
      setError({ code: 'MISSING_ACTOR', message: 'Enter your name in "Acting as" (top right) first. It is recorded in the audit log.' });
      return;
    }
    setFile(picked);
    setUploading(true);
    try {
      setResult(await documents.upload(picked));
    } catch (err) {
      if (err.code === 'DUPLICATE') setDuplicate({ fileName: picked.name, ...err.details });
      else setError({ code: err.code, message: err.message });
      setFile(null);
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
    setDuplicate(null);
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold text-slate-900">Register a document</h1>
      <p className="mt-1 text-slate-600">
        Upload a file to fingerprint it. You confirm its details before it can be sealed into a batch.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Upload" aside="PDF, PNG, JPG or TXT · up to 10 MB">
            <DropZone disabled={uploading} onFile={upload} />
            {error && <ErrorAlert error={error} />}
          </Panel>

          {(uploading || result) && (
            <Processing
              file={file}
              result={result}
              uploading={uploading}
              onReview={() => navigate(`/confirm/${encodeURIComponent(result.recordId)}`, { state: { upload: result } })}
              onReset={reset}
            />
          )}
        </div>

        <aside className="space-y-4">
          <AwaitingConfirmation drafts={drafts} />
          {duplicate && <DuplicateAlert duplicate={duplicate} />}
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <span className="font-semibold text-slate-900">What gets hashed:</span> the file's exact bytes and the details
            you confirm. OCR text and AI suggestions are never hashed.
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Drafts waiting for a person to confirm them; refreshed after each upload. */
function useDrafts(refreshKey) {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const load = useCallback(() => {
    let cancelled = false;
    documents
      .list({ status: 'draft' })
      .then((items) => !cancelled && setState({ loading: false, items: items.slice().reverse(), error: null }))
      .catch((err) => !cancelled && setState({ loading: false, items: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(load, [load, refreshKey]);
  return state;
}

function Panel({ title, aside, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {aside && <div className="text-xs text-slate-500">{aside}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function DropZone({ disabled, onFile }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  return (
    <label
      htmlFor="document-file"
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const picked = event.dataTransfer.files?.[0];
        if (picked && !disabled) onFile(picked);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
        dragging ? 'border-indigo-500 bg-indigo-100' : 'border-indigo-300 bg-indigo-50/60 hover:border-indigo-400'
      } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <UploadIcon />
      <span className="mt-3 font-semibold text-slate-900">
        Drop a file here, or <span className="text-indigo-600 underline">browse</span>
      </span>
      <span className="mt-2 text-xs text-slate-500">
        The file is hashed with SHA-256 the moment it arrives. Its bytes are never changed.
      </span>
      <input
        id="document-file"
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = ''; // allow choosing the same file again
          if (picked) onFile(picked);
        }}
      />
    </label>
  );
}

function Processing({ file, result, uploading, onReview, onReset }) {
  const name = result?.fileName ?? file?.name ?? '';
  const kind = ACCEPTED[extensionOf(name)] ?? 'FILE';
  const done = Boolean(result);
  const byAi = result?.extractionPath === 'ai';
  const hasSuggestion = Boolean(result && ['docType', 'issuer', 'date'].some((f) => result.suggestions?.[f]));

  return (
    <Panel
      title="Processing"
      aside={
        result && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
            {result.recordId} · draft
          </span>
        )
      }
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-10 items-center justify-center rounded border border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-600">
          {kind}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">
            {file ? formatBytes(file.size) : ''}
            {result?.mime ? ` · ${result.mime}` : ''}
          </p>
        </div>
      </div>

      <ol className="mt-5 space-y-3 text-sm" aria-live="polite">
        <Step state={done ? 'done' : 'active'} title="Fingerprinted">
          {done ? (
            <>
              <HashChip value={result.fileHash} /> <span className="text-slate-500">SHA-256 of the exact file bytes</span>
            </>
          ) : (
            <span className="text-slate-500">hashing the exact bytes…</span>
          )}
        </Step>
        <Step state={done ? (result.textMethod ? 'done' : 'warn') : uploading ? 'active' : 'todo'} title="Text extracted">
          <span className="text-slate-500">
            {done
              ? result.textMethod
                ? `· ${TEXT_METHOD[result.textMethod] ?? result.textMethod}`
                : '· no text could be read; enter details manually'
              : '· PDF text layer, or OCR for images and scans (up to a minute)'}
          </span>
        </Step>
        <Step state={done ? (hasSuggestion ? 'done' : 'warn') : 'todo'} title="Metadata suggested">
          {done && <SourceTag ai={byAi} />}
          <span className="text-slate-500">
            {done && !hasSuggestion ? 'nothing found; you will fill the fields' : 'type, issuer and date, each with its source line'}
          </span>
        </Step>
        <Step state={done ? 'current' : 'todo'} title="Waiting for your confirmation">
          <span className="text-slate-500">· nothing is sealed until a person confirms</span>
        </Step>
      </ol>

      {result?.warnings?.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {done && (
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onReview}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Review and confirm
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Upload another
          </button>
        </div>
      )}
    </Panel>
  );
}

function Step({ state, title, children }) {
  return (
    <li className="flex items-start gap-3">
      <StepIcon state={state} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-semibold ${state === 'todo' ? 'text-slate-400' : 'text-slate-900'}`}>{title}</span>
        {children}
      </div>
    </li>
  );
}

function StepIcon({ state }) {
  if (state === 'done') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" />
        </svg>
        <span className="sr-only">done</span>
      </span>
    );
  }
  if (state === 'warn') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
        !<span className="sr-only">needs attention</span>
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600">
        <span className="sr-only">in progress</span>
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-indigo-600">
        <span className="h-2 w-2 rounded-full bg-indigo-600" />
        <span className="sr-only">next</span>
      </span>
    );
  }
  return <span className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-300" />;
}

function SourceTag({ ai }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        ai ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'
      }`}
    >
      {ai ? 'AI' : 'Rules'}
    </span>
  );
}

function AwaitingConfirmation({ drafts }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Awaiting confirmation</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{drafts.items.length}</span>
      </div>
      {drafts.loading ? (
        <p className="px-4 py-3 text-sm text-slate-500">Loading…</p>
      ) : drafts.error ? (
        <p className="px-4 py-3 text-sm text-rose-700">{drafts.error}</p>
      ) : drafts.items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">Nothing waiting. Uploaded files appear here until confirmed.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {drafts.items.map((draft) => (
            <li key={draft.recordId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-500">{draft.recordId}</p>
                <p className="truncate text-sm font-semibold text-slate-900">{draft.fileName}</p>
              </div>
              <Link to={`/confirm/${encodeURIComponent(draft.recordId)}`} className="text-sm font-medium text-indigo-600 underline hover:text-indigo-700">
                Review
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DuplicateAlert({ duplicate }) {
  const { fileName, recordId, batchId, status } = duplicate;
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <AlertIcon />
      <div>
        <p className="font-mono text-xs font-semibold tracking-wide">DUPLICATE</p>
        <p className="mt-1">
          {fileName} is already registered as <span className="font-mono">{recordId}</span>
          {batchId ? (
            <>
              {' '}in <span className="font-mono">{batchId}</span>.
            </>
          ) : (
            ' (not in a batch yet).'
          )}
        </p>
        {status === 'draft' && (
          <Link to={`/confirm/${encodeURIComponent(recordId)}`} className="mt-2 inline-block font-medium underline">
            Continue confirming {recordId}
          </Link>
        )}
      </div>
    </div>
  );
}

function ErrorAlert({ error }) {
  return (
    <div role="alert" className="mt-4 flex gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <AlertIcon />
      <div>
        {error.code && <p className="font-mono text-xs font-semibold tracking-wide">{error.code}</p>}
        <p>{error.message}</p>
      </div>
    </div>
  );
}

/** Middle-truncated hash with copy button (stand-in for the shared kit's Hash). */
export function HashChip({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const short = value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-800" title={value}>
      {short}
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {})}
        className="text-slate-500 hover:text-slate-900"
        aria-label={copied ? 'Copied' : `Copy ${value}`}
      >
        {copied ? (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="5" y="5" width="8" height="9" rx="1.5" />
            <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" />
          </svg>
        )}
      </button>
    </span>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v5M10 14v.01" strokeLinecap="round" />
    </svg>
  );
}
