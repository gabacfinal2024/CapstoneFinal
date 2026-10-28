import { supabase } from '../lib/supabase'

// Django IoT hub (see docs/IOT_DEVICE_API.md)
// In local development, a phone or another computer may open the Vite server through the laptop's LAN IP,
// so the Django backend is available on that same host at port 8000. Production must use VITE_BACKEND_URL.
const pageHost = typeof window !== 'undefined' ? window.location.hostname : ''
const fromLaptop = import.meta.env.DEV && pageHost && !['localhost', '127.0.0.1', ''].includes(pageHost)
export const BACKEND_URL = (fromLaptop
  ? `${window.location.protocol}//${pageHost}:8000`
  : import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
// ESP32-CAM setup hotspot address
export const SETUP_URL = 'http://192.168.4.1'

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} s`, { cause: err })
    throw new Error(`Cannot reach ${new URL(url).host}. ${err.message}`, { cause: err })
  } finally {
    clearTimeout(timer)
  }
}

async function readError(res) {
  try {
    const data = await res.json()
    const direct = data.detail || data.error || data.message
    if (direct) return typeof direct === 'string' ? direct : JSON.stringify(direct)
    // DRF field errors: { email: ["No AgriResQ account uses that email."] }
    const first = Object.values(data)[0]
    const text = Array.isArray(first) ? first[0] : first
    return typeof text === 'string' ? text : JSON.stringify(data)
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in. Please log in again.')
  return { Authorization: `Bearer ${session.access_token}` }
}

/** Authenticated call to the Django backend; returns { status, data }. */
async function backend(path, { method = 'GET', body, timeoutMs } = {}) {
  const headers = await authHeaders()
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetchWithTimeout(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, timeoutMs)
  if (!res.ok) {
    const msg = await readError(res)
    if (res.status === 401) throw Object.assign(new Error(`Session rejected by the backend: ${msg}`), { status: 401 })
    if (res.status === 403) throw Object.assign(new Error(`Not allowed: ${msg} (only the camera owner can do that).`), { status: 403 })
    throw Object.assign(new Error(msg), { status: res.status })
  }
  if (res.status === 204) return { status: 204, data: null }
  return { status: res.status, data: await res.json() }
}

async function setupCall(path, options = {}, timeoutMs = 8000) {
  const res = await fetchWithTimeout(`${SETUP_URL}${path}`, options, timeoutMs)
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export const deviceApi = {
  // ── Pairing ──────────────────────────────────────
  createPairing: async (fields = {}) => (await backend('/api/devices/pairing/', { method: 'POST', body: fields })).data,
  pairingStatus: async (code) => (await backend(`/api/devices/pairing/${encodeURIComponent(code)}/`)).data,

  // ── Devices ──────────────────────────────────────
  list: async () => (await backend('/api/devices/')).data,
  get: async (id) => (await backend(`/api/devices/${id}/`)).data,
  update: async (id, fields) => (await backend(`/api/devices/${id}/`, { method: 'PATCH', body: fields })).data,
  remove: async (id) => { await backend(`/api/devices/${id}/`, { method: 'DELETE' }) },
  command: async (id, command) => (await backend(`/api/devices/${id}/command/`, { method: 'POST', body: { command } })).data,

  /** Returns { queued: false, scan } or { queued: true } (HTTP 202 when the camera can't be reached directly). */
  scanNow: async (id) => {
    const { status, data } = await backend(`/api/devices/${id}/scan-now/`, { method: 'POST', timeoutMs: 45000 })
    return status === 202 ? { queued: true } : { queued: false, scan: data }
  },
  /** `detected: true` hides "no vegetable" scans (server-side filter). */
  scans: async (id, limit = 20, { detected = false } = {}) =>
    (await backend(`/api/devices/${id}/scans/?limit=${limit}${detected ? '&detected=1' : ''}`)).data,
  /** label: 'correct' | 'none' | '<crop>_<state>' e.g. 'eggplant_at-risk'. Returns the updated Scan. */
  scanFeedback: async (deviceId, scanId, label) =>
    (await backend(`/api/devices/${deviceId}/scans/${scanId}/feedback/`, { method: 'POST', body: { label } })).data,
  readings: async (id, limit = 60) => (await backend(`/api/devices/${id}/readings/?limit=${limit}`)).data,
  live: async (id) => (await backend(`/api/devices/${id}/live/`)).data,

  /**
   * Climate of every stall (admin: all stalls) from its DHT22 sensors, with how fast it ages each crop:
   * { stalls: [{ operator_id, measured, temperature_c, humidity_rh, vpd_kpa, updated_at, devices, aging: { EGGPLANT: { days_used_per_day, chu_per_hour } } }] }
   */
  stallConditions: async () => (await backend('/api/stall/conditions/')).data,

  /**
   * Freshness analysis of one batch: the stored status, how far to trust it (level), what the ESP32-CAM freshness model
   * says over the batch's recent accepted scans (camera, null without scans), the DHT22 rules, model reliability, and the
   * batch's climate (admin / owner only). Throws on 503 when the hub has no Supabase key.
   */
  batchAnalysis: async (productId) => (await backend(`/api/batches/${encodeURIComponent(productId)}/analysis/`)).data,

  /** Published shelf-life measurements next to what the engine predicts, plus the engine parameters: { studies, parameters, engine, limits }. */
  referenceShelfLife: async () => (await backend('/api/reference/shelf-life/')).data,

  // ── People with access (owner plus at most one shared stall operator; the admin always has access) ──
  monitors: async (id) => (await backend(`/api/devices/${id}/monitors/`)).data,
  addMonitor: async (id, email) => (await backend(`/api/devices/${id}/monitors/`, { method: 'POST', body: { email } })).data,
  removeMonitor: async (id, userId) => (await backend(`/api/devices/${id}/monitors/${encodeURIComponent(userId)}/`, { method: 'DELETE' })).data,

  /**
   * Gallery of analysed pictures across every camera the user may see.
   * Returns { results: Scan[] (with device_name, device_ip, image_url, raw_image_url), next_before }.
   */
  gallery: async ({ device, detected, state, since, before, limit = 40 } = {}) => {
    const q = new URLSearchParams()
    if (device) q.set('device', device)
    if (detected === true) q.set('detected', '1')
    if (detected === false) q.set('detected', '0')
    if (state) q.set('state', state)
    if (since) q.set('since', since)
    if (before) q.set('before', before)
    q.set('limit', String(Math.min(limit, 100)))
    return (await backend(`/api/scans/?${q.toString()}`)).data
  },

  /** Photo upload fallback (no auth). */
  analyzeUpload: async (file, cropType) => {
    const form = new FormData()
    form.append('image', file)
    form.append('crop_type', cropType)
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/analyze-freshness/`, { method: 'POST', body: form }, 45000)
    if (!res.ok) throw new Error(await readError(res))
    return res.json()
  },

  // ── Setup mode (computer joined to the AgriResQ-XXXX hotspot) ──
  setup: {
    info: () => setupCall('/info', {}, 5000),
    networks: () => setupCall('/networks', {}, 15000),
    provision: ({ ssid, password, server, code }) => setupCall('/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssid, password, server, code }),
    }),
    status: () => setupCall('/status', {}, 5000),
  },
}

