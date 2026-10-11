// Owner: Mahendra | Upload page: pick a document, upload it, continue to the confirm screen
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getActor } from '../api/client.js';
import * as documents from '../api/documents.js';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = { '.pdf': 'PDF', '.png': 'PNG', '.jpg': 'JPG', '.jpeg': 'JPG', '.txt': 'TXT' };
const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain';

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/** Same rules as the server, checked early so people don't wait for an upload that will fail. */
function checkFile(file) {
  if (!ACCEPTED[extensionOf(file.name)]) return 'Only PDF, PNG, JPG or TXT files are accepted.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_BYTES) return 'Files must be 10 MB or smaller.';
  return null;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Upload() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);

  function choose(picked) {
    setError(null);
    setDuplicate(null);
    if (!picked) return;
    const problem = checkFile(picked);
    if (problem) {
      setFile(null);
      setError(problem);
      return;
    }
    setFile(picked);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (!uploading) choose(event.dataTransfer.files?.[0]);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!file || uploading) return;
    if (!getActor().trim()) {
      setError('Enter your name in "Acting as" at the top right first. It is recorded in the audit log.');
      return;
    }
    setUploading(true);
    setError(null);
    setDuplicate(null);
    try {
      const result = await documents.upload(file);
      navigate(`/confirm/${encodeURIComponent(result.recordId)}`, { state: { upload: result } });
    } catch (err) {
      if (err.code === 'DUPLICATE') setDuplicate(err.details ?? {});
      else setError(err.message);
      setUploading(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Upload document</h1>
      <p className="mt-2 text-slate-600">
        The exact file bytes are fingerprinted with SHA-256 the moment you upload. Text extraction and AI only
        suggest the issuer, type and date for you to check; they never enter a hash.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label
          htmlFor="document-file"
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragging ? 'border-slate-900 bg-slate-100' : 'border-slate-300 bg-white hover:border-slate-400'
          } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <span className="text-base font-medium text-slate-900">Drop a file here, or click to choose</span>
          <span className="mt-1 text-sm text-slate-500">PDF, PNG, JPG or TXT · up to 10 MB</span>
          <input
            id="document-file"
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => choose(event.target.files?.[0])}
          />
        </label>

        {file && (
          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">{file.name}</p>
              <p className="text-sm text-slate-500">
                {ACCEPTED[extensionOf(file.name)]} · {formatBytes(file.size)}
              </p>
            </div>
            {!uploading && (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="ml-4 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Remove
              </button>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {duplicate && <DuplicateNotice details={duplicate} />}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={!file || uploading}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {uploading ? 'Uploading…' : 'Upload and continue'}
          </button>
          {uploading && (
            <p aria-live="polite" className="text-sm text-slate-600">
              Hashing, reading the text and preparing suggestions. Scanned images can take up to a minute.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

function DuplicateNotice({ details }) {
  const { recordId, batchId, status } = details;
  return (
    <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">This exact file is already registered as {recordId}.</p>
      <p className="mt-1">
        {batchId ? `It is in batch ${batchId}.` : 'It is not in a batch yet.'} The same bytes always give the same
        fingerprint, so a file can only be registered once.
      </p>
      <p className="mt-2">
        {status === 'draft' ? (
          <Link to={`/confirm/${encodeURIComponent(recordId)}`} className="font-medium underline">
            Continue confirming {recordId}
          </Link>
        ) : (
          <Link to="/records" className="font-medium underline">
            View it in Records
          </Link>
        )}
      </p>
    </div>
  );
}
