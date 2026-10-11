// Owner: Neel | Audit page: recomputes DB batch roots vs on-chain roots + audit activity log
import { useState, useEffect } from 'react';
import { runAudit, getAuditLog } from '../api/registry.js';
import { Card, Badge, Button, Hash, Spinner, Alert } from '../components/ui/index.js';

export default function Audit() {
  const [auditResult, setAuditResult] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [auditing, setAuditing] = useState(false);
  const [loadingLog, setLoadingLog] = useState(true);
  const [error, setError] = useState(null);
  const [lastRun, setLastRun] = useState(null);

  useEffect(() => {
    loadLog();
  }, []);

  async function loadLog() {
    setLoadingLog(true);
    try {
      const logs = await getAuditLog();
      setAuditLog(logs || []);
    } catch {
      // Ignore initial log load error
    } finally {
      setLoadingLog(false);
    }
  }

  async function handleRunAudit() {
    setAuditing(true);
    setError(null);
    try {
      const res = await runAudit();
      setAuditResult(res);
      setLastRun(new Date());
      await loadLog();
    } catch (err) {
      setError(err.message || 'Audit execution failed');
    } finally {
      setAuditing(false);
    }
  }

  const batches = auditResult?.batches || [];
  const onChainOnly = auditResult?.onChainOnly || [];
  const mismatchBatches = batches.filter((b) => b.status === 'MISMATCH');
  const hasRun = auditResult !== null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Integrity Audit
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Recomputes every batch root from the database and compares it with the immutable root
            on-chain.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRun && (
            <span className="text-xs text-slate-500 font-mono">
              Last checked: {lastRun.toLocaleTimeString()}
            </span>
          )}
          <Button variant="primary" loading={auditing} onClick={handleRunAudit}>
            <svg
              className="w-4 h-4 mr-1.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Run audit
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Audit Error" message={error} onClose={() => setError(null)} />
      )}

      {/* Mismatch Alert Banner */}
      {hasRun && mismatchBatches.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950 flex items-start gap-3.5 shadow-xs">
          <svg
            className="w-6 h-6 text-rose-600 shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-base text-rose-900">
              {mismatchBatches.length} of {batches.length} batch roots do not match the blockchain
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-rose-800 leading-relaxed">
              A database record or stored file was modified after publishing. The on-chain root is
              untouched, so the independent verifier will catch any forged document.
            </p>
          </div>
        </div>
      )}

      {/* Clean Match Alert Banner */}
      {hasRun && mismatchBatches.length === 0 && batches.length > 0 && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950 flex items-start gap-3.5 shadow-xs">
          <svg
            className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-base text-emerald-900">
              All {batches.length} batches match their published on-chain roots
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-emerald-800 leading-relaxed">
              Every record in SQLite hashes precisely to the Merkle root stored in the RootRegistry
              contract.
            </p>
          </div>
        </div>
      )}

      {/* Batch Comparison Card */}
      <Card
        title="Batch Root Verification"
        subtitle="Comparing local recomputed Merkle roots against RootRegistry.sol"
        bodyClassName="p-0 overflow-x-auto"
      >
        {!hasRun ? (
          <div className="p-8 text-center text-xs sm:text-sm text-slate-500">
            Click <strong className="text-slate-800">"Run audit"</strong> above to recompute all
            Merkle trees and check against the chain.
          </div>
        ) : batches.length === 0 ? (
          <div className="p-8 text-center text-xs sm:text-sm text-slate-500">
            No anchored batches exist yet to audit.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="px-4 py-3">Batch ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recomputed DB Root</th>
                <th className="px-4 py-3">On-Chain Root</th>
                <th className="px-4 py-3">Changed Records</th>
                <th className="px-4 py-3">Changed Files</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => {
                const isMismatch = b.status === 'MISMATCH';
                return (
                  <tr
                    key={b.batchId}
                    className={`transition-colors ${isMismatch ? 'bg-rose-50/50' : 'hover:bg-slate-50/60'}`}
                  >
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">{b.batchId}</td>
                    <td className="px-4 py-3">
                      <Badge status={b.status}>{b.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Hash value={b.dbRoot} truncate leadingChars={8} trailingChars={6} />
                    </td>
                    <td className="px-4 py-3">
                      <Hash value={b.chainRoot} truncate leadingChars={8} trailingChars={6} />
                    </td>
                    <td className="px-4 py-3">
                      {b.changedRecords && b.changedRecords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {b.changedRecords.map((rec) => (
                            <span
                              key={rec}
                              className="font-mono text-xs font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded"
                            >
                              {rec}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-emerald-700 font-semibold">None (clean)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {b.changedFiles && b.changedFiles.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {b.changedFiles.map((rec) => (
                            <span
                              key={rec}
                              className="inline-flex items-center gap-1 text-xs text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded"
                            >
                              <span className="font-mono font-bold">{rec}</span>
                              file changed
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-emerald-700 font-semibold">None (intact)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {hasRun && (
        <p className="text-xs sm:text-sm text-slate-600">
          On-chain batches missing from the database:{' '}
          {onChainOnly.length > 0 ? (
            <span className="font-mono font-bold text-rose-700">{onChainOnly.join(', ')}</span>
          ) : (
            'none'
          )}
          .
        </p>
      )}

      {/* Audit Activity Log */}
      <Card
        title="Registry Audit Log"
        subtitle="Chronological log of actor operations from SQLite audit_log"
        bodyClassName="p-0 overflow-x-auto"
      >
        {loadingLog ? (
          <div className="flex justify-center p-8">
            <Spinner size="md" />
          </div>
        ) : auditLog.length === 0 ? (
          <div className="p-8 text-center text-xs sm:text-sm text-slate-500">
            No activity log entries recorded yet.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {auditLog.map((log, lIdx) => (
                <tr key={log.id || lIdx} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                    {new Date(log.ts).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{log.actor || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">{log.target || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`font-semibold text-xs ${
                        log.outcome === 'OK' || log.outcome === 'pass'
                          ? 'text-emerald-700'
                          : log.outcome === 'FAIL' || log.outcome === 'TAMPERED'
                            ? 'text-rose-700'
                            : 'text-slate-600'
                      }`}
                    >
                      {log.outcome || '—'}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 max-w-[280px] truncate text-slate-600"
                    title={log.detail}
                  >
                    {log.detail || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
