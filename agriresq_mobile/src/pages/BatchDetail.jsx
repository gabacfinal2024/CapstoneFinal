import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { CROP_LABELS, formatCurrency, formatDays } from '../utils/helpers'
import FreshnessGauge from '../components/FreshnessGauge'
import FreshnessCheck from '../components/FreshnessCheck'
import ProductImage from '../components/ProductImage'
import StatusBadge from '../components/StatusBadge'
import useBatchAnalysis from '../hooks/useBatchAnalysis'
import usePolling from '../hooks/usePolling'
import './BatchDetail.css'

const TIMELINE = ['Harvested', 'Vision Scan', 'At Stall', 'Listed']

export default function BatchDetail() {
  const { id } = useParams()
  const [batch, setBatch] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [detection, setDetection] = useState(null)
  const [error, setError] = useState('')
  const analysis = useBatchAnalysis(id)

  // polls only while the tab is visible and stops on unmount
  usePolling(() => {
    api.batch(id).then((b) => { setBatch(b); setError('') }).catch((err) => { console.error(err); setError(err.message || 'Could not load this batch.') })
    api.predict(id).then(setPrediction).catch(console.error)
    api.batchDetectionPercent(id).then(setDetection).catch(() => setDetection(null))
  }, 30000)

  if (!batch) {
    return (
      <div className="app-shell">
        <div className="page page-no-nav">
          <Link to="/home" className="back-link">← Back to Dashboard</Link>
          {error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}
        </div>
      </div>
    )
  }
  const crop = batch.crop_type
  const step = batch.is_listed ? 3 : 2

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
            <div><span>Harvest</span><strong>{batch.harvest_datetime ? new Date(batch.harvest_datetime).toLocaleString('en-PH') : '—'}</strong></div>
            <div><span>Base Price</span><strong>{formatCurrency(batch.base_price_per_kg)}/kg</strong></div>
            <div><span>Current Price</span><strong>{formatCurrency(batch.current_price_per_kg)}/kg</strong></div>
            {batch.discount_percent > 0 && (
              <div><span>Auto-Discount</span><strong className="discount-text">-{batch.discount_percent}%</strong></div>
            )}
            {batch.ml_confidence && (
              <div><span>ML Confidence</span><strong>{batch.ml_confidence}%</strong></div>
            )}
          </div>
        </section>

        <FreshnessCheck
          mode="operator"
          analysis={analysis.analysis}
          loading={analysis.loading}
          error={analysis.error}
          fallback={{ days: batch.predicted_shelf_life, status: batch.freshness_status, percent: batch.freshness_percent }}
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

        {batch.predictions?.length > 0 && (
          <section className="detail-section card">
            <h3>Spoilage Predictions</h3>
            {batch.predictions.map((p) => (
              <div key={p.id} className="prediction-row">
                <StatusBadge status={p.predicted_status} size="sm" />
                <span>{formatDays(p.days_to_spoil)} · {p.source}</span>
                <span className="pred-time">{new Date(p.created_at).toLocaleString('en-PH')}</span>
              </div>
            ))}
          </section>
        )}

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
