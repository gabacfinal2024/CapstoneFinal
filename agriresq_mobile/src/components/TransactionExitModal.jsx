import './TransactionExitModal.css'

export default function TransactionExitModal({ open, onConfirm, onCancel, busy, error }) {
  if (!open) return null


  return (
    <div className="exit-modal-overlay">
      <div className="exit-modal card">
        <h3>Transaction completed?</h3>
        <p>If yes, this chat will be moved to archives. If not, it stays in your inbox.</p>


        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="exit-modal-actions">
          <button className="btn btn-green" disabled={busy} onClick={() => onConfirm(true)}>Yes, completed</button>
          <button className="btn btn-outline-dark" disabled={busy} onClick={() => onConfirm(false)}>No, keep in inbox</button>
          <button className="btn-link" disabled={busy} onClick={onCancel}>Stay in chat</button>
        </div>
      </div>
    </div>
  )
}
