import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import { CROP_LABELS, formatCurrency, formatDays, formatDateTime } from '../utils/helpers'
import FreshnessGauge from '../components/FreshnessGauge'
import FreshnessCheck from '../components/FreshnessCheck'
import ProductImage from '../components/ProductImage'
import StatusBadge from '../components/StatusBadge'
import useBatchAnalysis from '../hooks/useBatchAnalysis'
import './ProduceDetail.css'

export default function ProduceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isBuyer = user?.role === 'RESCUE_BUYER'
  const [listing, setListing] = useState(null)
  const [listingError, setListingError] = useState('')
  const [openingChat, setOpeningChat] = useState(false)
  const [chatError, setChatError] = useState('')
  const [rating, setRating] = useState(null)
  // Buyers get the freshness check (calculated days to spoil + camera confidence) and never any sensor reading;
  // only the listing's own operator sees the full analysis including the climate.
  const isOwner = !!user && !!listing?.operator_id && user.id === listing.operator_id
  const analysis = useBatchAnalysis(listing?.products?.id, { enabled: !!user })

  useEffect(() => {
    api.listing(id)
      .then((l) => { setListing(l); setListingError('') })
      .catch((err) => { console.error(err); setListing(null); setListingError(err.message || 'Listing not found or unavailable') })
  }, [id])

  useEffect(() => {
    if (listing?.operator_id) api.operatorRating(listing.operator_id).then(setRating).catch(() => setRating(null))
  }, [listing?.operator_id])

  const openChat = async () => {
    setOpeningChat(true)
    setChatError('')
    try {
      const thread = await api.startChat(id)
      if (!thread?.id) throw new Error('Could not open a message thread for this listing.')
      navigate(`/chat/${thread.id}`)
    } catch (err) {
      setChatError(err.message || String(err))
    }
    setOpeningChat(false)
  }

  if (listingError) {
    return (
      <div className="page page-no-nav">
        <p>{listingError}</p>
        <p><Link to="/marketplace">← Back to listings</Link></p>
      </div>
    )
  }
  if (!listing) return <div className="page page-no-nav"><p className="muted">Loading…</p></div>

  const product = listing.products
  const crop = product?.crop_type
  const qty = Number(product?.quantity_kg) || 0
  const perKg = product?.current_price_per_kg ?? (qty ? listing.listed_price / qty : listing.listed_price)
  const wasPerKg = Number(product?.base_price_per_kg) || (qty ? listing.original_price / qty : listing.original_price)

  return (
    <div className="app-shell">
      <div className="produce-detail">
        <ProductImage src={product?.image_url} crop={crop} className="produce-hero" />
        <div className="produce-body">
          <Link to="/marketplace" className="back-link">← Listings</Link>
          <div className="detail-title-row">
            <h1>{CROP_LABELS[crop] || 'Produce'}</h1>
            <StatusBadge status={product?.freshness_status} showPercent percent={product?.freshness_percent} />
          </div>
          <p className="produce-price-lg">
            {formatCurrency(perKg)}<small>/kg</small>
            {listing.discount_percent > 0 && <span className="strike-original">was {formatCurrency(wasPerKg)}</span>}
          </p>
          {qty > 0 && <p className="produce-total">{qty} kg available · {formatCurrency(listing.listed_price)} for the whole batch</p>}
          <FreshnessGauge percent={product?.freshness_percent} status={product?.freshness_status} daysLeft={product?.predicted_shelf_life} />

          <section className="card detail-block">
            <h3>Batch Info</h3>
            <div className="info-row"><span>Quantity</span><strong>{qty ? `${qty} kg` : '—'}</strong></div>
            <div className="info-row"><span>Harvested</span><strong>{product?.harvest_datetime ? formatDateTime(product.harvest_datetime) : '—'}</strong></div>
            <div className="info-row"><span>Price per kg</span><strong>{formatCurrency(perKg)}</strong></div>
            <div className="info-row"><span>Days to spoil</span><strong>{formatDays(product?.predicted_shelf_life)}</strong></div>
          </section>

          <FreshnessCheck
            mode={isOwner ? 'operator' : 'buyer'}
            analysis={analysis.analysis}
            loading={analysis.loading}
            error={analysis.error}
            signedIn={!!user}
            fallback={{ days: product?.predicted_shelf_life, status: product?.freshness_status, percent: product?.freshness_percent }}
          />

          <section className="card detail-block seller-block">
            <div className="seller-header">
              <h3>Stall Operator</h3>
              <span className="verified">✓ Verified</span>
            </div>
            <p className="seller-name">{listing.profiles?.full_name || 'Vendor'}{listing.profiles?.stall_number ? ` · Stall ${listing.profiles.stall_number}` : ''}</p>
            {rating && <p className="seller-rating">★ {rating.average.toFixed(1)} <small>({rating.count} rating{rating.count === 1 ? '' : 's'})</small></p>}
            <p className="seller-note">{product?.notes || 'IoT-monitored surplus from Bulua Westbound Terminal.'}</p>
          </section>

          <section className="card detail-block">
            <h3>📍 Pickup Location</h3>
            <div className="map-placeholder"><span>{product?.pickup_location || 'Bulua West Terminal, Cagayan de Oro'}</span></div>
          </section>

          {isBuyer && (
            <section className="card detail-block inline-chat-block">
              <h3>Message the vendor</h3>
              <button type="button" className="send-message-btn" onClick={openChat} disabled={openingChat}>
                {openingChat ? 'Opening messages…' : 'Send message'}
              </button>
              {chatError && <p className="error-text">Chat unavailable: {chatError}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
