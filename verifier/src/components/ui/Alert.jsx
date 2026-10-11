// Owner: Neel | Alert banner displaying message and error codes
export default function Alert({
  variant = 'info',
  title,
  message,
  code,
  details,
  onClose,
  className = '',
}) {
  const styles = {
    info: 'bg-indigo-50 border-indigo-200 text-indigo-900',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    error: 'bg-rose-50 border-rose-200 text-rose-900',
  };

  const icons = {
    info: (
      <svg className="w-5 h-5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  };

  const styleClass = styles[variant] || styles.info;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-4 rounded-xl border ${styleClass} ${className}`}
    >
      <div className="shrink-0 mt-0.5">{icons[variant] || icons.info}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {title && <span className="font-semibold text-sm">{title}</span>}
          {code && (
            <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-black/5 uppercase">
              {code}
            </span>
          )}
        </div>
        {message && <div className="text-xs mt-1 text-slate-700 leading-relaxed">{message}</div>}
        {details && (
          <pre className="mt-2 text-xs font-mono bg-black/5 p-2 rounded overflow-x-auto text-slate-800">
            {typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)}
          </pre>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
