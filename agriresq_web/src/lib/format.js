// Small display helpers shared by the admin pages (Marketplace, Batches, BatchDetail, Analytics, Dashboard).

export const cropEmoji = (crop) => {
  const normalized = (crop || '').toLowerCase()
  if (normalized.includes('eggplant')) return '🍆'
  if (normalized.includes('cucumber')) return '🥒'
  if (normalized.includes('carrot')) return '🥕'
  if (normalized.includes('tomato')) return '🍅'
  if (normalized.includes('lettuce')) return '🥬'
  return '🌾'
}

/** EGGPLANT -> Eggplant */
export const titleCase = (value) => {
  const s = String(value || '').toLowerCase().replace(/_/g, ' ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'
}

export const FRESHNESS = {
  GREEN: { label: 'Fresh', badge: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600', bar: 'bg-emerald-500' },
  AMBER: { label: 'At-Risk', badge: 'bg-amber-100 text-amber-700', text: 'text-amber-600', bar: 'bg-amber-500' },
  RED: { label: 'Rotten', badge: 'bg-rose-100 text-rose-700', text: 'text-rose-600', bar: 'bg-rose-500' },
}
export const freshnessMeta = (status) =>
  FRESHNESS[status] || { label: 'Unknown', badge: 'bg-slate-100 text-slate-600', text: 'text-slate-500', bar: 'bg-slate-400' }

const BUYER_TYPES = { RETAILER: 'Retailer', PROCESSOR: 'Food processor', CONSUMER: 'Consumer' }
export const buyerTypeLabel = (type) => BUYER_TYPES[type] || (type ? titleCase(type) : 'Buyer')

export const peso = (value, digits = 0) => {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—'
  return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

const parse = (iso) => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

/** Local date + time, e.g. "Oct 27, 2026, 9:43 AM". */
export const fmtDateTime = (iso) => {
  const d = parse(iso)
  return d ? d.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
}

export const fmtDate = (iso) => {
  const d = parse(iso)
  return d ? d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

export const fmtTime = (iso) => {
  const d = parse(iso)
  return d ? d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : ''
}

/** Days from now until `iso` (negative when already past). */
export const daysUntil = (iso) => {
  const d = parse(iso)
  return d ? (d.getTime() - Date.now()) / 86400000 : null
}

const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/** PostgREST returns a one-to-one embed as an object, an array or null: normalise to a row or null. */
const climateRow = (row) => {
  const c = row?.product_climate
  return (Array.isArray(c) ? c[0] : c) || null
}

/**
 * The DHT22 reading paired with a batch, from the private product_climate table (supabase/010_sensor_columns.sql),
 * embedded or attached as `row.product_climate`. `available` is false when the climate was never loaded (table missing);
 * `has` is false when there is no reading yet.
 */
export const pairedSensor = (row) => {
  const c = climateRow(row)
  const available = !!row && 'product_climate' in row
  const temp = numOrNull(c?.latest_temp_c)
  const rh = numOrNull(c?.latest_humidity_rh)
  const vpd = numOrNull(c?.latest_vpd_kpa)
  return {
    available,
    has: temp != null || rh != null || vpd != null,
    temp,
    rh,
    vpd,
    chu: numOrNull(c?.chu_accumulated),
    updatedAt: c?.sensor_updated_at || null,
  }
}

/** Combined camera confidence of a batch (products.ml_confidence, 0-1 or 0-100) as a whole percent, or null. */
export const cameraConfidencePct = (row) => {
  const v = numOrNull(row?.ml_confidence)
  if (v == null || v <= 0) return null
  return Math.round(v <= 1 ? v * 100 : v)
}

/** Number to fixed digits, or an em dash when missing. */
export const fixedOrDash = (value, digits = 1) => (value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits))

export const isToday = (iso) => {
  const d = parse(iso)
  return !!d && d.toDateString() === new Date().toDateString()
}
