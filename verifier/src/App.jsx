// Owner: Neel | Independent Verifier app: drop zones, on-chain lookup, 8 checks, field diff, Merkle path, verdict banner
import { useState, useEffect } from 'react';
import {
  verify,
  nodeHash,
  BATCH_ID,
  displayFieldValue,
  fieldDefinition,
} from '@proofchain/core';
import { getBatch, getBlockNumber } from './chain.js';
import { PINNED } from './config.js';
import Button from './components/ui/Button.jsx';
import Card from './components/ui/Card.jsx';
import FileDrop from './components/ui/FileDrop.jsx';
import Hash from './components/ui/Hash.jsx';
import Alert from './components/ui/Alert.jsx';
import Spinner from './components/ui/Spinner.jsx';

const POLL_INTERVAL_MS = 6000;

const EXPLANATIONS = {
  VALID: (b) =>
    `This exact file, with these confirmed details, was registered in ${b || 'the batch'}. The root computed from the file equals the root published on-chain.`,
  DOCUMENT_MODIFIED: () =>
    'The uploaded document has been modified. Its cryptographic SHA-256 hash does not match the fileHash recorded in the proof.',
  METADATA_MODIFIED: () =>
    'The metadata in the proof was altered. Rebuilding the leaf with the confirmed details produces a different hash than the leaf in the proof.',
  PROOF_INVALID: (b, failedId) =>
    failedId === '2b'
      ? 'The field values in the proof were altered. They no longer rebuild the fieldsRoot that the record committed to.'
      : 'The Merkle path in the proof is corrupt or forged. Folding the sibling hashes from the leaf does not reach the root claimed in the proof.',
  BATCH_NOT_PUBLISHED: (b) =>
    `Batch ${b || ''} has not been published or sealed on the blockchain contract. No published root exists.`,
  ROOT_MISMATCH: (b) =>
    `The proof agrees with itself, but its root does not match the Merkle root anchored on-chain for ${b || 'this batch'}. The document or proof was rebuilt to match.`,
  REGISTRY_MISMATCH: () =>
    'Registry mismatch. This proof was issued for a different contract address or blockchain network than this verifier is pinned to.',
  FORMAT_INVALID: () =>
    'The proof.json file is malformed, missing required fields, or uses an unsupported scheme format.',
};

function useChainStatus() {
  const [status, setStatus] = useState({ state: 'checking', blockNumber: null });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const blockNumber = await getBlockNumber();
        if (!cancelled) setStatus({ state: 'up', blockNumber });
      } catch {
        if (!cancelled) setStatus({ state: 'down', blockNumber: null });
      }
    }
    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return status;
}

/** Compute step-by-step nodes along the Merkle folding path for visualization */
function computePathSteps(computedLeaf, proof) {
  // Display only: a hashing error here must never turn into a verification error
  try {
    if (!computedLeaf || !proof || !Array.isArray(proof.siblings)) return [];
    const steps = [];
    let currentHash = computedLeaf.toLowerCase();

    for (let i = 0; i < proof.siblings.length; i++) {
      const sib = proof.siblings[i];
      const isLeft = sib.pos === 'left';
      const nextHash = isLeft ? nodeHash(sib.hash, currentHash) : nodeHash(currentHash, sib.hash);

      steps.push({
        level: i + 1,
        currentHash,
        siblingHash: sib.hash,
        pos: sib.pos,
        nextHash,
      });
      currentHash = nextHash;
    }
    return steps;
  } catch {
    return [];
  }
}

/**
 * Split `value` around its first character that differs from `other`, for highlighting.
 * `diff` is '' when the strings are equal or `value` ends before they differ.
 */
function splitAtFirstDiff(value, other) {
  let i = 0;
  while (i < value.length && i < other.length && value[i] === other[i]) i++;
  return { before: value.slice(0, i), diff: value.slice(i, i + 1), after: value.slice(i + 1) };
}

/** A normalised field value as people read it ("5000000" -> "₹50,000"); "—" when absent. */
function fieldText(name, value) {
  if (value === null || value === undefined) return '—';
  const kind = fieldDefinition(name)?.kind;
  return kind ? displayFieldValue(kind, value) : value;
}

/** `value` with its first character that differs from `other` highlighted in rose. */
function DiffText({ value, other }) {
  const { before, diff, after } = splitAtFirstDiff(value, other);
  return (
    <>
      {before}
      {diff && <span className="bg-rose-200 text-rose-900 rounded-xs px-px">{diff}</span>}
      {after}
    </>
  );
}

/**
 * Values the record committed to (check 2b passed). They are registered values only when every
 * other check passed too, or when only the file hash failed; otherwise they are just claims.
 */
