import { useEffect, useState } from 'react'
import PageTitle from '../components/PageTitle'
import { useParams, useNavigate } from 'react-router-dom'
import { MapPin, MessageCircle } from 'lucide-react'
import { BackLink } from '../context/BackNavigationContext'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import { CROP_LABELS, formatCurrency, formatDays } from '../utils/helpers'
import FreshnessGauge from '../components/FreshnessGauge'
import FreshnessCheck from '../components/FreshnessCheck'
import ProductImage from '../components/ProductImage'
import StatusBadge from '../components/StatusBadge'
import useBatchAnalysis from '../hooks/useBatchAnalysis'
import './ProduceDetail.css'

export default function ProduceDetail() {
  const { id, productId } = useParams()
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
    let current = true
    setListing(null)
    setListingError('')
    const request = productId ? api.getListingByProduct(productId) : api.listing(id)
    request.then((result) => {
      if (!current) return
      if (result?.products) setListing(result)
      else setListingError('This listing is no longer available.')
    }).catch((error) => {
      if (current) setListingError(error.message || 'This listing is no longer available.')
    })
    return () => { current = false }
  }, [id, productId])

  useEffect(() => {
    if (listing?.operator_id) api.operatorRating(listing.operator_id).then(setRating).catch(() => setRating(null))
  }, [listing?.operator_id])

  const openChat = async () => {
    setOpeningChat(true)
    setChatError('')
    try {
      const thread = await api.startChat(listing.id)
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
        <p><BackLink to={productId ? '/home' : '/marketplace'}>← Back</BackLink></p>
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
      <main className="produce-detail">
        <div className="produce-visual">
          <ProductImage src={product?.image_url} crop={crop} className="produce-hero" />
          <span className="product-image-caption">Sample photo</span>
          <BackLink to={productId ? '/home' : '/marketplace'} className="detail-back">← Back</BackLink>
        </div>
        <div className="produce-body">
          <div className="page-title-header detail-title-row">
            <PageTitle>{CROP_LABELS[crop] || 'Produce'}</PageTitle>
            <StatusBadge status={product?.freshness_status} showPercent percent={product?.freshness_percent} />
          </div>
          <p className="produce-price-lg">
            {formatCurrency(perKg)}<small>/kg</small>
            {listing.discount_percent > 0 && <span className="strike-original">was {formatCurrency(wasPerKg)}</span>}
          </p>
          {qty > 0 && <p className="produce-total">{qty} kg available · {formatCurrency(listing.listed_price)} for the whole batch</p>}
          <section className="card pickup-card" aria-labelledby="pickup-title">
            <div className="pickup-card__location">
              <span className="pickup-card__icon"><MapPin size={21} aria-hidden="true" /></span>
              <div>
                <h2 id="pickup-title">Pickup location</h2>
                <p>{product?.pickup_location || 'Bulua West Terminal, Cagayan de Oro'}</p>
              </div>
            </div>
            {isBuyer && (
              <button type="button" className="send-message-btn" onClick={openChat} disabled={openingChat}>
                <MessageCircle size={18} aria-hidden="true" />
                {openingChat ? 'Opening messages…' : 'Send message'}
              </button>
            )}
            {chatError && <p className="error-text" role="alert">{chatError}</p>}
          </section>
          <FreshnessGauge percent={product?.freshness_percent} status={product?.freshness_status} daysLeft={product?.predicted_shelf_life} />

          <div className="detail-grid">
            <section className="card detail-block">
              <h3>Batch information</h3>
              <div className="info-row"><span>Quantity</span><strong>{qty ? `${qty} kg` : '—'}</strong></div>
              <div className="info-row"><span>Harvested</span><strong>{product?.harvest_datetime ? new Date(product.harvest_datetime).toLocaleString('en-PH') : 'Date and time unknown'}</strong></div>
              <div className="info-row"><span>Added to AgriResQ</span><strong>{product?.created_at ? new Date(product.created_at).toLocaleString('en-PH') : '—'}</strong></div>
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
              showCamera={false}
              showHeatUnits={false}
            />

            <section className="card detail-block seller-block">
              <div className="seller-header">
                <h3>Stall operator</h3>
                {product?.profiles?.is_verified && <span className="verified">✓ Verified</span>}
              </div>
              <p className="seller-name">{listing.profiles?.full_name || 'Vendor'}{listing.profiles?.stall_number ? ` · Stall ${listing.profiles.stall_number}` : ''}</p>
              {rating && <p className="seller-rating">★ {rating.average.toFixed(1)} <small>({rating.count} rating{rating.count === 1 ? '' : 's'})</small></p>}
              {product?.notes && <p className="seller-note">{product.notes}</p>}
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
