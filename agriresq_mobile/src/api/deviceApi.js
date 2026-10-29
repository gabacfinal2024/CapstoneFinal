import { supabase, BACKEND_URL } from '../lib/supabase'

/** Address of the ESP32-CAM while it is in setup mode (its own "AgriResQ-XXXX" hotspot). */
export const DEVICE_SETUP_URL = 'http://192.168.4.1'

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again.')
  return { Authorization: `Bearer ${session.access_token}` }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readError(res) {
  try {
    const data = await res.json()
    const pick = data.detail || data.error || data.message
    if (pick) return typeof pick === 'string' ? pick : JSON.stringify(pick)
    // DRF field errors, e.g. { email: ["Enter a valid email."] }
    const fields = Object.values(data || {}).flat().filter((v) => typeof v === 'string')
    return fields.length ? fields.join(' ') : `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

/** Authenticated call to the Django IoT hub. Returns parsed JSON (or null for 204). */
async function request(path, { method = 'GET', body, timeoutMs = 60000 } = {}) {
  const headers = await authHeader()
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetchWithTimeout(`${BACKEND_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, timeoutMs)
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The AgriResQ server took too long to respond.')
    throw new Error(`Cannot connect to the AgriResQ server at ${BACKEND_URL}. Check your internet connection and the server's app access settings.`)
  }
  if (!res.ok) throw new Error(await readError(res))
  if (res.status === 204) return null
  const data = await res.json()
  if (Array.isArray(data)) return data
  return { ...data, __status: res.status }
}

const strip = (data) => {
  if (!data || typeof data !== 'object') return data
  const { __status, ...rest } = data
  return rest
}

/** Absolute URL for images the backend returns as relative paths. */
export function backendAsset(url) {
  if (!url) return ''
  if (/^(https?:|data:|blob:)/.test(url)) return url
  return `${BACKEND_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

export const deviceApi = {
  // ── Evidence behind the days-to-spoil estimate (any signed-in user) ──
  /** { studies[], parameters[], engine{}, limits } */
  async referenceShelfLife() {
    return strip(await request('/api/reference/shelf-life/'))
  },

  // ── Pairing (smart-home style setup) ─────────────
  async createPairing({ name, stall_location, crop_type, kind } = {}) {
    return strip(await request('/api/devices/pairing/', { method: 'POST', body: { name, stall_location, crop_type, kind } }))
  },

  async pairingStatus(code) {
    return strip(await request(`/api/devices/pairing/${encodeURIComponent(code)}/`, { timeoutMs: 8000 }))
  },

  // ── Stall climate (DHT22 of the operator's own stall and of cameras shared with them) ──
  /** [{ operator_id, measured, temperature_c, humidity_rh, vpd_kpa, updated_at, devices[], aging: { CROP: { days_used_per_day, chu_per_hour } } }] */
  async stallConditions() {
    const data = await request('/api/stall/conditions/', { timeoutMs: 10000 })
    return Array.isArray(data?.stalls) ? data.stalls : []
  },

  // ── Freshness analysis of one batch (camera ML + DHT22 rules) ──
  /**
   * { product_id, crop_type, status, days_to_spoil, freshness_percent, level, agreement,
   *   camera: null | { state, scans, agreeing, mean_confidence, consistency, confidence, last_scan_at },
   *   model: { accuracy, macro_f1, test_images },
   *   climate?: { temperature_c, humidity_rh, vpd_kpa, chu, updated_at } }  (climate: owner operator / admin only)
   */
  async batchAnalysis(productId) {
    return strip(await request(`/api/batches/${encodeURIComponent(productId)}/analysis/`, { timeoutMs: 12000 }))
  },

  // ── Devices ──────────────────────────────────────
  async devices() {
    const data = await request('/api/devices/')
    return Array.isArray(data) ? data : []
  },

  async device(id) {
    return strip(await request(`/api/devices/${id}/`))
  },

  async updateDevice(id, patch) {
    return strip(await request(`/api/devices/${id}/`, { method: 'PATCH', body: patch }))
  },

  async removeDevice(id) {
    await request(`/api/devices/${id}/`, { method: 'DELETE' })
    return true
  },

  async command(id, command) {
    return strip(await request(`/api/devices/${id}/command/`, { method: 'POST', body: { command } }))
  },

  /** Returns { queued: false, scan } when analysed immediately, or { queued: true } on 202. */
  async scanNow(id) {
    const data = await request(`/api/devices/${id}/scan-now/`, { method: 'POST', timeoutMs: 30000 })
    if (data?.__status === 202 || data?.queued) return { queued: true }
    return { queued: false, scan: strip(data) }
  },

  /** `detected: true` hides "no vegetable" scans (the default view). */
  async scans(id, limit = 20, { detected = false } = {}) {
    const data = await request(`/api/devices/${id}/scans/?limit=${limit}${detected ? '&detected=1' : ''}`)
    return Array.isArray(data) ? data : []
  },

  /** Operator correction: label is 'correct', 'none' or '<crop>_<state>' (e.g. 'eggplant_at-risk'). */
  async scanFeedback(deviceId, scanId, label) {
    return strip(await request(`/api/devices/${deviceId}/scans/${scanId}/feedback/`, { method: 'POST', body: { label } }))
  },

  async readings(id, limit = 60) {
    const data = await request(`/api/devices/${id}/readings/?limit=${limit}`)
    return Array.isArray(data) ? data : []
  },

  // ── People with access (optional: the owner may share with ONE other stall operator, 2 people at most; the administrator always has access) ──
  /** { owner, monitors[], count, minimum, maximum, ok, my_access }. Readable by everyone who has access. */
  async monitors(id) {
    return strip(await request(`/api/devices/${id}/monitors/`))
  },

  /** Owner only: add the one other person (an approved stall operator) by e-mail. Throws the server's message on 400. */
  async addMonitor(id, email) {
    return strip(await request(`/api/devices/${id}/monitors/`, { method: 'POST', body: { email: String(email || '').trim() } }))
  },

  /** Owner only. */
  async removeMonitor(id, userId) {
    await request(`/api/devices/${id}/monitors/${encodeURIComponent(userId)}/`, { method: 'DELETE' })
    return true
  },

  // ── Scan gallery across all of the user's cameras ──
  /**
   * { results: Scan[] (+ device_name, device_ip, image_url, raw_image_url), next_before: number|null }.
   * `detected`: true = vegetables only, false = "nothing in view" only, undefined = all.
   * `before` is the `next_before` of the previous page.
   */
  async gallery({ device, detected, state, since, before, limit = 24 } = {}) {
    const q = new URLSearchParams()
    if (device != null && device !== '') q.set('device', String(device))
    if (detected === true) q.set('detected', '1')
    else if (detected === false) q.set('detected', '0')
    if (state) q.set('state', state)
    if (since) q.set('since', since)
    if (before != null) q.set('before', String(before))
    q.set('limit', String(Math.min(100, Math.max(1, limit))))
    const data = strip(await request(`/api/scans/?${q.toString()}`))
    return {
      results: Array.isArray(data?.results) ? data.results : [],
      next_before: data?.next_before ?? null,
    }
  },

  /** Signed { stream_url, snapshot_url, expires_at } usable directly in <img src>. */
  async live(id) {
    const data = strip(await request(`/api/devices/${id}/live/`))
    return { ...data, stream_url: backendAsset(data.stream_url), snapshot_url: backendAsset(data.snapshot_url) }
  },

  /** Grab the current camera frame as a File (for the Add Product flow). */
  async snapshotFile(id) {
    const { snapshot_url } = await deviceApi.live(id)
    const sep = snapshot_url.includes('?') ? '&' : '?'
    let res
    try {
      res = await fetchWithTimeout(`${snapshot_url}${sep}t=${Date.now()}`, {}, 15000)
    } catch {
      throw new Error('Could not get a photo from the camera. Is it online?')
    }
    if (!res.ok) throw new Error(await readError(res))
    const blob = await res.blob()
    return new File([blob], `esp32cam-${id}-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
  },
}