function RegisteredDetails({ result }) {
  const untrusted = result.checks.find((c) => c.id !== '1' && c.pass !== true);
  return (
    <Card title="Registered details" subtitle="Field values committed to by the record's fieldsRoot">
      {untrusted && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Not confirmed: check {untrusted.id} ({untrusted.name}) did not pass, so these are only the
          values this proof.json claims.
        </p>
      )}
      {result.registeredFields.length === 0 ? (
        <p className="text-sm text-slate-500">No document fields are registered for this type.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {result.registeredFields.map((field) => (
            <div key={field.name} className="contents">
              <dt className="text-slate-500 font-medium">{field.label}</dt>
              <dd className="text-slate-900 font-semibold">
                {field.display}
                {field.display !== field.value && (
                  <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                    {field.value}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

const STATUS_STYLES = {
  match: { row: '', badge: 'bg-emerald-100 text-emerald-800', label: 'match' },
  changed: { row: 'bg-rose-50', badge: 'bg-rose-100 text-rose-800', label: 'changed' },
  unreadable: { row: 'bg-slate-50 text-slate-500', badge: 'bg-slate-200 text-slate-600', label: 'unreadable' },
};

/** DOCUMENT_MODIFIED explained field by field. Never a verdict: the file hash decides. */
function WhatChanged({ fieldDiff }) {
  return (
    <Card
      title="What changed"
      subtitle="Registered field values compared with the text of this document"
      className="mb-8"
    >
      {fieldDiff.available ? (
        <div className="-mx-5 -mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Field</th>
                <th className="px-5 py-2.5 font-semibold">Registered</th>
                <th className="px-5 py-2.5 font-semibold">In this document</th>
                <th className="px-5 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fieldDiff.fields.map((row) => {
                const style = STATUS_STYLES[row.status];
                return (
                  <tr key={row.name} className={style.row}>
                    <td className="px-5 py-2.5 font-medium text-slate-900">{row.label}</td>
                    <td className="px-5 py-2.5">{fieldText(row.name, row.registered)}</td>
                    <td
                      className={`px-5 py-2.5 ${row.status === 'changed' ? 'font-semibold text-rose-800' : ''}`}
                    >
                      {row.status === 'unreadable' ? 'could not read' : fieldText(row.name, row.found)}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${style.badge}`}>
                        {style.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {fieldDiff.note && (
            <p className="mx-5 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {fieldDiff.note}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No field comparison: {fieldDiff.reason}.</p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Explanation only — the verdict comes from the file hash.
      </p>
    </Card>
  );
}

export default function App() {
  const chain = useChainStatus();

  const [docFile, setDocFile] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [verificationError, setVerificationError] = useState(null);

  // Auto-verify when both files are selected
  useEffect(() => {
    if (docFile && proofFile) {
      handleVerify();
    }
  }, [docFile, proofFile]);

  async function handleVerify() {
    if (!docFile || !proofFile) return;
    setIsVerifying(true);
    setVerificationError(null);

    try {
      // 1. Read document raw bytes
      const fileBuffer = await docFile.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);

      // 2. Parse proof.json
      const proofText = await proofFile.text();
      let proof;
      try {
        proof = JSON.parse(proofText);
      } catch (err) {
        proof = null;
      }

      // 3. Fetch on-chain batch from the pinned contract. A malformed batchId is left to check 0.
      // null means "unpublished", so a chain error must stop here instead of becoming null.
      let chainBatch = null;
      if (typeof proof?.batchId === 'string' && BATCH_ID.test(proof.batchId)) {
        try {
          chainBatch = await getBatch(proof.batchId);
        } catch (err) {
          console.error('Chain read failed:', err);
          setVerificationResult(null);
          setVerificationError({
            title: `Chain unreachable: cannot read the published root for ${proof.batchId}`,
            message: `No verdict without the on-chain root. Check that the chain at ${PINNED.rpcUrl} is running, then verify again.`,
          });
          return;
        }
      }

      // 4. Text of a PDF's text layer, only to explain a DOCUMENT_MODIFIED field by field (v2
      // proofs). Read in this browser; it never changes the verdict. A .txt is read by core itself.
      // pdf.js is loaded on demand: it is most of the bundle and only v2 proofs need it.
      const fileText = Array.isArray(proof?.fields)
        ? await import('./pdfText.js').then(({ readPdfText }) => readPdfText(fileBytes))
        : null;

      // 5. Run pure cryptographic verification via @proofchain/core
      const result = verify({
        fileBytes,
        proof,
        chainBatch,
        pinned: PINNED,
        fileText,
      });

      // 6. Path steps and proof details only for a well-formed proof (check 0 passed); a
      // malformed proof's fields are never rendered, so it always ends as FORMAT_INVALID
      const formatOk = result.checks.find((c) => c.id === '0')?.pass === true;
      const pathSteps = formatOk
        ? computePathSteps(result.computed?.leaf || proof.leaf, proof)
        : [];

      setVerificationResult({
        ...result,
        proof: formatOk ? proof : null,
        chainBatch,
        pathSteps,
      });
    } catch (err) {
      console.error('Verification error:', err);
      setVerificationError({
        title: 'Verification Failed to Execute',
        message: err.message || 'An unexpected verification error occurred',
      });
    } finally {
      setIsVerifying(false);
    }
  }

  function handleClear() {
    setDocFile(null);
    setProofFile(null);
    setVerificationResult(null);
    setVerificationError(null);
  }

  const result = verificationResult;
  const isPassed = result?.verdict === 'VALID';
  const passedCount = result?.checks?.filter((c) => c.pass === true).length || 0;
  const totalChecks = result?.checks?.length || 8;
  const failedCheck = result?.checks?.find((c) => c.pass === false);

  const explanation = result?.verdict
    ? (EXPLANATIONS[result.verdict] || (() => ''))(result.proof?.batchId, failedCheck?.id)
    : '';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Top Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
              PC
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="font-bold text-base sm:text-lg tracking-tight">ProofChain</span>
              <span className="text-xs sm:text-sm text-slate-400 border-l border-slate-700 pl-2.5">
                Independent Verifier
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Pinned:</span>
              <span className="font-mono text-white text-xs bg-slate-800 px-1.5 py-0.5 rounded">
                {PINNED.contract.slice(0, 6)}…{PINNED.contract.slice(-4)}
              </span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-slate-300 text-xs">Chain {PINNED.chainId}</span>
            </div>

            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                chain.state === 'up'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : chain.state === 'down'
                    ? 'bg-rose-950 text-rose-300 border border-rose-800'
                    : 'bg-slate-800 text-slate-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  chain.state === 'up'
                    ? 'bg-emerald-400 animate-pulse'
                    : chain.state === 'down'
                      ? 'bg-rose-400'
                      : 'bg-slate-400'
                }`}
              />
              {chain.state === 'up'
                ? `Chain connected (block ${chain.blockNumber})`
                : chain.state === 'down'
                  ? 'Chain offline (8545)'
                  : 'Connecting...'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Intro */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Verify a Document
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
            Drop the document and its{' '}
            <code className="text-xs bg-slate-200/80 px-1 py-0.5 rounded font-mono">
              proof.json
            </code>
            . The Merkle root is read straight from the write-once blockchain contract; this app
            never contacts the registry database.
          </p>
        </div>

        {/* Drop Zones */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-stretch mb-8">
          <FileDrop
            label="Document"
            file={docFile}
            onFileSelect={setDocFile}
            accept=".pdf,.png,.jpg,.jpeg,.txt"
            hint="Original or suspect document file"
          />

          <FileDrop
            label="Proof Receipt"
            file={proofFile}
            onFileSelect={setProofFile}
            accept=".json,application/json"
            hint="proof.json issued at registration"
          />

          <div className="flex md:flex-col gap-2 justify-center">
            <Button
              variant="primary"
              loading={isVerifying}
              disabled={!docFile || !proofFile}
              onClick={handleVerify}
              className="flex-1 md:flex-none min-w-[100px]"
            >
              Verify
            </Button>
            <Button
              variant="secondary"
              disabled={!docFile && !proofFile && !result}
              onClick={handleClear}
              className="flex-1 md:flex-none"
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Verification Error */}
        {verificationError && (
          <Alert
            variant="error"
            title={verificationError.title}
            message={verificationError.message}
            className="mb-8"
          />
        )}

        {/* Verdict Banner */}
        {result && (
          <section
            aria-labelledby="verdict-banner-title"
            className={`rounded-2xl p-6 sm:p-7 text-white mb-8 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-5 transition-all ${
              isPassed
                ? 'bg-emerald-700 border border-emerald-600'
                : 'bg-rose-700 border border-rose-600'
            }`}
          >
            <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              {isPassed ? (
                <svg
                  className="w-8 h-8 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              ) : (
                <svg
                  className="w-8 h-8 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2
                  id="verdict-banner-title"
                  className="text-2xl sm:text-3xl font-black font-mono tracking-tight"
                >
                  {result.verdict}
                </h2>
                <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-white/20">
                  {isPassed ? 'Cryptographically Verified' : 'Integrity Check Failed'}
                </span>
              </div>
              <p className="mt-1 text-sm sm:text-base text-white/95 leading-relaxed font-normal">
                {explanation}
              </p>
            </div>

            <div className="text-left sm:text-right shrink-0 text-xs sm:text-sm font-medium border-t sm:border-t-0 sm:border-l border-white/20 pt-3 sm:pt-0 sm:pl-5">
              <div className="text-white/90">
                {passedCount} of {totalChecks} checks passed
              </div>
              {!isPassed && failedCheck && (
                <div className="text-rose-100 font-semibold mt-0.5">
                  Failed: {failedCheck.id} {failedCheck.name}
                </div>
              )}
            </div>
          </section>
        )}

        {/* What changed: field-by-field explanation of a DOCUMENT_MODIFIED (v2 proofs) */}
        {result?.fieldDiff && <WhatChanged fieldDiff={result.fieldDiff} />}

        {/* Results Details Grid */}
        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: the checks */}
            <div className="lg:col-span-7">
              <Card
                title="Cryptographic Checks"
                subtitle="Every step recomputed synchronously in your browser"
                className="shadow-xs"
              >
                <ol className="divide-y divide-slate-100 -mx-5 -my-5">
                  {result.checks.map((check) => {
                    const isCheckPass = check.pass === true;
                    const isCheckFail = check.pass === false;
                    const isCheckSkipped = check.pass === null;

                    return (
                      <li
                        key={check.id}
                        className={`p-4 sm:p-5 transition-colors ${
                          isCheckFail ? 'bg-rose-50/40' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3.5">
                          {/* Pass/Fail Icon */}
                          <div className="shrink-0 mt-0.5">
                            {isCheckPass && (
                              <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                <svg
                                  className="w-3.5 h-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </span>
                            )}
                            {isCheckFail && (
                              <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center">
                                <svg
                                  className="w-3.5 h-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </span>
                            )}
                            {isCheckSkipped && (
                              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center font-mono text-xs font-bold">
                                -
                              </span>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-bold px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
                                {check.id}
                              </span>
                              <span className="font-semibold text-sm text-slate-900">
                                {check.name}
                              </span>
                              <span
                                className={`text-xs font-bold ml-auto uppercase tracking-wide ${
                                  isCheckPass
                                    ? 'text-emerald-700'
                                    : isCheckFail
                                      ? 'text-rose-700'
                                      : 'text-slate-400'
                                }`}
                              >
                                {isCheckPass ? 'passed' : isCheckFail ? 'failed' : 'skipped'}
                              </span>
                            </div>

                            <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                              {check.detail}
                            </p>

                            {/* Computed vs Expected Values */}
                            {(check.computed || check.expected) && (
                              <div className="mt-2.5 bg-slate-50 border border-slate-200/80 rounded-lg p-2.5 text-xs font-mono space-y-1.5 overflow-x-auto">
                                {check.computed && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-slate-500 font-sans text-[11px] w-16 uppercase font-semibold shrink-0">
                                      computed:
                                    </span>
                                    <span
                                      className={`break-all ${
                                        isCheckFail ? 'text-rose-800 font-bold' : 'text-slate-900'
                                      }`}
                                    >
                                      {isCheckFail && check.expected ? (
                                        <DiffText value={check.computed} other={check.expected} />
                                      ) : (
                                        check.computed
                                      )}
                                    </span>
                                  </div>
                                )}
                                {check.expected && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-slate-500 font-sans text-[11px] w-16 uppercase font-semibold shrink-0">
                                      expected:
                                    </span>
                                    <span className="text-slate-900 break-all">
                                      {isCheckFail && check.computed ? (
                                        <DiffText value={check.expected} other={check.computed} />
                                      ) : (
                                        check.expected
                                      )}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </div>

            {/* Right Column: Registered Details, Merkle Path & Proof Details */}
            <div className="lg:col-span-5 space-y-6">
              {result.registeredFields && <RegisteredDetails result={result} />}

              {/* Merkle Path Visualization */}
              <Card title="Merkle Path" subtitle="Folded from the file upward to the root">
                <div className="space-y-2 text-xs">
                  {/* On-chain Root */}
                  <div
                    className={`rounded-lg p-3 border-2 transition-all ${
                      isPassed
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950'
                        : 'border-slate-300 bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                      On-chain root (RootRegistry.sol)
                    </div>
                    <div className="font-mono text-xs font-bold mt-1 break-all">
                      {result.chainBatch?.root || 'Unpublished / not found'}
                    </div>
                  </div>

                  {/* Root comparison indicator */}
                  <div className="flex items-center justify-center gap-1.5 text-xs font-bold py-1">
                    {result.computed?.root && result.chainBatch?.root ? (
                      result.computed.root.toLowerCase() ===
                      result.chainBatch.root.toLowerCase() ? (
                        <span className="text-emerald-700 flex items-center gap-1">
                          <svg
                            className="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Matches On-Chain Root
                        </span>
                      ) : (
                        <span className="text-rose-700 flex items-center gap-1">
                          <svg
                            className="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                          Root Mismatch
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">↑ Folded tree</span>
                    )}
                  </div>

                  {/* Computed Root */}
                  {result.computed?.root && (
                    <div className="rounded-lg p-2.5 bg-slate-100 border border-slate-200">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Computed Root
                      </div>
                      <div className="font-mono text-xs mt-0.5 break-all text-slate-900">
                        {result.computed.root}
                      </div>
                    </div>
                  )}

                  {/* Siblings Path */}
                  {result.proof?.siblings && result.proof.siblings.length > 0 && (
                    <div className="space-y-1.5 pl-2 border-l-2 border-slate-200 my-2">
                      {result.proof.siblings.map((sib, sIdx) => (
                        <div
                          key={sIdx}
                          className="rounded bg-slate-50 border border-slate-200 p-2 text-slate-700"
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase">
                            <span>Level {sIdx + 1} Sibling</span>
                            <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">
                              {sib.pos} side
                            </span>
                          </div>
                          <div className="font-mono text-xs mt-0.5 break-all text-slate-800">
                            {sib.hash}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Leaf */}
                  <div className="rounded-lg p-2.5 bg-slate-100 border border-slate-200">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Leaf = SHA-256(0x00 ‖ canonicalJSON(record))
                    </div>
                    <div className="font-mono text-xs mt-0.5 break-all text-slate-900">
                      {result.computed?.leaf || result.proof?.leaf || '—'}
                    </div>
                  </div>

                  {/* fieldsRoot: the record's commitment to its field values (v2) */}
                  {result.proof?.fieldsRoot && (
                    <div className="rounded-lg p-2.5 bg-slate-50 border border-slate-200">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        fieldsRoot = root of {result.proof.fields.length} salted field leaves
                        (0x02 ‖ name, salt, value)
                      </div>
                      <div className="font-mono text-xs mt-0.5 break-all text-slate-900">
                        {result.proof.fieldsRoot}
                      </div>
                    </div>
                  )}

                  {/* File Hash */}
                  <div className="rounded-lg p-2.5 bg-slate-50 border border-slate-200">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      fileHash = SHA-256(uploaded bytes)
                    </div>
                    <div className="font-mono text-xs mt-0.5 break-all text-slate-900">
                      {result.computed?.fileHash || result.proof?.fileHash || '—'}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Confirmed Details In Proof */}
              {result.proof && (
                <Card title="Details In The Proof">
                  <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2.5 text-xs sm:text-sm">
                    <dt className="text-slate-500 font-medium">Record ID</dt>
                    <dd className="font-mono font-bold text-slate-900">
                      {result.proof.recordId || '—'}
                    </dd>

                    <dt className="text-slate-500 font-medium">Doc Type</dt>
                    <dd className="font-medium text-slate-900">
                      {result.proof.metadata?.docType || '—'}
                    </dd>

                    <dt className="text-slate-500 font-medium">Issuer</dt>
                    <dd className="text-slate-900">{result.proof.metadata?.issuer || '—'}</dd>

                    <dt className="text-slate-500 font-medium">Date</dt>
                    <dd className="font-mono text-slate-900">
                      {result.proof.metadata?.date || '—'}
                    </dd>

                    <dt className="text-slate-500 font-medium">Batch</dt>
                    <dd className="font-mono text-slate-900">
                      {result.proof.batchId} (leaf {result.proof.leafIndex + 1} of{' '}
                      {result.proof.leafCount})
                    </dd>

                    {result.proof.anchor && (
                      <>
                        <dt className="text-slate-500 font-medium">Anchor</dt>
                        <dd className="font-mono text-xs text-slate-700">
                          Block {result.proof.anchor.blockNumber} · tx{' '}
                          {result.proof.anchor.txHash?.slice(0, 10)}…
                        </dd>
                      </>
                    )}
                  </dl>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Footer Disclaimer */}
        <footer className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-500 flex flex-wrap justify-between items-center gap-4">
          <p>
            Verification proves that this exact file, with these confirmed details, was registered
            in this batch. It does not prove that the contents are true or who wrote the document.
          </p>
          <div className="font-mono text-slate-400">ProofChain v0.1.0</div>
        </footer>
      </main>
    </div>
  );
}
