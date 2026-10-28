import { AlertTriangle, CircleSlash } from 'lucide-react'
import {
  NO_VEGETABLE_HINT, NO_VEGETABLE_MESSAGE, cropLabel, isDetected, mismatchMessage, scanBadgeStatus, scanImageSrc,
} from '../api/deviceApi'
import ProbabilityBars from './ProbabilityBars'
import ScanFeedback from './ScanFeedback'
import StatusBadge from './StatusBadge'

const pct = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)))

/**
 * One scan result. Three outcomes:
 *  - nothing detected (open-set "none"): neutral card, never a freshness badge
 *  - detected, crop differs from the device's crop: amber warning on top of the result
 *  - detected: freshness, days to spoil, probabilities (+ re-scan hint when low confidence)
 * `onScanUpdated` receives the scan returned by the feedback endpoint.
 */
export default function ScanResultCard({ scan, title = 'Latest scan', onScanUpdated, readOnly = false }) {
  if (!scan) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-slate-400">
        <p className="font-bold text-slate-500">No scan yet</p>
        <p className="text-xs mt-1">{readOnly ? 'This camera has not uploaded a scan yet.' : 'Press “Scan now” or turn on automatic scans.'}</p>
      </div>
    )
  }
  const img = scanImageSrc(scan)
  const detected = isDetected(scan)
  const confidence = pct(Number(scan.ml_confidence) * 100)
  const freshness = pct(scan.freshness_percent)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-400">
            {scan.created_at ? new Date(scan.created_at).toLocaleString() : ''}
            {scan.device_name ? ` • ${scan.device_name}` : ''}
            {scan.source ? ` • ${scan.source.toLowerCase()}` : ''}
          </p>
        </div>
        <StatusBadge status={scanBadgeStatus(scan)} />
      </div>

      {img && (
        <div className="bg-black aspect-video flex items-center justify-center">
          <img src={img} alt={detected ? 'Analyzed produce' : 'Camera frame with no target vegetable'} className="w-full h-full object-contain" />
        </div>
      )}

      <div className="p-4 space-y-4">
        {!detected ? (
          <div className="flex gap-3 items-start p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-600">
            <CircleSlash size={22} className="shrink-0 mt-0.5 text-slate-400" />
            <div className="text-sm">
              <p className="font-bold text-slate-700">Nothing detected</p>
              <p className="mt-0.5">{scan.message || NO_VEGETABLE_MESSAGE}</p>
              <p className="text-xs text-slate-400 mt-2">{NO_VEGETABLE_HINT}</p>
            </div>
          </div>
        ) : (
          <>
            {scan.crop_mismatch && (
              <div role="alert" className="flex gap-2 items-start p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span><b>Crop mismatch.</b> {mismatchMessage(scan)} This result was not applied to your batch.</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Detected</p>
                <p className="font-bold text-slate-800">{cropLabel(scan.detected_crop || scan.crop_type)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Confidence</p>
                <p className="font-bold text-[#2A6B48]">{confidence != null ? `${confidence}%` : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Days to spoil</p>
                <p className="font-bold text-slate-800">{scan.days_to_spoil ?? '—'}</p>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-bold text-slate-500">Freshness</span>
                <span className="font-bold text-slate-700">{freshness != null ? `${freshness}%` : '—'}</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 rounded-full"
                     style={{ width: `${freshness ?? 0}%` }} />
              </div>
            </div>

            <ProbabilityBars probs={scan.probs} />

            {scan.low_confidence && (
              <div className="flex gap-2 items-start p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-xs">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span><b>Re-scan for a clearer result.</b> The camera may not see one {cropLabel(scan.detected_crop || scan.crop_type).toLowerCase()} clearly.
                  Place a single item, centred on a plain surface in good light, then scan again.</span>
              </div>
            )}
          </>
        )}

        <ScanFeedback scan={scan} onUpdated={onScanUpdated} readOnly={readOnly} />
      </div>
    </div>
  )
}