// ── Device setup mode (phone joined the camera's "AgriResQ-XXXX" Wi-Fi) ──
async function setupCall(path, { method = 'GET', body, timeoutMs = 6000 } = {}) {
  let res
  try {
    res = await fetchWithTimeout(`${DEVICE_SETUP_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, timeoutMs)
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The camera did not answer. Make sure your phone is connected to the "AgriResQ-…" Wi-Fi.')
    }
    throw new Error('Cannot reach the camera at 192.168.4.1. Connect your phone to the camera\'s "AgriResQ-…" Wi-Fi first.')
  }
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export const deviceSetup = {
  info() {
    return setupCall('/info', { timeoutMs: 5000 })
  },
  async networks() {
    // Wi-Fi scanning takes a few seconds on the ESP32.
    const list = await setupCall('/networks', { timeoutMs: 15000 })
    const seen = new Map()
    for (const n of Array.isArray(list) ? list : []) {
      if (!n?.ssid) continue
      const prev = seen.get(n.ssid)
      if (!prev || n.rssi > prev.rssi) seen.set(n.ssid, n)
    }
    return [...seen.values()].sort((a, b) => b.rssi - a.rssi)
  },
  provision({ ssid, password, server, code }) {
    return setupCall('/provision', { method: 'POST', body: { ssid, password, server, code }, timeoutMs: 8000 })
  },
  status() {
    return setupCall('/status', { timeoutMs: 4000 })
  },
}

export function signalLabel(rssi) {
  if (rssi == null) return '—'
  if (rssi >= -60) return 'Excellent'
  if (rssi >= -70) return 'Good'
  if (rssi >= -80) return 'Fair'
  return 'Weak'
}

export function timeAgo(iso) {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** A DHT22 reading older than this is treated as stale (the camera posts one every few minutes). */
export const READING_STALE_MS = 10 * 60 * 1000

export function isReadingStale(iso) {
  if (!iso) return true
  const t = new Date(iso).getTime()
  return Number.isNaN(t) || Date.now() - t > READING_STALE_MS
}

/**
 * A plain ESP32 + DHT22 node: no camera, no live stream, no scans. Anything not marked SENSOR is treated as a camera.
 * Only sensor nodes carry temperature/humidity: a camera has no sensor reading.
 */
export function isSensor(device) {
  return device?.kind === 'SENSOR'
}

/** Fallback display name when a device has none. */
export function deviceFallbackName(device) {
  return `${isSensor(device) ? 'Sensor node' : 'Camera'} #${device?.id}`
}

/** True when the signed-in user may use this device fully (owner, shared person or administrator). */
export function canOperate(device) {
  return device?.can_operate !== false
}

/** True only for the owner (and not the administrator): remove, forget Wi-Fi, choose who has access. */
export function canManage(device) {
  return !!device?.can_manage
}

/** True when the camera was shared with the signed-in user by its owner. */
export function isSharedWithMe(device) {
  return device?.my_access === 'monitor'
}
