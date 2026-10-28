import { Droplets, Gauge, ScanEye, Thermometer } from 'lucide-react'
import { cameraConfidencePct, fmtDateTime, pairedSensor } from '../lib/format'

/**
 * Compact, fixed-height row with the DHT22 reading paired with a batch: temperature, humidity, VPD.
 * Always renders the same three cells (a placeholder when there is no reading) so cards stay level.
 * `row` is a products row with its product_climate (embedded or attached).
 */
export default function PairedSensorRow({ row, className = '' }) {
  const s = pairedSensor(row)
  const conf = cameraConfidencePct(row)
  const title = s.has
    ? `Paired DHT22 reading${s.updatedAt ? `, updated ${fmtDateTime(s.updatedAt)}` : ''}`
    : 'No sensor reading yet'

  return (
    <div className={`grid grid-cols-3 gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 ${className}`} title={title} aria-label={title}>
      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 min-w-0">
        <Thermometer size={13} className="text-amber-500 shrink-0" />
        <span className="truncate">{s.temp != null ? `${s.temp.toFixed(1)}°C` : '—'}</span>
      </span>
      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 min-w-0">
        <Droplets size={13} className="text-[#2A6B48] shrink-0" />
        <span className="truncate">{s.rh != null ? `${s.rh.toFixed(0)}% RH` : '—'}</span>
      </span>
      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 min-w-0">
        <Gauge size={13} className="text-sky-500 shrink-0" />
        <span className="truncate">{s.vpd != null ? `${s.vpd.toFixed(2)} kPa` : '—'}</span>
      </span>
      <span className="col-span-3 text-[11px] font-medium text-slate-400 -mt-0.5 truncate">
        {s.has
          ? `Stall sensor${s.updatedAt ? ` · updated ${fmtDateTime(s.updatedAt)}` : ''}`
          : 'No sensor reading yet'}
      </span>
      <span className="col-span-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-600 border-t border-slate-100 pt-1.5" title="Confidence of the ESP32-CAM freshness model over this batch's recent accepted scans">
        <ScanEye size={13} className="text-emerald-600 shrink-0" />
        <span className="truncate">{conf != null ? `Camera confidence ${conf}%` : 'Camera confidence: no scans yet'}</span>
      </span>
    </div>
  )
}
