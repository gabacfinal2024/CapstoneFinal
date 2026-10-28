import { RefreshCw } from 'lucide-react'
import './ErrorNotice.css'

/** Friendly error box with an optional Retry button. */
export default function ErrorNotice({ message, onRetry, retrying = false, retryLabel = 'Try again', hint }) {
  if (!message) return null
  return (
    <div className="notice error error-notice" role="alert">
      <div className="error-notice__text">
        <span>{message}</span>
        {hint && <small>{hint}</small>}
      </div>
      {onRetry && (
        <button type="button" className="error-notice__btn" onClick={onRetry} disabled={retrying}>
          <RefreshCw size={14} className={retrying ? 'spin' : ''} /> {retrying ? 'Retrying…' : retryLabel}
        </button>
      )}
    </div>
  )
}
