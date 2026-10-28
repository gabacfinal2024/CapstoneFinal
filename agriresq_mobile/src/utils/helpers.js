export const CROP_LABELS = {
  EGGPLANT: 'Eggplant',
  CUCUMBER: 'Cucumber',
  CARROT: 'Carrot',
}

export const CROP_IMAGES = {
  EGGPLANT: 'https://images.unsplash.com/photo-1659261201616-6ec5d6b5e0ec?w=400&q=80',
  CUCUMBER: 'https://images.unsplash.com/photo-1604977042946-1eecc30f269e?w=400&q=80',
  CARROT: 'https://images.unsplash.com/photo-1598170845058-32b9d6a947da?w=400&q=80',
}

export function statusLabel(status) {
  return { GREEN: 'Fresh', AMBER: 'At-Risk', RED: 'Rotten', UNKNOWN: 'No match' }[status] || status
}

export function statusClass(status) {
  return { GREEN: 'status-green', AMBER: 'status-amber', RED: 'status-red', UNKNOWN: 'status-grey' }[status] || ''
}

export function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatTime(d) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

export function formatCurrency(n) {
  const v = Number(n)
  if (n === null || n === undefined || n === '' || Number.isNaN(v)) return '—'
  return `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDateTime(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Days to spoil is an estimate (storage temperature, humidity and the fruit itself all matter),
// so it is shown to the nearest half day, or in hours when under a day, never as "2.43 days".
export function formatDays(n) {
  const v = Number(n)
  if (n === null || n === undefined || n === '' || Number.isNaN(v)) return '—'
  if (v <= 0) return 'Rotten'
  if (v < 1) return `~${Math.max(1, Math.round(v * 24))} h`
  return `~${(Math.round(v * 2) / 2).toFixed(1)} d`
}

// ── Sensor / climate formatting ─────────────────────────────────────────────
// Every helper returns '—' (or null) for a missing value. Never Number(null) → 0.
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const formatTemp = (v, digits = 1) => { const n = numOrNull(v); return n == null ? '—' : `${n.toFixed(digits)}°C` }
export const formatRH = (v) => { const n = numOrNull(v); return n == null ? '—' : `${n.toFixed(0)}%` }
export const formatVpd = (v) => { const n = numOrNull(v); return n == null ? '—' : n.toFixed(2) }
export const formatChu = (v) => { const n = numOrNull(v); return n == null ? '—' : Math.round(n).toLocaleString('en-PH') }

/** Climate state used by every sensor tile/strip: 'heat' (hot), 'dry' (high VPD), 'ok' or null (no data). */
export const HIGH_TEMP_C = 30
export const HIGH_VPD_KPA = 1.5
export function climateState(temp, vpd) {
  const t = numOrNull(temp)
  const v = numOrNull(vpd)
  if (t == null && v == null) return null
  if (t != null && t > HIGH_TEMP_C) return 'heat'
  if (v != null && v > HIGH_VPD_KPA) return 'dry'
  return 'ok'
}

/** Heat-unit rate per hour, one decimal: '3.4 /h'. */
export const formatChuRate = (v) => { const n = numOrNull(v); return n == null ? '—' : `${n.toFixed(1)} /h` }

/**
 * The stall's current heat-unit rate (°C·h above 25°C per hour) from /api/stall/conditions/.
 * Prefers the stall that lists `device`, then the first stall; prefers the device's crop, then any crop.
 */
export function stallChuRate(stalls, device) {
  if (!Array.isArray(stalls) || !stalls.length) return null
  const hasDevice = (s) => Array.isArray(s?.devices) && s.devices.some((d) => String(d?.id ?? d) === String(device?.id))
  const stall = stalls.find(hasDevice) || stalls[0]
  const aging = stall?.aging || {}
  const own = numOrNull(aging[device?.crop_type]?.chu_per_hour)
  if (own != null) return own
  for (const k of Object.keys(aging)) {
    const n = numOrNull(aging[k]?.chu_per_hour)
    if (n != null) return n
  }
  return null
}

/** 0-1 fractions become percentages; values already above 1 are taken as percentages. '—' when missing. */
export function toPercent(v) {
  const n = numOrNull(v)
  if (n == null) return null
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)))
}

/**
 * The paired DHT22 reading of a product row (operator queries embed product_climate(*): an object, an array
 * with one row, or null when the table is missing / empty / not readable). Null when there is nothing.
 */
export function productClimate(product) {
  const raw = product?.product_climate
  const row = Array.isArray(raw) ? raw[0] : raw
  if (!row) return null
  const temp = numOrNull(row.latest_temp_c)
  const rh = numOrNull(row.latest_humidity_rh)
  const vpd = numOrNull(row.latest_vpd_kpa)
  const chu = numOrNull(row.chu_accumulated)
  if (temp == null && rh == null && vpd == null) return null
  return { temp, rh, vpd, chu, updatedAt: row.sensor_updated_at || null }
}

/** Compact one-liner for cards: 'Storage 31.6°C, 71% RH, VPD 1.4 kPa' (empty string when no reading). */
export function storageLine(product) {
  const c = productClimate(product)
  if (!c) return ''
  const parts = []
  if (c.temp != null) parts.push(formatTemp(c.temp))
  if (c.rh != null) parts.push(`${formatRH(c.rh)} RH`)
  if (c.vpd != null) parts.push(`VPD ${c.vpd.toFixed(1)} kPa`)
  return `Storage ${parts.join(', ')}`
}

/** 'At this climate one real day uses 1.4 days of eggplant shelf life' for a /api/stall/conditions/ aging entry. */
export function agingLine(crop, aging) {
  const n = numOrNull(aging?.days_used_per_day)
  if (n == null) return ''
  const name = (CROP_LABELS[crop] || String(crop || 'produce')).toLowerCase()
  return `At this climate one real day uses ${n.toFixed(1)} days of ${name} shelf life`
}

export function formatDaysLeft(n) {
  const t = formatDays(n)
  return t === 'Rotten' || t === '—' ? t : `${t} left`
}
