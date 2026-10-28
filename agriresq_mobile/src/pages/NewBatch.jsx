import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { computeDynamicPrice, daysLeftSinceHarvest, statusFromDays, worseStatus } from '../api/pricing'
import StatusBadge from '../components/StatusBadge'
import './Auth.css'
import './NewBatch.css'
import { publishProductPhoto } from '../utils/photo'
import { supabase } from '../lib/supabase'
import { deviceApi, isSensor, deviceFallbackName } from '../api/deviceApi'
import { ProbabilityBars, confidencePct, isNoVegetable, NO_VEGETABLE_TEXT, NO_VEGETABLE_HINT } from '../components/ScanResultCard'
import { CROP_LABELS, formatDays } from '../utils/helpers'
import { ScanSearch, AlertTriangle } from 'lucide-react'

export default function NewBatch() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [nodes, setNodes] = useState([])
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [form, setForm] = useState({
    crop_type: 'EGGPLANT', quantity_kg: '', base_price_per_kg: '',
    harvest_datetime: new Date().toISOString().slice(0, 16),
    iot_node_id: '', notes: '', pickup_location: 'Bulua West Terminal',
    auto_discount_enabled: true,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [listingMissing, setListingMissing] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [lastBatchId, setLastBatchId] = useState(null)
  const [camLoading, setCamLoading] = useState(false)
  const [skipAi, setSkipAi] = useState(false) // operator chose to save without the AI check

  useEffect(() => {
    // ESP32-CAM devices registered through the AgriResQ IoT hub (Django)
    deviceApi.devices().then(setNodes).catch(() => setNodes([]))
  }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setAnalysis(null)
    setSkipAi(false)
    setError('')
  }

  const handleCaptureClick = () => {
    fileInputRef.current?.click()
  }

  const onlineCams = nodes.filter((n) => n.online && !isSensor(n)) // sensor nodes have no snapshot

  /** Grab the current frame from the operator's ESP32-CAM and use it as the product photo. */
  const useCameraPhoto = async () => {
    const cam = onlineCams.find((n) => String(n.id) === String(form.iot_node_id)) || onlineCams[0]
    if (!cam) return
    setCamLoading(true)
    setError('')
    try {
      const file = await deviceApi.snapshotFile(cam.id)
      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
      setAnalysis(null)
      setSkipAi(false)
      if (!form.iot_node_id) set('iot_node_id', String(cam.id))
      if (cam.crop_type && cam.crop_type !== form.crop_type) set('crop_type', cam.crop_type)
    } catch (err) {
      setError(err.message)
    } finally {
      setCamLoading(false)
    }
  }

  /** Throw away the current photo and its result so the operator can take another one. */
  const retakePhoto = () => {
    setImageFile(null)
    setImagePreview(null)
    setAnalysis(null)
    setSkipAi(false)
    setError('')
    fileInputRef.current?.click()
  }

  const changeCrop = (crop) => {
    // the AI result depends on the selected crop, so a new crop needs a new analysis
    set('crop_type', crop)
    setAnalysis(null)
    setSkipAi(false)
  }

  const getFreshnessDistribution = (percent) => {
    const pct = Number(percent ?? 0)
    const fresh = Math.min(100, Math.max(0, Math.round(((pct - 60) / 40) * 100)))
    const spoiled = Math.min(100, Math.max(0, Math.round(((40 - pct) / 40) * 100)))
    const atRisk = Math.max(0, 100 - fresh - spoiled)
    return { fresh, atRisk, spoiled }
  }

  /** Step 2–3: ESP32-CAM / upload → backend analyzes freshness */
  const runAnalysis = async (cropOverride) => {
    const crop = typeof cropOverride === 'string' ? cropOverride : form.crop_type
    if (!imageFile) {
      setError('Capture or upload a product image first (ESP32-CAM).')
      return
    }
    setAnalyzing(true)
    setError('')
    try {
      const result = await api.analyzeFreshness(imageFile, crop)
      setAnalysis(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  /** Step 4–5: Save product + freshness to Supabase → listings */
  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      // Only a detected, non-mismatched scan may set freshness. "Save without AI check" uses manual defaults.
      let freshness = null
      if (!skipAi) {
        freshness = analysis
        if (!freshness && imageFile) {
          freshness = await api.analyzeFreshness(imageFile, form.crop_type)
          setAnalysis(freshness)
        }
        if (freshness && isNoVegetable(freshness)) {
          setError(`${freshness.message || NO_VEGETABLE_TEXT}. Retake the photo, or choose "Save without AI check".`)
          return
        }
        if (freshness?.crop_mismatch) {
          setError('The AI sees a different vegetable than the crop you selected. Use the detected crop, or choose "save without AI check".')
          return
        }
      }
      // The operator's own photo, shrunk and stored so every buyer can see it (never the annotated
      // analysis image, and never a backend-relative path that only works on the laptop).
      let imageUrl = ''
      if (imageFile) {
        const { data: { user } } = await supabase.auth.getUser()
        imageUrl = await publishProductPhoto(supabase, imageFile, user?.id)
      }
      // The countdown starts from the harvest time, not from "5 days": a batch harvested 3 days ago is
      // already 3 days old. The camera can only shorten it further (a fresh verdict never extends it).
      const aged = daysLeftSinceHarvest(form.crop_type, form.harvest_datetime)
      const days = freshness?.days_to_spoil != null ? Math.min(Number(freshness.days_to_spoil), aged.days) : aged.days
      const status = worseStatus(freshness?.freshness_status || 'GREEN', statusFromDays(days))
      const percent = Math.min(freshness?.freshness_percent ?? 100, Math.round((days / aged.baseline) * 100))

      const batch = await api.createBatch({
        ...form,
        quantity_kg: parseFloat(form.quantity_kg),
        base_price_per_kg: parseFloat(form.base_price_per_kg) || 0,
        // products.iot_node_id references Supabase iot_nodes; cameras live in the IoT hub,
        // so the camera is linked to the batch below instead.
        iot_node_id: null,
        harvest_datetime: new Date(form.harvest_datetime).toISOString(),
        freshness_status: status,
        freshness_percent: percent,
        predicted_shelf_life: days,
        ml_confidence: freshness?.ml_confidence,
        image_url: imageUrl || '',
        is_listed: status !== 'RED',
      })
      setLastBatchId(batch.id)
      if (form.iot_node_id) {
        try {
          await deviceApi.updateDevice(form.iot_node_id, { product_id: batch.id, crop_type: form.crop_type })
        } catch (err) {
          console.warn('Could not link camera to batch', err)
        }
      }
      // Ensure listing exists (some Supabase configs take a moment)
      try {
        let listing = await api.getListingByProduct(batch.id)
        const start = Date.now()
        while (!listing && Date.now() - start < 10000) {
          // wait a bit and retry
          await new Promise((r) => setTimeout(r, 800))
          listing = await api.getListingByProduct(batch.id)
        }
        if (!listing) {
          setListingMissing(true)
        }
      } catch (err) {
        console.warn('Listing check failed', err)
        setListingMissing(true)
      }

      navigate(`/batch/${batch.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const forcePublish = async () => {
    setPublishLoading(true)
    setPublishError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const uid = user?.id
      const prodId = lastBatchId
      const { data: product } = await supabase.from('products').select('*').eq('id', prodId).maybeSingle()
      if (!product) throw new Error('Product not found')
      // Call _ensureListing with the batch returned earlier by createBatch
      await api._ensureListing({ id: product.id, operator_id: uid, base_price_per_kg: product.base_price_per_kg, quantity_kg: product.quantity_kg, freshness_status: product.freshness_status, auto_discount_enabled: product.auto_discount_enabled })
      // re-check
      const listing = await api.getListingByProduct(product.id)
      if (listing) {
        setListingMissing(false)
        alert('Listing published successfully')
      } else {
        setPublishError('Listing still not found after publish attempt')
      }
    } catch (err) {
      console.error(err)
      setPublishError(err.message || String(err))
    } finally {
      setPublishLoading(false)
    }
  }

  const noVeg = !!analysis && isNoVegetable(analysis)
  const mismatch = !!analysis && !noVeg && !!analysis.crop_mismatch
  const usable = analysis && !noVeg && !mismatch ? analysis : null

  const previewStatus = usable
    ? worseStatus(usable.freshness_status, statusFromDays(Math.min(Number(usable.days_to_spoil ?? 99), daysLeftSinceHarvest(form.crop_type, form.harvest_datetime).days)))
    : null
  const previewPricing = usable
    ? computeDynamicPrice(form.base_price_per_kg, form.quantity_kg, previewStatus, form.auto_discount_enabled)
    : null

  const freshnessDistribution = usable ? getFreshnessDistribution(usable.freshness_percent) : null

  return (
    <div className="app-shell">
      <div className="page page-no-nav auth-page">
        <Link to="/home" className="back-link">← Back</Link>
        <h2 className="page-heading">Add Product</h2>
        <p className="flow-hint">ESP32-CAM capture → AI freshness analysis → save to database → listings</p>

        <form className="card auth-form new-batch-form" onSubmit={handleSubmit}>
          <div className="flow-steps card inner-card">
            <div className="step">1. Product details</div>
            <div className="step">2. ESP32-CAM image</div>
            <div className="step">3. Freshness analysis</div>
            <div className="step">4. Save & list</div>
          </div>

          <div className="input-group">
            <label>Crop Type</label>
            <select value={form.crop_type} onChange={(e) => changeCrop(e.target.value)}>
              <option value="EGGPLANT">Eggplant</option>
              <option value="CUCUMBER">Cucumber</option>
              <option value="CARROT">Carrot</option>
            </select>
          </div>
          <div className="input-group">
            <label>Quantity (kg)</label>
            <input type="number" step="0.1" value={form.quantity_kg} onChange={(e) => set('quantity_kg', e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Base Price per kg (₱)</label>
            <input type="number" step="0.01" value={form.base_price_per_kg} onChange={(e) => set('base_price_per_kg', e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Harvest Date & Time</label>
            <input type="datetime-local" value={form.harvest_datetime} onChange={(e) => set('harvest_datetime', e.target.value)} required />
          </div>
          <div className="input-group">
            <label className="checkbox-label">
              <input type="checkbox" checked={form.auto_discount_enabled} onChange={(e) => set('auto_discount_enabled', e.target.checked)} />
              Enable auto-discount when At-Risk (30%)
            </label>
          </div>

          <div className="input-group">
            <label>Product Image (ESP32-CAM / Camera)</label>
            <div className="camera-actions">
              <button type="button" className="btn btn-outline-dark" onClick={handleCaptureClick}>
                Capture with Camera
              </button>
              <span className="camera-hint">or upload from device</span>
            </div>
            {onlineCams.length > 0 && (
              <button type="button" className="btn btn-outline-dark cam-photo-btn" onClick={useCameraPhoto} disabled={camLoading}>
                {camLoading ? 'Getting photo from camera…' : 'Use photo from my ESP32-CAM'}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImage}
              style={{ display: 'none' }}
            />
            <input type="file" accept="image/*" onChange={handleImage} />
            {imagePreview && <img src={imagePreview} alt="Preview" className="image-preview" />}
          </div>

          {imageFile && !analysis && !skipAi && (
            <button type="button" className="btn btn-green" onClick={() => runAnalysis()} disabled={analyzing}>
              {analyzing ? 'Analyzing freshness...' : 'Analyze Freshness (AI)'}
            </button>
          )}

          {skipAi && (
            <div className="notice warn">
              AI check skipped: this product will be saved as <strong>Fresh</strong> with default shelf life.{' '}
              <button type="button" className="link-btn" onClick={() => setSkipAi(false)}>Undo</button>
            </div>
          )}

          {noVeg && !skipAi && (
            <div className="analysis-result card inner-card analysis-none">
              <div className="analysis-none__icon"><ScanSearch size={26} /></div>
              <h4>{analysis.message || NO_VEGETABLE_TEXT}</h4>
              <p>{NO_VEGETABLE_HINT}</p>
              <button type="button" className="btn btn-green" onClick={retakePhoto}>Retake photo</button>
              <button type="button" className="link-btn center" onClick={() => { setSkipAi(true); setError('') }}>Save without AI check</button>
            </div>
          )}

          {mismatch && !skipAi && (
            <div className="analysis-result card inner-card analysis-mismatch">
              <p className="scan-warn"><AlertTriangle size={16} /> {analysis.message || `This looks like ${CROP_LABELS[analysis.detected_crop] || analysis.detected_crop}, not ${CROP_LABELS[form.crop_type]}.`}</p>
              <button type="button" className="btn btn-green" disabled={analyzing}
                onClick={() => { const crop = analysis.detected_crop; changeCrop(crop); runAnalysis(crop) }}>
                Use {CROP_LABELS[analysis.detected_crop] || analysis.detected_crop}
              </button>
              <button type="button" className="link-btn center" onClick={() => { setSkipAi(true); setError('') }}>
                Keep {CROP_LABELS[form.crop_type]} and save without AI check
              </button>
            </div>
          )}

          {usable && !skipAi && (
            <div className="analysis-result card inner-card">
              <h4>Freshness Analysis Result</h4>
              <StatusBadge status={usable.freshness_status} showPercent percent={usable.freshness_percent} />
              {usable.processed_image_base64 && (
                <img src={usable.processed_image_base64} alt="Analysed produce" className="image-preview" />
              )}
              {usable.probs ? (
                <div className="analysis-probs"><ProbabilityBars probs={usable.probs} /></div>
              ) : (
                <div className="freshness-distribution">
                  <div className="freshness-bar freshness-fresh" style={{ width: `${freshnessDistribution.fresh}%` }}>
                    <span>{freshnessDistribution.fresh}% Fresh</span>
                  </div>
                  <div className="freshness-bar freshness-risk" style={{ width: `${freshnessDistribution.atRisk}%` }}>
                    <span>{freshnessDistribution.atRisk}% At-Risk</span>
                  </div>
                  <div className="freshness-bar freshness-spoiled" style={{ width: `${freshnessDistribution.spoiled}%` }}>
                    <span>{freshnessDistribution.spoiled}% Rotten</span>
                  </div>
                </div>
              )}
              {usable.low_confidence && (
                <p className="error-text">Low confidence: retake the photo with one vegetable in clear view.</p>
              )}
              <p>Days to spoil: <strong>{formatDays(usable.days_to_spoil)}</strong></p>
              <p>ML confidence: <strong>{confidencePct(usable.ml_confidence)}</strong></p>
              {previewPricing && (
                <p>Dynamic price: <strong>₱{previewPricing.current_price_per_kg}/kg</strong>
                  {previewPricing.discount_percent > 0 && ` (${previewPricing.discount_percent}% off)`}
                </p>
              )}
            </div>
          )}

          <div className="input-group">
            <label>Camera or sensor node (optional)</label>
            <select value={form.iot_node_id} onChange={(e) => set('iot_node_id', e.target.value)}>
              <option value="">— None —</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name || deviceFallbackName(n)}{isSensor(n) ? ' (sensor node)' : ''}{n.stall_location ? ` · ${n.stall_location}` : ''}{n.online ? '' : ' (offline)'}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-green" disabled={loading}>
            {loading ? 'Saving to database...' : 'Save Product & Show in Listings'}
          </button>
          {listingMissing && (
            <div className="card warning-block" style={{ marginTop: 12 }}>
              <p>Listing was not found in the marketplace automatically.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-green" onClick={forcePublish} disabled={publishLoading}>{publishLoading ? 'Publishing...' : 'Force Publish Listing'}</button>
                <button className="btn btn-outline" onClick={() => { setListingMissing(false); setPublishError('') }}>Dismiss</button>
              </div>
              {publishError && <p className="error-text">{publishError}</p>}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
