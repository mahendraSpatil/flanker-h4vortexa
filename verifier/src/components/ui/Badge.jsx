// Owner: Neel | Status badge component with consistent status colors
export default function Badge({ status, children, className = '' }) {
  const normalized = String(status || children || '').toLowerCase();

  const styles = {
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    pending: 'bg-amber-50 text-amber-800 border-amber-200',
    anchored: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    valid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    pass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    mismatch: 'bg-rose-50 text-rose-800 border-rose-200',
    fail: 'bg-rose-50 text-rose-800 border-rose-200',
    invalid: 'bg-rose-50 text-rose-800 border-rose-200',
    skipped: 'bg-slate-100 text-slate-500 border-slate-200',
  };

  const matchedStyle =
    styles[normalized] ||
    (normalized.includes('modified') || normalized.includes('invalid') || normalized.includes('mismatch')
      ? styles.fail
      : 'bg-slate-100 text-slate-700 border-slate-200');

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${matchedStyle} ${className}`}
    >
      {children || status}
    </span>
  );
}
