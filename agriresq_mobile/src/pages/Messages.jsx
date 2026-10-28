import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import BottomNav from '../components/BottomNav'
import StatusBadge from '../components/StatusBadge'
import { CROP_LABELS, formatDateTime } from '../utils/helpers'
import { useAuth } from '../context/AuthContext'
import './Messages.css'

export default function Messages() {
  const { user } = useAuth()
  const [tab, setTab] = useState('inbox')
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.chatThreads(tab === 'archived')
      .then(setThreads)
      .catch(() => setThreads([]))
      .finally(() => setLoading(false))
  }, [tab])

  return (
    <div className="app-shell">
      <div className="page messages">
        <h1 className="section-title">Messages</h1>
        <div className="msg-tabs">
          <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>Inbox</button>
          <button className={tab === 'archived' ? 'active' : ''} onClick={() => setTab('archived')}>Archived</button>
        </div>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : threads.length ? (
          threads.map((t) => {
            const product = t.marketplace_listings?.products
            const other = user?.id === t.operator_id ? t.buyer : t.operator
            return (
              <Link key={t.id} to={`/chat/${t.id}`} className="thread-card card">
                <div className="thread-avatar">💬</div>
                <div className="thread-body">
                  <div className="thread-top">
                    <strong>{CROP_LABELS[product?.crop_type] || `Chat #${t.id}`}{other?.full_name ? ` · ${other.full_name}` : ''}</strong>
                    <span>{formatDateTime(t.updated_at)}</span>
                  </div>
                  {product && (
                    <StatusBadge status={product.freshness_status} showPercent percent={product.freshness_percent} size="sm" />
                  )}
                  {t.transaction_completed && <span className="completed-tag">✓ Completed</span>}
                </div>
              </Link>
            )
          })
        ) : (
          <div className="empty-state card">
            <p>{tab === 'inbox' ? 'No active chats.' : 'No archived transactions.'}</p>
            <p className="muted">Use Chat Now on marketplace listings. If you're signed in as a Stall Operator, switch to Rescue Buyer in your Profile to start chats.</p>
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-outline" onClick={() => window.location.href = '/marketplace'}>Browse Listings</button>
              <button className="btn btn-outline" onClick={() => window.location.href = '/profile'} style={{ marginLeft: 8 }}>Profile</button>
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
