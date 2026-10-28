import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { CROP_LABELS, formatCurrency } from '../utils/helpers'
import StatusBadge from './StatusBadge'
import ProductImage from './ProductImage'
import ConfirmDialog from './ConfirmDialog'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import './ProduceCard.css'

export default function ProduceCard({ listing }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [note, setNote] = useState('')

  const product = listing.products || listing.batch || listing.crop_batch
  const crop = product?.crop_type
  const qty = Number(product?.quantity_kg) || 0
  // listed_price is the price of the whole batch; buyers compare per kilo
  const perKg = product?.current_price_per_kg ?? (qty ? listing.listed_price / qty : listing.listed_price)
  const isOwner = user?.role === 'STALL_OPERATOR' && user.id === listing.operator_id
  const productId = product?.id || listing.product_id

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
    try {
      await api.saveListing(listing.id)
      setNote('Saved to your bookmarks')
    } catch (err) {
      console.warn(err)
      const saved = JSON.parse(localStorage.getItem('saved_listings') || '[]')
      if (!saved.includes(listing.id)) saved.push(listing.id)
      localStorage.setItem('saved_listings', JSON.stringify(saved))
      setNote('Saved on this phone')
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
          <h4>{CROP_LABELS[crop] || 'Produce'}</h4>
          <p className="producer-name">{listing.profiles?.full_name || 'Vendor'}</p>
          <p className="produce-price">
            {formatCurrency(perKg)}<small>/kg</small>
            {listing.discount_percent > 0 && <span className="discount-tag">-{listing.discount_percent}%</span>}
          </p>
          <p className="produce-qty">{qty ? `${qty} kg available` : ''}</p>
          <p className="produce-loc">📍 {product?.pickup_location || 'Bulua West Terminal'}</p>
          <StatusBadge status={product?.freshness_status} showPercent percent={product?.freshness_percent} size="sm" />
          <div className="card-actions">
            {!user && <button type="button" className="btn btn-sm" onClick={stop(() => navigate('/login'))}>Sign in to chat</button>}
            {user?.role === 'RESCUE_BUYER' && <button type="button" className="btn btn-sm" onClick={stop(chat)}>Send message</button>}
            {isOwner && (
              <>
                <button type="button" title="Finalize Sale" className="icon-btn green" onClick={stop(() => setConfirmFinalize(true))}>✓</button>
                <button type="button" title="Remove Batch" className="icon-btn danger" onClick={stop(() => setConfirmRemove(true))}>🗑</button>
              </>
            )}
            {!isOwner && <button type="button" className="btn btn-outline btn-sm" onClick={stop(save)}>🔖 Save</button>}
          </div>
          {note && <p className="card-note">{note}</p>}
        </div>
      </Link>
      <ConfirmDialog open={confirmRemove} title="Remove Batch" message="Remove this batch? This will delete the product and its listing." onConfirm={doRemove} onCancel={() => setConfirmRemove(false)} confirmLabel="Remove" />
      <ConfirmDialog open={confirmFinalize} title="Finalize Sale" message="Mark this listing as SOLD? This will remove it from the marketplace." onConfirm={doFinalize} onCancel={() => setConfirmFinalize(false)} confirmLabel="Mark Sold" />
    </>
  )
}
