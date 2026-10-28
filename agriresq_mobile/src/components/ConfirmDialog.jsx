import './ConfirmDialog.css'

export default function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
  if (!open) return null
  return (
    <div className="confirm-overlay" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <div className="confirm-card card">
        <button type="button" className="confirm-close" aria-label="Close" onClick={onCancel}>✕</button>
        <h3>{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="btn btn-outline" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn btn-green" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
