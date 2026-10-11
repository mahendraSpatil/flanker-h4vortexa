// Owner: Neel | Records list with filters, status badges, and proof download
import { useState, useEffect } from 'react';
import { list, proofUrl, fileUrl } from '../api/documents.js';
import { Card, Badge, Button, Spinner, Hash } from '../components/ui/index.js';
import { Link } from 'react-router-dom';

const DOC_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'DEGREE_CERTIFICATE', label: 'Degree certificate' },
  { value: 'MARKSHEET', label: 'Marksheet' },
  { value: 'SALARY_SLIP', label: 'Salary slip' },
  { value: 'OFFER_LETTER', label: 'Offer letter' },
  { value: 'EXPERIENCE_LETTER', label: 'Experience letter' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'anchored', label: 'Anchored' },
];

export default function Records() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter states
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [issuerQuery, setIssuerQuery] = useState('');

  useEffect(() => {
    fetchRecords();
  }, [statusFilter, typeFilter]);

  async function fetchRecords() {
    setLoading(true);
    setError(null);
    try {
      const data = await list({
        status: statusFilter || undefined,
        docType: typeFilter || undefined,
        issuer: issuerQuery ? issuerQuery.trim() : undefined,
      });
      setRecords(data || []);
    } catch (err) {
      setError(err.message || 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }

  function handleFilterSubmit(e) {
    e.preventDefault();
    fetchRecords();
  }

  function handleClearFilters() {
    setStatusFilter('');
    setTypeFilter('');
    setIssuerQuery('');
  }

  // Summary counts
  const draftCount = records.filter((r) => r.status === 'draft').length;
  const pendingCount = records.filter((r) => r.status === 'pending').length;
  const anchoredCount = records.filter((r) => r.status === 'anchored').length;

  // Filter in memory for instantaneous search by issuer
  const filteredRecords = issuerQuery
    ? records.filter((r) =>
        (r.issuer || '').toLowerCase().includes(issuerQuery.toLowerCase()),
      )
    : records;

  return (
    <div className="space-y-6">
      {/* Page Title & Counters */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Records</h1>
          <p className="mt-1 text-sm text-slate-600">
            Every registered document. Proofs are available once a record's batch is anchored on-chain.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge status="draft">{draftCount} draft</Badge>
          <Badge status="pending">{pendingCount} pending</Badge>
          <Badge status="anchored">{anchoredCount} anchored</Badge>
        </div>
      </div>

      {/* Filter Form Card */}
      <Card bodyClassName="p-4 sm:p-5">
        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="flex flex-col gap-1.5 w-full sm:w-40">
            <label htmlFor="f-status" className="text-xs font-semibold text-slate-600">
              Status
            </label>
            <select
              id="f-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 w-full sm:w-48">
            <label htmlFor="f-type" className="text-xs font-semibold text-slate-600">
              Document Type
            </label>
            <select
              id="f-type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            >
              {DOC_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <label htmlFor="f-issuer" className="text-xs font-semibold text-slate-600">
              Issuer Search
            </label>
            <input
              id="f-issuer"
              type="text"
              placeholder="Search by issuer name..."
              value={issuerQuery}
              onChange={(e) => setIssuerQuery(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              disabled={!statusFilter && !typeFilter && !issuerQuery}
            >
              Clear
            </Button>
          </div>
        </form>
      </Card>

      {/* Records Table Card */}
      <Card bodyClassName="p-0 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-rose-600 font-medium">{error}</div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No document records match the active filters.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="px-4 py-3 whitespace-nowrap">Record ID</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Issuer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredRecords.map((r) => {
                const isAnchored = r.status === 'anchored';
                const isDraft = r.status === 'draft';
                const isPending = r.status === 'pending';

                return (
                  <tr key={r.record_id || r.recordId} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap text-slate-900">
                      {r.record_id || r.recordId}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate" title={r.file_name || r.fileName}>
                      <a
                        href={fileUrl(r.record_id || r.recordId)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline font-medium"
                      >
                        {r.file_name || r.fileName}
                      </a>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {r.doc_type || r.docType || <span className="text-slate-400 italic">unconfirmed</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-slate-700" title={r.issuer}>
                      {r.issuer || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                      {r.doc_date || r.date || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge status={r.status}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                      {r.batch_id || r.batchId || '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {isAnchored && (
                        <a
                          href={proofUrl(r.record_id || r.recordId)}
                          download={`${r.record_id || r.recordId}.proof.json`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-2xs transition-colors"
                        >
                          <svg
                            className="w-3.5 h-3.5 text-indigo-600"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          proof.json
                        </a>
                      )}
                      {isDraft && (
                        <Link
                          to={`/confirm/${encodeURIComponent(r.record_id || r.recordId)}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors"
                        >
                          Confirm
                        </Link>
                      )}
                      {isPending && (
                        <span className="text-xs text-amber-700 font-medium">Waiting to seal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Footer info */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
          <span>Showing {filteredRecords.length} records</span>
          <span>Order: recordId</span>
        </div>
      </Card>
    </div>
  );
}
