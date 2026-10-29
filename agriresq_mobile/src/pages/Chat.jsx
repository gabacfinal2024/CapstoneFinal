import { useEffect, useState, useRef } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import { CROP_LABELS, formatTime } from '../utils/helpers'
import TransactionExitModal from '../components/TransactionExitModal'
import RatingModal from '../components/RatingModal'
import './Chat.css'

export default function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [thread, setThread] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showExitModal, setShowExitModal] = useState(false)
  const [showRating, setShowRating] = useState(false)
  const bottomRef = useRef(null)
  const listing = thread?.marketplace_listings
  const product = listing?.products
  const cropName = CROP_LABELS[product?.crop_type] || 'Produce listing'

  const load = () => api.chatThread(id).then(setThread).catch(console.error)

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [id])

  // scroll down only when a message arrives, not on every 5 s refresh (it jumped while reading history)
  const shown = useRef(0)
  useEffect(() => {
    const n = thread?.messages?.length || 0
    if (n !== shown.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    shown.current = n
  }, [thread?.messages])

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      await api.sendMessage(id, text.trim())
      setText('')
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSending(false)
    }
  }


  const handleBackWithPref = () => {
    try {
      const key = `agriresq.no_transaction_exit_reminder.${user?.id || 'anon'}`
      const val = localStorage.getItem(key)
      if (val === '1') {
        navigate('/messages')
        return
      }
    } catch (e) {
      // ignore storage errors
    }
    setShowExitModal(true)
  }

  const handleExitConfirm = async (completed) => {
    await api.completeTransaction(id, completed)
    setShowExitModal(false)
    // a buyer who finished the deal can rate the stall operator (once)
    if (completed && user?.role === 'RESCUE_BUYER' && !(await api.myRatingForThread(id))) {
      setShowRating(true)
      return
    }
    navigate('/messages')
  }

  return (
    <div className="app-shell">
      <div className="chat-page">
        <header className="chat-header">
          <div className="chat-header-left">
            <button type="button" className="back-btn" onClick={handleBackWithPref}>←</button>
            <h2>{cropName} · Rescue Deal</h2>
          </div>
          <button type="button" className="complete-btn" onClick={() => setShowExitModal(true)}>
            {user?.role === 'STALL_OPERATOR' ? 'Complete & Mark Sold' : 'Mark Complete'}
          </button>
        </header>
        {listing && (
          <Link to={`/produce/${listing.id}`} className="chat-listing-card">
            {product?.image_url && <img src={product.image_url} alt={cropName} />}
            <span className="chat-listing-details">
              <strong>{cropName}</strong>
              <span>
                {product?.quantity_kg != null ? `${product.quantity_kg} kg` : 'Quantity unavailable'}
                {' · '}
                ₱{Number(listing.listed_price || product?.current_price_per_kg || 0).toFixed(2)}/kg
              </span>
              {product?.pickup_location && <span>Pickup: {product.pickup_location}</span>}
              <span className="chat-listing-link">View listing details</span>
            </span>
          </Link>
        )}
        <div className="chat-messages">
          {thread?.messages?.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.sender_id === user?.id ? 'mine' : 'theirs'}`}
            >
              {m.message_text}
              <span className="bubble-time">{formatTime(m.sent_at)}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form className="chat-input" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." />
          <button type="submit" disabled={sending}>Send</button>
        </form>
      </div>
      <RatingModal open={showRating} threadId={id} operatorName={thread?.operator?.full_name} onDone={() => navigate('/messages')} />
      <TransactionExitModal
        open={showExitModal}
        onConfirm={handleExitConfirm}
        onCancel={() => setShowExitModal(false)}
        userId={user?.id}
      />
    </div>
  )
}
