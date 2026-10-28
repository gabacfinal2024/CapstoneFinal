import { STATUS_META } from '../api/deviceApi'

export default function StatusBadge({ status, className = '' }) {
  const meta = STATUS_META[status]
  if (!meta) {
    return (
      <span className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md border bg-slate-100 text-slate-500 border-slate-200 ${className}`}>
        {status ? 'Unknown' : 'No scan yet'}
      </span>
    )
  }
  return (
    <span className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md border ${meta.badge} ${className}`}>
      {meta.label}
    </span>
  )
}
