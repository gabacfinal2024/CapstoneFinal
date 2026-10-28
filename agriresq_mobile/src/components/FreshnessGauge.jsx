import { Link } from 'react-router-dom'
import { statusLabel, statusClass, formatDays } from '../utils/helpers'
import './FreshnessGauge.css'

export default function FreshnessGauge({ percent = 88, status = 'GREEN', daysLeft }) {
  const color = status === 'GREEN' ? 'var(--fresh)' : status === 'AMBER' ? 'var(--at-risk)' : 'var(--spoiled)'
  const circumference = 2 * Math.PI * 54
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="freshness-gauge card">
      <div className="gauge-ring">
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r="54" fill="none" stroke="var(--gray-100)" strokeWidth="10" />
          <circle
            cx="65" cy="65" r="54" fill="none"
            stroke={color} strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 65 65)"
          />
        </svg>
        <div className="gauge-center">
          <span className="gauge-percent">{percent}%</span>
          <span className={`status-dot ${statusClass(status)}`} />
        </div>
      </div>
      <div className="gauge-info">
        <h3>Freshness Level: {statusLabel(status)}</h3>
        {daysLeft != null && (
          <p className="gauge-days">{formatDays(daysLeft) === 'Rotten' ? 'Rotten' : `${formatDays(daysLeft)} to spoil (estimate)`}</p>
        )}
        {daysLeft != null && (
          <Link to="/basis" className="gauge-basis-link">How is this calculated?</Link>
        )}
      </div>
    </div>
  )
}
