// Owner: Neel | Tamper demo page: test insider attacks (file corrupt, DB edit, restore) and show audit/verifier effects
import { useState, useEffect } from 'react';
import { tamper } from '../api/registry.js';
import { list as listRecords } from '../api/documents.js';
import { Card, Badge, Button, Alert, Spinner } from '../components/ui/index.js';
import { Link } from 'react-router-dom';

export default function Tamper() {
  const [records, setRecords] = useState([]);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [tampering, setTampering] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAnchoredRecords();
  }, []);

  async function loadAnchoredRecords() {
    setLoadingRecords(true);
    try {
      const all = await listRecords({ status: 'anchored' });
      setRecords(all || []);
      if (all && all.length > 0) {
        setSelectedRecordId(all[0].record_id || all[0].recordId);
      }
    } catch {
      // Fallback
    } finally {
      setLoadingRecords(false);
    }
  }

  async function handleTamper(type) {
    if (!selectedRecordId) return;
    setTampering(true);
    setError(null);
    try {
      const res = await tamper({ type, recordId: selectedRecordId });
      setLastResult({
        type,
        recordId: selectedRecordId,
        timestamp: new Date(),
        detail: res.detail || res,
      });
    } catch (err) {
      setError(err.message || 'Tamper action failed');
    } finally {
      setTampering(false);
    }
  }

  const selectedRecord = records.find(
    (r) => (r.record_id || r.recordId) === selectedRecordId,
  );

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Tamper Demo Panel
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Break the registry on purpose, then demonstrate that the audit and the independent verifier
          reliably detect the attack.
        </p>
      </div>

      {/* Warning Notice */}
      <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 text-xs sm:text-sm">
        <svg
          className="w-5 h-5 text-amber-700 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          <strong>Demo environment only.</strong> Every modification is recorded in the activity log
          and can be reversed with Restore.
        </span>
      </div>

      {error && (
        <Alert
          variant="error"
          title="Action Failed"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Target Record Selector */}
      <Card bodyClassName="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[280px] space-y-1.5">
            <label htmlFor="target-record" className="text-xs font-semibold text-slate-700">
              Select Target Anchored Record
            </label>
            {loadingRecords ? (
              <div className="h-10 flex items-center gap-2 text-xs text-slate-500">
                <Spinner size="sm" /> Loading records...
              </div>
            ) : records.length === 0 ? (
              <div className="text-xs text-slate-500 italic">
                No anchored records available. Seal a batch first.
              </div>
            ) : (
              <select
                id="target-record"
                value={selectedRecordId}
                onChange={(e) => setSelectedRecordId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                {records.map((r) => {
                  const id = r.record_id || r.recordId;
                  const name = r.file_name || r.fileName;
                  const batch = r.batch_id || r.batchId;
                  return (
                    <option key={id} value={id}>
                      {id} · {name} · {batch}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {selectedRecord && (
            <div className="flex items-center gap-3 text-xs text-slate-600 pb-2">
              <Badge status="anchored">anchored</Badge>
              <span>
                Issuer: <strong className="text-slate-800">{selectedRecord.issuer || '—'}</strong>
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* Tamper Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Action 1: Edit DB metadata */}
        <Card bodyClassName="p-5 flex flex-col justify-between h-full">
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900">Edit Issuer in Database</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Simulates a malicious DB administrator quietly altering metadata on an anchored record.
            </p>
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-slate-800">Expected Effect:</div>
              <div>• Audit detects DB root ≠ on-chain root (MISMATCH).</div>
              <div>• Independent verifier rejects forged proofs.</div>
            </div>
          </div>
          <div className="pt-4">
            <Button
              variant="danger"
              size="md"
              loading={tampering}
              disabled={!selectedRecordId}
              onClick={() => handleTamper('db_metadata')}
              className="w-full"
            >
              Edit Issuer
            </Button>
          </div>
        </Card>

        {/* Action 2: Corrupt stored file */}
        <Card bodyClassName="p-5 flex flex-col justify-between h-full">
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900">Flip a Byte in Stored File</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Simulates silent bit rot or tampering of the raw file stored on disk.
            </p>
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-slate-800">Expected Effect:</div>
              <div>• Audit lists the record under changed files.</div>
              <div>• Verifier check 1 fails (DOCUMENT_MODIFIED).</div>
            </div>
          </div>
          <div className="pt-4">
            <Button
              variant="danger"
              size="md"
              loading={tampering}
              disabled={!selectedRecordId}
              onClick={() => handleTamper('stored_file')}
              className="w-full"
            >
              Flip File Byte
            </Button>
          </div>
        </Card>

        {/* Action 3: Restore change */}
        <Card bodyClassName="p-5 flex flex-col justify-between h-full">
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900">Restore Original State</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Undoes the tamper modification, restoring genuine DB metadata and stored file bytes.
            </p>
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-slate-800">Expected Effect:</div>
              <div>• Next audit re-establishes clean OK status.</div>
              <div>• All cryptographic checks turn green again.</div>
            </div>
          </div>
          <div className="pt-4">
            <Button
              variant="secondary"
              size="md"
              loading={tampering}
              disabled={!selectedRecordId}
              onClick={() => handleTamper('restore')}
              className="w-full"
            >
              Restore Record
            </Button>
          </div>
        </Card>
      </div>

      {/* Results and Demo Script Order */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Last Result Card */}
        <div className="lg:col-span-7">
          <Card
            title="Last Tamper Result"
            subtitle={lastResult ? `Recorded at ${lastResult.timestamp.toLocaleTimeString()}` : ''}
          >
            {lastResult ? (
              <div className="space-y-4 text-xs sm:text-sm">
                <div className="flex items-center gap-2">
                  <Badge status="fail">TAMPER ACTION</Badge>
                  <span className="font-mono font-bold text-slate-900">
                    {lastResult.type} · {lastResult.recordId}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono text-xs text-slate-800 overflow-x-auto">
                  {typeof lastResult.detail === 'object'
                    ? JSON.stringify(lastResult.detail, null, 2)
                    : String(lastResult.detail)}
                </div>

                <div className="flex items-center gap-4 pt-1">
                  <Link
                    to="/audit"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    Run the audit to inspect root mismatch →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">
                No tamper actions executed in this session yet.
              </div>
            )}
          </Card>
        </div>

        {/* Demo Script Walkthrough Card */}
        <div className="lg:col-span-5">
          <Card title="Hackathon Demo Script Order">
            <ol className="list-decimal list-inside space-y-2.5 text-xs text-slate-700 leading-relaxed">
              <li>
                <span className="font-semibold text-slate-900">Genuine slip:</span> drop original PDF + proof →{' '}
                <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-1 rounded">
                  VALID
                </span>
              </li>
              <li>
                <span className="font-semibold text-slate-900">Edited file:</span> salary 50k → 80k with same proof →{' '}
                <span className="font-mono font-bold text-rose-700 bg-rose-50 px-1 rounded">
                  DOCUMENT_MODIFIED
                </span>
              </li>
              <li>
                <span className="font-semibold text-slate-900">Forged proof:</span> attacker rebuilt proof.json →{' '}
                <span className="font-mono font-bold text-rose-700 bg-rose-50 px-1 rounded">
                  ROOT_MISMATCH
                </span>
              </li>
              <li>
                <span className="font-semibold text-slate-900">Insider attack:</span> edit issuer in DB → Audit flags{' '}
                <span className="font-mono font-bold text-rose-700 bg-rose-50 px-1 rounded">
                  MISMATCH
                </span>
              </li>
              <li>
                <span className="font-semibold text-slate-900">Restore:</span> revert tamper → Audit turns{' '}
                <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-1 rounded">
                  OK
                </span>
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
