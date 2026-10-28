import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/supabaseApi'
import ConfirmDialog from './ConfirmDialog'
import { useState } from 'react'
import { CROP_LABELS, formatDaysLeft, storageLine } from '../utils/helpers'
import ProductImage from './ProductImage'
import StatusBadge from './StatusBadge'
import './BatchCard.css'

export default function BatchCard({ batch }) {
  const crop = batch.crop_type
  const storage = storageLine(batch)
  const { user } = useAuth()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const openConfirm = (e) => {
    // the whole card is a link: don't navigate to the batch page when the trash button is tapped
    e.preventDefault()
    e.stopPropagation()
    setConfirmOpen(true)
  }
  const handleRemove = async () => {
    try {
      await api.removeBatch(batch.id)
      setConfirmOpen(false)
      alert('Batch removed')
      window.location.reload()
    } catch (err) {
      alert('Failed: ' + (err.message || err))
    }
  }
  return (
    <>
    <Link to={`/batch/${batch.id}`} className="batch-card card">
      <ProductImage src={batch.image_url} crop={crop} className="batch-img" />
      <div className="batch-body">
        <div className="batch-header">
          <h4>{CROP_LABELS[crop]} Batch #{batch.id}</h4>
          <StatusBadge status={batch.freshness_status} showPercent percent={batch.freshness_percent} size="sm" />
        </div>
        <p className="batch-meta">
          {batch.quantity_kg} kg · Stall {batch.profiles?.stall_number || batch.stall_number || '—'}
        </p>
        {batch.harvest_datetime && (
          <p className="batch-harvest">Harvest: {new Date(batch.harvest_datetime).toLocaleString('en-PH')}</p>
        )}
        <p className={`card-storage${storage ? '' : ' is-empty'}`} title={storage || undefined}>{storage || 'No sensor reading yet'}</p>
        <div className="batch-footer">
          <span>{batch.discount_percent > 0 ? `${batch.discount_percent}% off` : 'Full price'}</span>
          <span>₱{Number(batch.current_price_per_kg || 0).toFixed(2)}/kg</span>
          <span>{formatDaysLeft(batch.predicted_shelf_life)}</span>
        </div>
        <div className="batch-actions">
          {batch.is_listed && <Link to={`/produce/${batch.id}`} className="btn btn-sm">View Listing</Link>}
          {user && user.role === 'STALL_OPERATOR' && user.id === batch.operator_id && (
            <button title="Remove Batch" className="icon-btn danger" onClick={openConfirm}>🗑</button>
          )}
        </div>
      </div>
    </Link>
    <ConfirmDialog
      open={confirmOpen}
      title="Remove Batch"
      message="Remove this batch? This will delete the product and its listing."
      onConfirm={handleRemove}
      onCancel={() => setConfirmOpen(false)}
      confirmLabel="Remove"
    />
    </>
  )
}
