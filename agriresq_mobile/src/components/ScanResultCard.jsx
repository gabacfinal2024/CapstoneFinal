import { AlertTriangle, ScanSearch } from 'lucide-react'
import StatusBadge from './StatusBadge'
import ScanFeedback from './ScanFeedback'
import { backendAsset } from '../api/deviceApi'
import { CROP_LABELS, formatTime } from '../utils/helpers'
import './ScanResultCard.css'

const STATES = [
  { key: 'fresh', label: 'Fresh', cls: 'fresh' },
  { key: 'at-risk', label: 'At-Risk', cls: 'risk' },
  { key: 'rotten', label: 'Rotten', cls: 'rotten' },
]

export const NO_VEGETABLE_TEXT = 'No eggplant, cucumber or carrot in view'
export const NO_VEGETABLE_HINT = 'Place ONE vegetable in front of the camera, centred, in good light.'

/** True when the camera saw none of the three target vegetables. */
export function isNoVegetable(scan) {
  return !!scan && (scan.detected === false || scan.state === 'none' || scan.freshness_status === 'UNKNOWN')
}

/** One-line description of a scan for lists and summaries. */
export function scanSummary(scan) {
  if (!scan) return 'No scans yet'
  const at = scan.created_at ? formatTime(scan.created_at) : ''
  if (isNoVegetable(scan)) return at ? `Nothing detected at ${at}` : 'Nothing detected'
  const crop = CROP_LABELS[scan.detected_crop || scan.crop_type] || scan.detected_crop || scan.crop_type || ''
  const state = { GREEN: 'Fresh', AMBER: 'At-Risk', RED: 'Rotten' }[scan.freshness_status] || ''
  return [crop, state].filter(Boolean).join(' · ')
}

export function ProbabilityBars({ probs }) {
  if (!probs) return null
  return (
    <div className="prob-bars">
      {STATES.map((s) => {
        const pct = Math.round(Number(probs[s.key] ?? 0) * 100)
        return (
          <div key={s.key} className="prob-row">
            <span className="prob-label">{s.label}</span>
            <div className="prob-track"><div className={`prob-fill ${s.cls}`} style={{ width: `${pct}%` }} /></div>
            <span className="prob-value">{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

export function confidencePct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const v = Number(value)
  return `${(v <= 1 ? v * 100 : v).toFixed(1)}%`
}

/** Compact status chip: grey "No match" or the Fresh / At-Risk / Rotten badge. */
export function ScanChip({ scan, size = 'sm' }) {
  if (!scan) return <span className="muted small">No scans yet</span>
  if (isNoVegetable(scan)) return <StatusBadge status="UNKNOWN" size={size} />
  return <StatusBadge status={scan.freshness_status} showPercent percent={scan.freshness_percent} size={size} />
}

export default function ScanResultCard({ scan, title = 'Latest scan', showImage = true, feedback = true, onScanUpdated }) {
  if (!scan) {
    return (
      <div className="card scan-card scan-card--empty">
        <h3>{title}</h3>
        <p className="muted">No scans yet. Tap “Scan now” or wait for the next scheduled scan.</p>
      </div>
    )
  }

  const none = isNoVegetable(scan)
  const mismatch = !none && !!scan.crop_mismatch
  const cropKey = scan.detected_crop || scan.crop_type
  const canGiveFeedback = feedback && scan.device_id != null && scan.id != null

  return (
    <div className={`card scan-card${none ? ' scan-card--none' : ''}`}>
      <div className="scan-card__head">
        <h3>{title}</h3>
        <ScanChip scan={scan} />
      </div>

      {showImage && scan.image_url && (
        <img className="scan-card__img" src={backendAsset(scan.image_url)} alt={none ? 'Camera frame' : 'Analysed produce'} />
      )}

      {none && (
        <div className="scan-card__none">
          <div className="scan-card__none-icon"><ScanSearch size={26} /></div>
          <strong>{scan.message || NO_VEGETABLE_TEXT}</strong>
          <p>{NO_VEGETABLE_HINT}</p>
          {scan.created_at && <span className="muted small">Scanned at {formatTime(scan.created_at)}</span>}
        </div>
      )}

      {mismatch && (
        <p className="scan-card__warn">
          <AlertTriangle size={14} />
          {scan.message || `This looks like ${CROP_LABELS[scan.detected_crop] || scan.detected_crop}, not the crop this camera is set to.`}
        </p>
      )}

      {!none && scan.low_confidence && (
        <p className="scan-card__warn">
          <AlertTriangle size={14} /> Re-scan for a clearer result: place one vegetable in clear view, centred, in good light.
        </p>
      )}

      {!none && (
        <>
          <div className="scan-card__grid">
            <div><span>Crop</span><strong>{CROP_LABELS[cropKey] || cropKey || '—'}</strong></div>
            <div><span>Confidence</span><strong>{confidencePct(scan.ml_confidence)}</strong></div>
            <div>
              <span>Days to spoil</span>
              <strong>{scan.days_to_spoil != null && !Number.isNaN(Number(scan.days_to_spoil)) ? Number(scan.days_to_spoil).toFixed(1) : '—'}</strong>
            </div>
            <div><span>Scanned</span><strong>{scan.created_at ? formatTime(scan.created_at) : 'now'}</strong></div>
          </div>
          <ProbabilityBars probs={scan.probs} />
        </>
      )}

      {canGiveFeedback && <ScanFeedback scan={scan} onUpdated={onScanUpdated} />}
    </div>
  )
}
