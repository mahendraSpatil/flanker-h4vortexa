// Owner: Neel | Reusable Card container panel
export default function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  headerClassName = '',
  bodyClassName = '',
  ...props
}) {
  const hasHeader = Boolean(title || subtitle || actions);

  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden ${className}`}
      {...props}
    >
      {hasHeader && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 ${headerClassName}`}
        >
          <div>
            {title && (
              <h2 className="text-base font-semibold text-slate-900 tracking-tight">{title}</h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
