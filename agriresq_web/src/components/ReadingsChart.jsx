const W = 640
const H = 220
const PAD = { left: 40, right: 40, top: 14, bottom: 28 }
const STRESS_TEMP = 30

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Temperature (left axis, °C) and humidity (right axis, %) over time.
 * `readings` = Reading[] from the API (newest first).
 */
export default function ReadingsChart({ readings }) {
  const points = [...(readings || [])]
    .filter((r) => r.temperature_c != null && r.humidity_rh != null)
    .reverse()

  if (points.length < 2) {
    return (
      <div className="h-full min-h-48 flex flex-col items-center justify-center text-slate-400 text-sm text-center px-6">
        <p className="font-semibold text-slate-500">Not enough sensor readings yet</p>
        <p className="text-xs mt-1">The trend appears after two readings. The sensor reports every 30 seconds; check its Wi-Fi, server URL, and DHT22 wiring if no reading arrives.</p>
      </div>
    )
  }

  const temps = points.map((p) => Number(p.temperature_c))
  const tMin = Math.floor(Math.min(...temps, STRESS_TEMP) - 2)
  const tMax = Math.ceil(Math.max(...temps, STRESS_TEMP) + 2)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (i) => PAD.left + (i / (points.length - 1)) * innerW
  const yT = (t) => PAD.top + (1 - (t - tMin) / (tMax - tMin)) * innerH
  const yH = (h) => PAD.top + (1 - h / 100) * innerH

  const tempLine = points.map((p, i) => `${x(i).toFixed(1)},${yT(Number(p.temperature_c)).toFixed(1)}`).join(' ')
  const humLine = points.map((p, i) => `${x(i).toFixed(1)},${yH(Number(p.humidity_rh)).toFixed(1)}`).join(' ')
  const tTicks = [tMin, Math.round((tMin + tMax) / 2), tMax]
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Temperature and humidity trend">
        {tTicks.map((t) => (
          <g key={`t${t}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yT(t)} y2={yT(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.left - 6} y={yT(t) + 4} textAnchor="end" fontSize="11" fill="#f59e0b">{t}°</text>
          </g>
        ))}
        {[0, 50, 100].map((h) => (
          <text key={`h${h}`} x={W - PAD.right + 6} y={yH(h) + 4} fontSize="11" fill="#2A6B48">{h}%</text>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={yT(STRESS_TEMP)} y2={yT(STRESS_TEMP)}
              stroke="#f43f5e" strokeDasharray="5 4" strokeWidth="1.2" />
        <text x={W - PAD.right - 4} y={yT(STRESS_TEMP) - 4} textAnchor="end" fontSize="10" fill="#f43f5e">30° stress</text>
        <polyline points={humLine} fill="none" stroke="#2A6B48" strokeWidth="2" strokeLinejoin="round" opacity="0.85" />
        <polyline points={tempLine} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" />
        {xLabels.map((i) => (
          <text key={`x${i}`} x={x(i)} y={H - 8} fontSize="11" fill="#94a3b8"
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {fmtTime(points[i].created_at)}
          </text>
        ))}
      </svg>
      <div className="flex gap-5 text-xs font-semibold text-slate-500 mt-1 pl-10">
        <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-amber-500" />Temperature (°C)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-[#2A6B48]" />Humidity (%)</span>
      </div>
    </div>
  )
}
