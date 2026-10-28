import './TransactionExitModal.css'
import { useState } from 'react'

export default function TransactionExitModal({ open, onConfirm, onCancel, userId }) {
  const [dontRemind, setDontRemind] = useState(false)

  if (!open) return null

  const savePref = () => {
    if (!dontRemind) return
    try {
      const key = `agriresq.no_transaction_exit_reminder.${userId || 'anon'}`
      localStorage.setItem(key, '1')
    } catch (e) {
      // ignore storage errors
    }
  }

  const handleConfirm = (val) => {
    savePref()
    onConfirm(val)
  }

  const handleCancel = () => {
    savePref()
    onCancel()
  }

  return (
    <div className="exit-modal-overlay">
      <div className="exit-modal card">
        <h3>Transaction completed?</h3>
        <p>If yes, this chat will be moved to archives. If not, it stays in your inbox.</p>

        <label className="dont-remind">
          <input type="checkbox" checked={dontRemind} onChange={(e) => setDontRemind(e.target.checked)} />
          <span>Don't remind me again</span>
        </label>

        <div className="exit-modal-actions">
          <button className="btn btn-green" onClick={() => handleConfirm(true)}>Yes, completed</button>
          <button className="btn btn-outline-dark" onClick={() => handleConfirm(false)}>No, keep in inbox</button>
          <button className="btn-link" onClick={handleCancel}>Stay in chat</button>
        </div>
      </div>
    </div>
  )
}
