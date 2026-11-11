import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Bookmark, BookmarkCheck, CheckCircle2, ScanLine } from 'lucide-react'
import { CROP_LABELS, formatCurrency, toPercent } from '../utils/helpers'
import StatusBadge from './StatusBadge'
import ProductImage from './ProductImage'
import ConfirmDialog from './ConfirmDialog'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import './ProduceCard.css'

export default function ProduceCard({ listing, isSaved = false, onUnsave }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const product = listing.products || listing.batch || listing.crop_batch
  const crop = product?.crop_type
  const qty = Number(product?.quantity_kg) || 0
  // listed_price is the price of the whole batch; buyers compare per kilo
  const perKg = product?.current_price_per_kg ?? (qty ? listing.listed_price / qty : listing.listed_price)
  const isOwner = user?.role === 'STALL_OPERATOR' && user.id === listing.operator_id
  const productId = product?.id || listing.product_id
  const mlConfidence = toPercent(product?.ml_confidence ?? listing.ml_confidence)

  // The whole card is a link: every button inside must stop the click from opening the listing.
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn() }

  const chat = async () => {
    try {
      const thread = await api.startChat(listing.id)
      navigate(`/chat/${thread.id}`)
    } catch (err) {
      setNote(err.message)
    }
  }
  const save = async () => {
    setSaving(true)
    try {
      await api.saveListing(listing.id)
      setNote('Listing saved to your bookmarks')
    } catch (err) {
      setNote(`Could not save listing: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }
  const unsave = async () => {
    setSaving(true)
    try {
      await api.removeSavedListing(listing.id)
      setNote('Listing removed from saved items')
      onUnsave?.(listing.id)
    } catch (err) {
      setNote(`Could not remove saved listing: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }
  const doRemove = async () => {
    try {
      await api.removeBatch(productId)
      window.location.reload()
    } catch (err) {
      setConfirmRemove(false)
      setNote('Could not remove: ' + (err.message || err))
    }
  }
  const doFinalize = async () => {
    try {
      await api.markListingSold(listing.id)
      window.location.reload()
    } catch (err) {
      setConfirmFinalize(false)
      setNote('Could not mark as sold: ' + (err.message || err))
    }
  }

  return (
    <>
      <Link to={`/produce/${listing.id}`} className="produce-card card">
        <ProductImage src={product?.image_url} crop={crop} />
        <div className="produce-info">
          <div className="produce-card__topline">
            <h4>{CROP_LABELS[crop] || 'Produce'}</h4>
            <div className="produce-card__readings">
              <StatusBadge status={product?.freshness_status} showPercent percent={product?.freshness_percent} size="sm" />
              {mlConfidence != null && <span className="ml-reading"><ScanLine size={12} /> ML {mlConfidence}%</span>}
            </div>
          </div>
          <p className="producer-name">{listing.profiles?.full_name || 'Vendor'}</p>
          <p className="produce-price">
            {formatCurrency(perKg)}<small>/kg</small>
            {listing.discount_percent > 0 && <span className="discount-tag">-{listing.discount_percent}%</span>}
          </p>
          <p className="produce-qty">{qty ? `${qty} kg available` : ''}</p>
          <p className="produce-loc">📍 {product?.pickup_location || 'Bulua West Terminal'}</p>
          <div className="card-actions">
            {!user && <button type="button" className="btn btn-sm" onClick={stop(() => navigate('/login'))}>Sign in to chat</button>}
            {user?.role === 'RESCUE_BUYER' && <button type="button" className="btn btn-sm" onClick={stop(chat)}>Send message</button>}
            {isOwner && (
              <>
                <button type="button" className="btn btn-sm" onClick={stop(() => setConfirmFinalize(true))}>Mark sold</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={stop(() => setConfirmRemove(true))}>Delete</button>
              </>
            )}
            {user?.role === 'RESCUE_BUYER' && (
              <button
                type="button"
                className={`btn btn-save-listing btn-sm${isSaved ? ' is-saved' : ''}`}
                onClick={stop(isSaved ? unsave : save)}
                disabled={saving}
                aria-pressed={isSaved}
              >
                {saving ? 'Please wait…' : isSaved ? <><BookmarkCheck size={15} /> Remove saved</> : <><Bookmark size={15} /> Save listing</>}
              </button>
            )}
            {user?.role === 'RESCUE_BUYER' && isSaved && (
              <button type="button" className="btn btn-view-listing btn-sm" onClick={stop(() => navigate(`/produce/${listing.id}`))}>
                View listing
              </button>
            )}
          </div>
          {note && <p className="card-note" role="status"><CheckCircle2 size={14} />{note}</p>}
        </div>
      </Link>
      <ConfirmDialog open={confirmRemove} title="Delete batch" message="Delete this batch and its listing? This action cannot be undone." onConfirm={doRemove} onCancel={() => setConfirmRemove(false)} confirmLabel="Delete" danger />
      <ConfirmDialog open={confirmFinalize} title="Mark listing as sold" message="Mark this listing as sold? It will be removed from the marketplace." onConfirm={doFinalize} onCancel={() => setConfirmFinalize(false)} confirmLabel="Mark sold" />
    </>
  )
}
