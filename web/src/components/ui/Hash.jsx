// Owner: Neel | Truncated monospace Hash display with copy button
import { useState } from 'react';

export default function Hash({
  value,
  truncate = true,
  copyable = true,
  leadingChars = 6,
  trailingChars = 4,
  className = '',
}) {
  const [copied, setCopied] = useState(false);

  if (!value) return <span className="text-slate-400 font-mono text-xs">—</span>;

  const str = String(value);
  const display =
    truncate && str.length > leadingChars + trailingChars + 3
      ? `${str.slice(0, leadingChars)}…${str.slice(-trailingChars)}`
      : str;

  async function handleCopy(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(str);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  return (
    <span
      title={str}
      className={`inline-flex items-center gap-1.5 font-mono text-xs bg-slate-100/80 border border-slate-200/80 rounded px-1.5 py-0.5 text-slate-800 transition-colors hover:bg-slate-200/60 ${className}`}
    >
      <span className="select-all">{display}</span>
      {copyable && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy hash'}
          className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer transition-colors"
        >
          {copied ? (
            <svg
              className="w-3.5 h-3.5 text-emerald-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}
