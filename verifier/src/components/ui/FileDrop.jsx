// Owner: Neel | File dropzone with drag-and-drop, format indicator, and file metadata
import { useState, useRef } from 'react';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export default function FileDrop({
  label = 'Document',
  file = null,
  onFileSelect,
  accept,
  typeLabel,
  hint = 'PDF, PNG, JPG or TXT (max 10 MB)',
  className = '',
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelect?.(e.dataTransfer.files[0]);
    }
  }

  function handleChange(e) {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect?.(e.target.files[0]);
    }
  }

  // Derive badge color and text
  const ext = file?.name?.split('.').pop()?.toUpperCase() || typeLabel || 'FILE';
  const isPdf = ext === 'PDF';
  const isJson = ext === 'JSON';
  const isImage = ['PNG', 'JPG', 'JPEG'].includes(ext);

  const badgeBg = isPdf
    ? 'bg-rose-50 border-rose-200 text-rose-700'
    : isJson
    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
    : isImage
    ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-slate-100 border-slate-200 text-slate-700';

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`group relative flex items-center gap-3.5 p-4 rounded-xl border-2 transition-all cursor-pointer min-h-[76px] select-none ${
        isDragOver
          ? 'border-indigo-500 bg-indigo-50/50'
          : file
          ? 'border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/60'
          : 'border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-400'
      } ${className}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="sr-only"
        tabIndex={-1}
      />

      <div
        className={`w-10 h-11 rounded-lg border flex items-center justify-center text-[11px] font-bold tracking-tight shrink-0 shadow-2xs ${badgeBg}`}
      >
        {ext.slice(0, 4)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
          {label}
        </div>
        {file ? (
          <div>
            <div className="font-medium text-sm text-slate-900 truncate">
              {file.name}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
              <span>{formatBytes(file.size)}</span>
              <span>·</span>
              <span className="text-indigo-600 group-hover:underline">click to replace</span>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-medium text-slate-700">
              Drop file here or <span className="text-indigo-600 group-hover:underline">browse</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
          </div>
        )}
      </div>
    </div>
  );
}
