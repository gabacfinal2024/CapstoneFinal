const ROWS = [
  { key: 'fresh', label: 'Fresh', color: 'bg-emerald-500' },
  { key: 'at-risk', label: 'At-Risk', color: 'bg-amber-500' },
  { key: 'rotten', label: 'Rotten', color: 'bg-rose-500' },
]

export default function ProbabilityBars({ probs }) {
  if (!probs) return null
  return (
    <div className="space-y-1.5">
      {ROWS.map((row) => {
        const pct = Math.round((Number(probs[row.key]) || 0) * 100)
        return (
          <div key={row.key} className="flex items-center gap-2 text-xs">
            <span className="w-14 font-semibold text-slate-500">{row.label}</span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${row.color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-9 text-right font-bold text-slate-700">{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}
