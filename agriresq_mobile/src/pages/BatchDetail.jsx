import { useRef, useState } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import { Camera, Loader2 } from 'lucide-react'
import { api } from '../api/supabaseApi'
import { CROP_LABELS, formatCurrency, formatDateTime, formatDays } from '../utils/helpers'
import FreshnessGauge from '../components/FreshnessGauge'
import FreshnessCheck from '../components/FreshnessCheck'
import ProductImage from '../components/ProductImage'
import StatusBadge from '../components/StatusBadge'
import { deviceApi } from '../api/deviceApi'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { publishProductPhoto } from '../utils/photo'
import useBatchAnalysis from '../hooks/useBatchAnalysis'
import usePolling from '../hooks/usePolling'
import './BatchDetail.css'

const TIMELINE = ['At Stall', 'Camera Vision / AI Analysis', 'Listed']

export default function BatchDetail() {
  const { id } = useParams()
  const location = useLocation()
  const { user } = useAuth()
  const photoInput = useRef(null)
  const [batch, setBatch] = useState(null)
  const [listing, setListing] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [detection, setDetection] = useState(null)
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [photoMessage, setPhotoMessage] = useState('')
  const [updatingPhoto, setUpdatingPhoto] = useState(false)
  const analysis = useBatchAnalysis(id)

  // polls only while the tab is visible and stops on unmount
  usePolling(() => {
    api.batch(id).then((b) => { setBatch(b); setError('') }).catch((err) => { console.error(err); setError(err.message || 'Could not load this batch.') })
    api.getListingByProduct(id).then(setListing).catch((err) => { console.error(err); setListing(null) })
    api.predict(id).then(setPrediction).catch(console.error)
    api.batchDetectionPercent(id).then(setDetection).catch(() => setDetection(null))
  }, 30000)

  if (!batch) {
    return (
      <div className="app-shell">
        <div className="page page-no-nav">
          <Link to="/home" className="back-link">← Back to Dashboard</Link>
          {location.state?.warning && <p className="notice warning" role="status">{location.state.warning}</p>}
          {error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}
        </div>
      </div>
    )
  }
  const crop = batch.crop_type
  const step = batch.is_listed ? 2 : 1
  const canUpdatePhoto = user?.role === 'STALL_OPERATOR' && user.id === batch.operator_id &&
    batch.is_listed && listing?.listing_status === 'ACTIVE'

  const updatePhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUpdatingPhoto(true)
    setPhotoError('')
    setPhotoMessage('')
    try {
      const scan = await deviceApi.analyzePhoto(file, crop, { source: 'PHONE', productId: id })
      if (scan.detected !== true || scan.crop_mismatch || scan.low_confidence ||
          String(scan.detected_crop || '').toUpperCase() !== crop) {
        throw new Error(scan.message || 'The photo must clearly show the same supported crop before it can replace the listing photo.')
      }
      const { data: { user: sessionUser }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(authError.message)
      const imageUrl = await publishProductPhoto(supabase, file, sessionUser?.id)
      const updated = await api.updateActiveBatchFromPhoto(id, {
        image_url: imageUrl,
        freshness_status: scan.freshness_status,
        freshness_percent: scan.freshness_percent,
        predicted_shelf_life: scan.days_to_spoil,
        ml_confidence: scan.ml_confidence,
      })
      setBatch((current) => ({ ...current, ...updated }))
      setPhotoMessage('Photo and freshness details updated. The original listing date is unchanged.')
    } catch (err) {
      setPhotoError(err.message || 'Could not update this listing photo.')
    } finally {
      setUpdatingPhoto(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="page batch-detail page-no-nav" style={{ paddingBottom: 24 }}>
        <Link to="/home" className="back-link">← Back to Dashboard</Link>
        <ProductImage src={batch.image_url} crop={crop} className="detail-hero" />
        <div className="detail-title-row">
          <h1>{CROP_LABELS[crop]} #{batch.id}</h1>
          <StatusBadge status={batch.freshness_status} showPercent percent={batch.freshness_percent} />
        </div>

        <FreshnessGauge
          percent={batch.freshness_percent}
          status={batch.freshness_status}
          daysLeft={batch.predicted_shelf_life}
        />

        <section className="detail-section card">
          <h3>Batch Info</h3>
          <div className="info-grid">
            <div><span>Quantity</span><strong>{batch.quantity_kg} kg</strong></div>
            <div><span>Harvested</span><strong>{batch.harvest_datetime ? new Date(batch.harvest_datetime).toLocaleString('en-PH') : 'Date and time unknown'}</strong></div>
            <div><span>Added to AgriResQ</span><strong>{batch.created_at ? new Date(batch.created_at).toLocaleString('en-PH') : '—'}</strong></div>
            <div><span>First listed</span><strong>{listing?.created_at ? formatDateTime(listing.created_at) : 'Not listed'}</strong></div>
            <div><span>Base Price</span><strong>{formatCurrency(batch.base_price_per_kg)}/kg</strong></div>
            <div><span>Current Price</span><strong>{formatCurrency(batch.current_price_per_kg)}/kg</strong></div>
            {batch.discount_percent > 0 && (
              <div><span>Auto-Discount</span><strong className="discount-text">-{batch.discount_percent}%</strong></div>
            )}
          </div>
        </section>

        {canUpdatePhoto && (
          <section className="detail-section card">
            <h3>Update listing photo</h3>
            <p className="muted">Capture a new photo of this unsold batch. AI analysis will refresh the listing while preserving its original listed date.</p>
            <input ref={photoInput} type="file" accept="image/*" capture="environment" onChange={updatePhoto} hidden />
            <button type="button" className="btn btn-outline" onClick={() => photoInput.current?.click()} disabled={updatingPhoto}>
              {updatingPhoto ? <><Loader2 size={16} className="spin" /> Analyzing photo…</> : <><Camera size={16} /> Capture updated photo</>}
            </button>
            {photoError && <p className="error-text" role="alert">{photoError}</p>}
            {photoMessage && <p className="success-text" role="status">{photoMessage}</p>}
          </section>
        )}

        <FreshnessCheck
          mode="operator"
          analysis={analysis.analysis}
          loading={analysis.loading}
          error={analysis.error}
          fallback={{ days: batch.predicted_shelf_life, status: batch.freshness_status, percent: batch.freshness_percent }}
          showCamera={false}
        />
        <p className="batch-privacy-note">Buyers only see the calculated days to spoil and the camera confidence, never your sensor readings.</p>

        <section className="detail-section card">
          <h3>Status Timeline</h3>
          <div className="timeline">
            {TIMELINE.map((label, i) => (
              <div key={label} className={`timeline-step ${i <= step ? 'done' : ''}`}>
                <div className="timeline-dot" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        {prediction && (
          <section className="detail-section card">
            <h3>Latest Prediction</h3>
            <p>Days to spoil: <strong>{formatDays(prediction.days_to_spoil)}</strong></p>
            <p>Freshness: <strong>{prediction.freshness_percent}%</strong></p>
          </section>
        )}
        {detection && (
          <section className="detail-section card">
            <h3>Detection (last 3 weeks)</h3>
            <p>Flagged predictions: <strong>{detection.percent}%</strong> ({detection.total} samples)</p>
          </section>
        )}
      </div>
    </div>
  )
}
