/**
 * Tiny dependency-free SVG line chart. `values` are oldest -> newest numbers.
 * Renders nothing with fewer than 2 points (never invents data).
 */
export default function Sparkline({ values, color = 'var(--primary)', height = 44, label }) {
  const pts = (values || []).map(Number).filter((v) => Number.isFinite(v))
  if (pts.length < 2) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const W = 100
  const pad = 4
  const H = 40
  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * W
    const y = pad + (1 - (v - min) / span) * (H - pad * 2)
    return [x, y]
  })
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
      role="img"
      aria-label={label || 'Trend'}
    >
      <polygon points={area} fill={color} opacity="0.1" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
