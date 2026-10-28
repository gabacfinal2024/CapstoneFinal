import { useEffect, useRef, useState } from 'react'
import { Check, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { deviceApi } from '../api/deviceApi'
import './ScanFeedback.css'

const CROPS = [
  { key: 'eggplant', label: 'Eggplant' },
  { key: 'cucumber', label: 'Cucumber' },
  { key: 'carrot', label: 'Carrot' },
]
const STATES = [
  { key: 'fresh', label: 'Fresh' },
  { key: 'at-risk', label: 'At-Risk' },
  { key: 'rotten', label: 'Rotten' },
]

/** Human-readable text for a stored feedback label. */
export function feedbackText(label) {
  if (!label) return ''
  if (label === 'correct') return 'Marked correct'
  if (label === 'none') return 'Not a vegetable'
  const [crop, state] = label.split('_')
  const c = CROPS.find((x) => x.key === crop)?.label || crop
  const s = STATES.find((x) => x.key === state)?.label || state
  return `${c} · ${s}`
}

/**
 * "Is this right?" strip under a scan result. ✔ confirms the result; ✖ opens a bottom sheet
 * to pick the true label (stored by the backend for retraining the model).
 */
export default function ScanFeedback({ scan, onUpdated }) {
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const send = async (label) => {
    setBusy(true)
    setError('')
    try {
      const updated = await deviceApi.scanFeedback(scan.device_id, scan.id, label)
      onUpdated?.({ ...scan, ...updated, feedback_label: updated?.feedback_label ?? label })
      setSheet(false)
      setToast('Thank you! Your answer helps the camera learn.')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setToast(''), 3500)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scan-feedback">
      {scan.feedback_label ? (
        <div className="scan-feedback__done">
          <span><Check size={14} /> {feedbackText(scan.feedback_label)}</span>
          <button type="button" className="scan-feedback__change" onClick={() => setSheet(true)}>Change</button>
        </div>
      ) : (
        <>
          <span className="scan-feedback__q">Is this right?</span>
          <div className="scan-feedback__btns">
            <button type="button" className="fb-btn fb-btn--yes" onClick={() => send('correct')} disabled={busy}>
              <ThumbsUp size={16} /> Correct
            </button>
            <button type="button" className="fb-btn fb-btn--no" onClick={() => setSheet(true)} disabled={busy}>
              <ThumbsDown size={16} /> Wrong
            </button>
          </div>
        </>
      )}
      {error && !sheet && <p className="error-text">{error}</p>}

      {sheet && (
        <div className="sheet-overlay" onClick={() => !busy && setSheet(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="What is it really?" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head">
              <h4>What is it really?</h4>
              <button type="button" className="sheet__close" aria-label="Close" onClick={() => setSheet(false)} disabled={busy}><X size={20} /></button>
            </div>

            <button type="button" className="sheet__none" onClick={() => send('none')} disabled={busy}>
              Not a vegetable <small>(empty view, hand, other produce…)</small>
            </button>

            {CROPS.map((c) => (
              <div key={c.key} className="sheet__group">
                <strong>{c.label}</strong>
                <div className="sheet__row">
                  {STATES.map((s) => (
                    <button key={s.key} type="button" className={`sheet__opt ${s.key}`} onClick={() => send(`${c.key}_${s.key}`)} disabled={busy}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {error && <p className="error-text">{error}</p>}
          </div>
        </div>
      )}

      {toast && <div className="fb-toast" role="status">{toast}</div>}
    </div>
  )
}
