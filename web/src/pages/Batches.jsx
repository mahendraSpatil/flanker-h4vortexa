// Owner: Neel | Batches page: pending record seal panel + anchored batches list
import { useState, useEffect } from 'react';
import { listBatches, seal } from '../api/registry.js';
import { list as listRecords } from '../api/documents.js';
import { Card, Badge, Button, Hash, Spinner, Alert } from '../components/ui/index.js';

export default function Batches() {
  const [batches, setBatches] = useState([]);
  const [pendingRecords, setPendingRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sealing, setSealing] = useState(false);
  const [sealSuccess, setSealSuccess] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [batchList, pendingList] = await Promise.all([
        listBatches(),
        listRecords({ status: 'pending' }),
      ]);
      setBatches(batchList || []);
      setPendingRecords(pendingList || []);
    } catch (err) {
      setError(err.message || 'Failed to load batches');
    } finally {
      setLoading(false);
    }
  }

  async function handleSeal() {
    if (pendingRecords.length === 0) return;
    setSealing(true);
    setError(null);
    setSealSuccess(null);
    try {
      const result = await seal();
      setSealSuccess(result);
      await loadData();
    } catch (err) {
      setError(err.message || 'Sealing failed');
    } finally {
      setSealing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Pinned Contract Info */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Batches</h1>
          <p className="mt-1 text-sm text-slate-600">
            Each batch is an immutable Merkle tree over its records. Only the 32-byte root goes on-chain.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono bg-white px-3 py-1.5 rounded-lg border border-slate-200">
          <span className="font-sans font-semibold text-slate-700">Contract</span>
          <span className="text-indigo-600 font-bold">RootRegistry.sol</span>
          <span>·</span>
          <span>Chain 31337</span>
        </div>
      </div>

      {/* Seal Success Banner */}
      {sealSuccess && (
        <Alert
          variant="success"
          title={`${sealSuccess.batchId || 'Batch'} sealed and published on-chain!`}
          message={`Root ${sealSuccess.root} published in block ${sealSuccess.blockNumber} (tx: ${sealSuccess.txHash})`}
          onClose={() => setSealSuccess(null)}
        />
      )}

      {/* General Error Banner */}
      {error && (
        <Alert
          variant="error"
          title="Operation Failed"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Ready to Seal Panel */}
      <section className="rounded-xl border border-indigo-200 bg-linear-to-r from-indigo-50/70 to-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-[280px]">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Ready to Seal</h2>
              <Badge status="pending">{pendingRecords.length} pending</Badge>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
              Sealing sorts records by ID, computes the leaf hashes, builds the Merkle tree, and calls
              <code className="text-xs font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-indigo-700 ml-1">
                publishRoot()
              </code> on the write-once Hardhat smart contract.
            </p>
            {pendingRecords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {pendingRecords.map((r) => (
                  <span
                    key={r.record_id || r.recordId}
                    className="font-mono text-xs px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-medium"
                  >
                    {r.record_id || r.recordId}
                  </span>
                ))}
              </div>
            )}
          </div>

          <Button
            variant="primary"
            size="md"
            loading={sealing}
            disabled={pendingRecords.length === 0}
            onClick={handleSeal}
            className="shrink-0"
          >
            <svg
              className="w-4 h-4 mr-1.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Seal batch · {pendingRecords.length} records
          </Button>
        </div>
      </section>

      {/* Batches List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Anchored Batches</h2>

        {loading ? (
          <div className="flex justify-center p-12">
            <Spinner size="lg" />
          </div>
        ) : batches.length === 0 ? (
          <Card bodyClassName="p-12 text-center text-sm text-slate-500">
            No batches have been anchored on-chain yet. Confirm records and click "Seal batch" above.
          </Card>
        ) : (
          batches.map((b) => (
            <Card key={b.batch_id || b.batchId} className="shadow-xs hover:border-slate-300 transition-all">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 bg-slate-50/50">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono font-bold text-base text-slate-900">
                    {b.batch_id || b.batchId}
                  </span>
                  <Badge status="anchored">anchored</Badge>
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {b.published_at || b.publishedAt
                    ? new Date(b.published_at || b.publishedAt).toLocaleString()
                    : 'Block confirmed'}
                </div>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
                <div className="space-y-2.5">
                  <div className="flex items-start gap-3">
                    <span className="w-24 text-slate-500 font-medium shrink-0">Merkle Root</span>
                    <Hash value={b.root} copyable truncate leadingChars={10} trailingChars={8} />
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="w-24 text-slate-500 font-medium shrink-0">Leaf Count</span>
                    <span className="font-semibold text-slate-800">
                      {b.leaf_count || b.leafCount} records
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-start gap-3">
                    <span className="w-24 text-slate-500 font-medium shrink-0">Transaction</span>
                    <Hash
                      value={b.tx_hash || b.txHash}
                      copyable
                      truncate
                      leadingChars={8}
                      trailingChars={6}
                    />
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="w-24 text-slate-500 font-medium shrink-0">Block Height</span>
                    <span className="font-mono font-semibold text-slate-800">
                      #{b.block_number || b.blockNumber || '1'}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
