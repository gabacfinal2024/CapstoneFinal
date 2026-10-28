import { useEffect, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { FEEDBACK_LABELS, deviceApi, feedbackText } from '../api/deviceApi'

/**
 * "Is this right?" control. Corrections are stored with the scan image and used to retrain the AI.
 * Only for scans that belong to a device (uploads have no device_id).
 */
export default function ScanFeedback({ scan, onUpdated, readOnly = false }) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  if (!scan?.device_id || !scan?.id) return null

  // Only shown when the caller has no operate access (the backend allows owner, shared people and admin, so normally unused).
  if (readOnly) {
    return scan.feedback_label ? (
      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">{scan.feedback_label === 'correct' ? '✔' : '✖'} {feedbackText(scan.feedback_label)}</p>
      </div>
    ) : null
  }

  const send = async (label) => {
    setBusy(true)
    setError('')
    try {
      const updated = await deviceApi.scanFeedback(scan.device_id, scan.id, label)
      onUpdated?.(updated)
      setOpen(false)
      setChoice('')
      setToast(label === 'correct' ? 'Thanks! Marked as correct.' : 'Thanks! Your correction was saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-500">Is this right?</span>
        <button type="button" disabled={busy} onClick={() => send('correct')}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 flex items-center gap-1">
          {busy && !open ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Correct
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpen(true); setError('') }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 flex items-center gap-1">
          <X size={12} /> Wrong
        </button>
      </div>
      {scan.feedback_label && (
        <p className="text-xs text-slate-500 mt-2">{scan.feedback_label === 'correct' ? '✔' : '✖'} {feedbackText(scan.feedback_label)}</p>
      )}
      <p className="text-[11px] text-slate-400 mt-1">Your corrections are used to retrain the AI for your stall.</p>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 id="feedback-title" className="text-lg font-bold text-slate-800">What is it really?</h3>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Correct answer
              <select value={choice} onChange={(e) => setChoice(e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-normal normal-case text-slate-800 bg-white">
                <option value="">Choose…</option>
                {FEEDBACK_LABELS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={!choice || busy} onClick={() => send(choice)}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#2A6B48] hover:bg-[#1f5035] disabled:opacity-50 flex items-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Save correction
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-slate-800 text-white text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
