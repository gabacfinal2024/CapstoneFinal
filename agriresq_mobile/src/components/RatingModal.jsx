import { useState } from 'react'
import { api } from '../api/supabaseApi'
import './TransactionExitModal.css'

// Buyer rates the stall operator after a completed deal (stored in `ratings`, shown on the operator's profile).
export default function RatingModal({ open, threadId, operatorName, onDone }) {
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!open) return null

  const submit = async () => {
    if (!stars) return setError('Tap a star to rate.')
    setBusy(true)
    setError('')
    try {
      await api.rateOperator(threadId, stars, comment)
      onDone()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="exit-modal-overlay">
      <div className="exit-modal card">
        <h3>Rate {operatorName || 'the stall operator'}</h3>
        <p>How was the deal? Your rating helps other buyers.</p>
        <div className="rating-stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
              className={`star ${n <= stars ? 'on' : ''}`} onClick={() => setStars(n)}>★</button>
          ))}
        </div>
        <textarea className="rating-comment" rows={2} maxLength={300} placeholder="Optional comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        {error && <p className="error-text">{error}</p>}
        <div className="exit-modal-actions">
          <button type="button" className="btn btn-green" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Submit rating'}</button>
          <button type="button" className="btn-link" onClick={onDone}>Skip</button>
        </div>
      </div>
    </div>
  )
}
