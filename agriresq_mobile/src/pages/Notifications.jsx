import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useNotifications } from '../context/NotificationsContext'
import { formatDateTime } from '../utils/helpers'
import './Notifications.css'

const TYPE_ICONS = {
  IOT_ALERT: '🌡️',
  STATUS_CHANGE: '⚠️',
  NEW_MESSAGE: '💬',
  MARKETPLACE: '🛒',
  ORDER_UPDATE: '📦',
  PRICE_DROP: '💰',
}

export default function Notifications() {
  const { openNotification, refresh, unread, alertsSupported, alertsPermission, enableAlerts } = useNotifications()
  const [notifs, setNotifs] = useState([])

  const load = () => api.notifications().then(setNotifs).catch(() => setNotifs([]))

  // The provider already listens for new notifications (realtime + refresh) and keeps `unread` current,
  // so reload the full list whenever it changes instead of opening a second subscription.
  useEffect(() => {
    load()
  }, [unread])

  const markAll = async () => {
    await api.markAllRead()
    refresh()
    setNotifs((n) => n.map((x) => ({ ...x, is_read: true })))
  }

  return (
    <div className="app-shell">
      <div className="page page-no-nav notifications">
        <header className="notif-header">
          <Link to="/home" className="back-link">← Back</Link>
          <div className="notif-title-row">
            <h1>Notifications</h1>
            <button onClick={markAll} className="mark-read">Mark all read</button>
          </div>
          <p className="notif-sub">In-app alerts only — no SMS/email</p>
          {alertsSupported && alertsPermission === 'default' && (
            <button type="button" className="alerts-btn" onClick={enableAlerts}>🔔 Alert me on this phone when the app is in the background</button>
          )}
        </header>

        {notifs.length ? (
          notifs.map((n) => (
            <button type="button" key={n.id} className={`notif-card card ${n.is_read ? '' : 'unread'}`} onClick={() => openNotification(n)}>
              <span className="notif-icon">{TYPE_ICONS[n.notification_type] || '🔔'}</span>
              <div>
                <strong>{n.title}</strong>
                <p>{n.message}</p>
                <span className="notif-time">{formatDateTime(n.created_at)}</span>
              </div>
            </button>
          ))
        ) : (
          <div className="empty-state card"><p>No notifications yet.</p></div>
        )}
      </div>
    </div>
  )
}
