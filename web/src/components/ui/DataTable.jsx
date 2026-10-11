// Owner: Neel | Simple DataTable component with responsive wrapper and empty state
import EmptyState from './EmptyState.jsx';

export default function DataTable({
  columns = [],
  data = [],
  emptyText = 'No records found',
  keyField = 'id',
  className = '',
}) {
  if (!data || data.length === 0) {
    return <EmptyState description={emptyText} />;
  }

  return (
    <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white ${className}`}>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((col, idx) => (
              <th
                key={col.key || idx}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap ${
                  col.headerClassName || ''
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((row, rIdx) => {
            const rowKey = row[keyField] ?? rIdx;
            return (
              <tr key={rowKey} className="hover:bg-slate-50/60 transition-colors">
                {columns.map((col, cIdx) => (
                  <td
                    key={col.key || cIdx}
                    className={`px-4 py-3 align-middle text-slate-900 ${col.className || ''}`}
                  >
                    {col.render ? col.render(row[col.key], row, rIdx) : row[col.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
