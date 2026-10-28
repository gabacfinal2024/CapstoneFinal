import { statusLabel, statusClass } from '../utils/helpers'
import './StatusBadge.css'

export default function StatusBadge({ status, showPercent, percent, size = 'md' }) {
  return (
    <span className={`status-badge-ui ${statusClass(status)} size-${size}`}>
      <span className="status-dot-inline" />
      {statusLabel(status)}
      {showPercent && status !== 'UNKNOWN' && percent != null && ` · ${percent}%`}
    </span>
  )
}