// ── Display helpers ────────────────────────────────
export const STATUS_META = {
  UNKNOWN: { label: 'No match', badge: 'bg-slate-100 text-slate-500 border-slate-200', bar: 'bg-slate-400' },
  GREEN: { label: 'Fresh', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  AMBER: { label: 'At-Risk', badge: 'bg-amber-100 text-amber-700 border-amber-200', bar: 'bg-amber-500' },
  RED: { label: 'Rotten', badge: 'bg-rose-100 text-rose-700 border-rose-200', bar: 'bg-rose-500' },
}

export const NO_VEGETABLE_MESSAGE = 'No eggplant, cucumber or carrot in view'
export const NO_VEGETABLE_HINT = 'Place ONE vegetable in front of the camera, centred, in good light.'

/** False when the model found none of eggplant / cucumber / carrot (open-set rejection). */
export const isDetected = (scan) => !!scan && scan.detected !== false && scan.state !== 'none' && scan.freshness_status !== 'UNKNOWN'

/** Status to feed <StatusBadge>: undefined = no scan, 'UNKNOWN' = nothing detected. */
export const scanBadgeStatus = (scan) => (!scan ? undefined : isDetected(scan) ? scan.freshness_status : 'UNKNOWN')

/** Plain-language mismatch warning (registered crop vs what the camera sees). */
export const mismatchMessage = (scan) =>
  scan?.message || `Looks like ${cropLabel(scan?.detected_crop).toLowerCase()}, but this camera is set to ${cropLabel(scan?.crop_type).toLowerCase()}.`

const FEEDBACK_STATES = [['fresh', 'Fresh'], ['at-risk', 'At-Risk'], ['rotten', 'Rotten']]
export const FEEDBACK_LABELS = [
  { value: 'none', label: 'Not a vegetable' },
  ...['eggplant', 'cucumber', 'carrot'].flatMap((crop) => FEEDBACK_STATES.map(([state, stateLabel]) => ({
    value: `${crop}_${state}`,
    label: `${crop[0].toUpperCase()}${crop.slice(1)} – ${stateLabel}`,
  }))),
]

/** Human text for a stored feedback_label. */
export function feedbackText(label) {
  if (!label) return ''
  if (label === 'correct') return 'Confirmed correct'
  return `Corrected to: ${FEEDBACK_LABELS.find((f) => f.value === label)?.label || label}`
}

/** Owner, a person the owner shared the camera with, and the administrator can all operate it (watch, scan, correct, restart, settings). */
export const canOperate = (device) => device?.can_operate ?? !!device?.my_access
/** Only the owner can remove the camera, forget its Wi-Fi and choose who has access. */
export const canManage = (device) => device?.can_manage ?? device?.my_access === 'owner'

/** A plain ESP32 + DHT22 node: no camera, no live stream, no scans. Anything not marked SENSOR is treated as a camera.
 *  Only sensor nodes carry DHT22 readings; cameras never report climate. */
export const isSensor = (device) => device?.kind === 'SENSOR'

export const ACCESS_LABELS = { owner: 'Owner', admin: 'Administrator', monitor: 'Shared with you' }

/** A DHT22 reading older than this is flagged stale. */
export const STALE_READING_MS = 10 * 60 * 1000

export const DEFAULT_CAPTURE_TIMES = ['07:00', '12:00', '16:00']

export const CROPS = [
  { value: 'EGGPLANT', label: 'Eggplant' },
  { value: 'CUCUMBER', label: 'Cucumber' },
  { value: 'CARROT', label: 'Carrot' },
]

/** Scan image may be relative to the Django server, absolute, or a base64 data URL. */
export function scanImageSrc(scan) {
  return absoluteMedia(scan?.image_url || scan?.processed_image_base64)
}

/** Backend media paths may be relative; make them absolute. */
export function absoluteMedia(src) {
  if (!src) return null
  if (src.startsWith('/')) return `${BACKEND_URL}${src}`
  return src
}

export const cropLabel = (value) => CROPS.find((c) => c.value === value)?.label || value || '—'

export function timeAgo(iso, now) {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

/** Absolute "12 Oct 2026, 14:03" style local timestamp. */
export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/** RSSI → human signal quality */
export function signalLabel(rssi) {
  if (rssi == null) return '—'
  if (rssi >= -60) return `Strong (${rssi} dBm)`
  if (rssi >= -72) return `Good (${rssi} dBm)`
  if (rssi >= -82) return `Weak (${rssi} dBm)`
  return `Very weak (${rssi} dBm)`
}
