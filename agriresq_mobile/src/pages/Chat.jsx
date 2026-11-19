import { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../context/NotificationsContext'
import { useBackNavigation } from '../context/BackNavigationContext'
import usePolling from '../hooks/usePolling'
import { ArrowLeft, MapPin, Send, Store } from 'lucide-react'
import { CROP_LABELS, formatCurrency, formatTime } from '../utils/helpers'
import StatusBadge from '../components/StatusBadge'
import TransactionExitModal from '../components/TransactionExitModal'
import RatingModal from '../components/RatingModal'
import './Chat.css'

export default function Chat() {
  const { id } = useParams()
  return <ChatThread key={id} id={id} />
}

function ChatThread({ id }) {
  const navigate = useNavigate()
  const { goBack, registerGuard } = useBackNavigation()
  const { user } = useAuth()
  const { acknowledgeThread } = useNotifications()
  const [thread, setThread] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showExitModal, setShowExitModal] = useState(false)
  const [showRating, setShowRating] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [exitError, setExitError] = useState('')
  const bottomRef = useRef(null)
  const listing = thread?.marketplace_listings
  const product = listing?.products
  const cropName = CROP_LABELS[product?.crop_type] || 'Produce listing'
  const quantity = Number(product?.quantity_kg) || 0
  const perKg = product?.current_price_per_kg ?? (quantity ? Number(listing?.listed_price || 0) / quantity : listing?.listed_price)
  const pickupLocation = product?.pickup_location || listing?.profiles?.market_location || 'Pickup location to be confirmed'
  const stall = listing?.profiles?.stall_number ? `Stall ${listing.profiles.stall_number}` : 'stall'
  const buyerReplies = [
    `Hi, I'm interested in your ${cropName} (${quantity || 'available'} kg at ${formatCurrency(perKg)}/kg). Is it still available?`,
    `I'd like to arrange pickup for ${cropName} at ${pickupLocation}, ${stall}. What time works for you?`,
  ]
  const operatorReplies = [
    `I can confirm ${quantity || 'the listed quantity'} kg of ${cropName} at ${formatCurrency(perKg)}/kg. Pickup is at ${pickupLocation}, ${stall}.`,
    `Let's arrange a pickup time for ${cropName} at ${pickupLocation}, ${stall}. What time works for you?`,
  ]
  const quickReplies = user?.role === 'STALL_OPERATOR' ? operatorReplies : buyerReplies

  const load = () => api.chatThread(id).then(setThread).catch(console.error)
  usePolling(load, 5000)

  const acknowledgedThrough = useRef(null)
  useEffect(() => {
    if (document.hidden || !thread) return
    const latestIncoming = thread.messages.slice().reverse().find((message) => message.sender_id !== user?.id)
    const through = latestIncoming?.sent_at
    if (!through || (acknowledgedThrough.current && acknowledgedThrough.current >= through)) return
    acknowledgedThrough.current = through
    acknowledgeThread(id, through).catch((err) => {
      if (acknowledgedThrough.current === through) acknowledgedThrough.current = null
      console.error('Could not mark chat as read', err)
    })
  }, [id, thread, user?.id, acknowledgeThread])

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


  useLayoutEffect(() => registerGuard(() => {
    if (completing) return true
    if (!showExitModal) return false
    setExitError('')
    setShowExitModal(false)
    return true
  }), [completing, registerGuard, showExitModal])

  const handleExitConfirm = async (completed) => {
    setCompleting(true)
    setExitError('')
    try {
      await api.completeTransaction(id, completed)
    } catch (err) {
      setExitError(err.message)
      return
    } finally {
      setCompleting(false)
    }
    if (completed) acknowledgeThread(id).catch((err) => console.error('Could not mark archived chat as read', err))
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
            <button type="button" className="back-btn" onClick={() => goBack()} aria-label="Back"><ArrowLeft size={20} /></button>
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
              <span><Store size={13} /> {listing.profiles?.full_name || 'Stall operator'} · {stall}</span>
              <span>{quantity ? `${quantity} kg` : 'Quantity unavailable'} · {formatCurrency(perKg)}/kg · {formatCurrency(listing.listed_price)} total</span>
              <span><MapPin size={13} /> {pickupLocation}</span>
              {product && <StatusBadge status={product.freshness_status} showPercent percent={product.freshness_percent} size="sm" />}
              <span className="chat-listing-link">View listing details</span>
            </span>
          </Link>
        )}
        <div className="chat-quick-replies" aria-label="Suggested messages">
          {quickReplies.map((reply, index) => (
            <button key={reply} type="button" onClick={() => setText(reply)}>
              {index === 0 ? (user?.role === 'STALL_OPERATOR' ? 'Confirm details' : 'Ask availability') : 'Arrange pickup'}
            </button>
          ))}
        </div>
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
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." aria-label="Message" />
          <button type="submit" disabled={sending || !text.trim()}><Send size={16} /> Send</button>
        </form>
      </div>
      <RatingModal open={showRating} threadId={id} operatorName={thread?.operator?.full_name} onDone={() => navigate('/messages')} />
      <TransactionExitModal
        open={showExitModal}
        onConfirm={handleExitConfirm}
        onCancel={() => { setExitError(''); setShowExitModal(false) }}
        busy={completing}
        error={exitError}
      />
    </div>
  )
}
