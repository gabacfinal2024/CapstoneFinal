import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ScanLine, Loader2, RotateCw, WifiOff, Trash2, RefreshCw,
  Plus, X, UserPlus, Users, LogOut,
} from 'lucide-react'
import { deviceApi, timeAgo, signalLabel, canOperate, canManage, isSharedWithMe, isSensor, deviceFallbackName } from '../api/deviceApi'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import usePolling from '../hooks/usePolling'
import useStallConditions from '../hooks/useStallConditions'
import { CROP_LABELS, formatDateTime, stallChuRate } from '../utils/helpers'
import LiveCameraView from '../components/LiveCameraView'
import ScanResultCard, { isNoVegetable, scanSummary } from '../components/ScanResultCard'
import ScanGallery from '../components/ScanGallery'
import { SensorPanel } from '../components/CameraSensorCard'
import StallClimateCard from '../components/StallClimateCard'
import { AccessBadge, SensorBadge } from '../components/MonitorBadges'
import OnlinePill from '../components/OnlinePill'
import ErrorNotice from '../components/ErrorNotice'
import Skeleton, { SkeletonCard } from '../components/Skeleton'
import ConfirmDialog from '../components/ConfirmDialog'
import '../styles/devices.css'
import './DeviceDetail.css'

const REFRESH_MS = 5000
const DEFAULT_TIMES = ['07:00', '12:00', '16:00']
const MAX_TIMES = 6
const INTERVALS = [
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
  { value: 1800, label: 'Every 30 minutes' },
  { value: 3600, label: 'Every hour' },
]

const confirmsFor = (sensor) => {
  const what = sensor ? 'sensor node' : 'camera'
  return {
    reboot: { title: `Restart ${what}?`, message: `The ${what} will be offline for about 15 seconds.`, label: 'Restart' },
    forget_wifi: {
      title: 'Forget Wi-Fi?',
      message: `The ${what} will disconnect and open its "AgriResQ-…" setup hotspot so you can connect it to a different Wi-Fi.`,
      label: 'Forget Wi-Fi',
    },
    leave: {
      title: `Leave this ${what}?`,
      message: `You will no longer have access to this ${what}. Its owner can give you access again.`,
      label: 'Leave',
    },
    remove: {
      title: `Remove this ${what}?`,
      message: sensor
        ? 'It will be unlinked from your account and return to setup mode.'
        : 'It will be unlinked from your account and return to setup mode. Its scan history will be deleted.',
      label: 'Remove',
    },
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function settingsFrom(d) {
  return {
    name: d.name || '',
    stall_location: d.stall_location || '',
    crop_type: d.crop_type || 'EGGPLANT',
    product_id: d.product_id ?? '',
    auto_scan: d.auto_scan !== false,
    scan_mode: d.scan_mode === 'interval' ? 'interval' : 'schedule',
    capture_times: Array.isArray(d.capture_times) && d.capture_times.length ? [...d.capture_times] : [...DEFAULT_TIMES],
    scan_interval_s: d.scan_interval_s ?? 300,
    dht_pin: d.dht_pin ?? -1,
    flash_on_scan: !!d.flash_on_scan,
  }
}

const to12h = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const fmt = (n, digits = 1) => (Number.isFinite(Number(n)) && n != null ? Number(n).toFixed(digits) : '—')

/** Remount per camera so one camera's data never flashes on another camera's page. */
export default function DeviceDetail() {
  const { id } = useParams()
  return <DeviceDetailPage key={id} id={id} />
}

function DeviceDetailPage({ id }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [device, setDevice] = useState(null)
  const [scans, setScans] = useState([]) // vegetable scans only, for "last vegetable seen"
  const [readings, setReadings] = useState([])
  const [galleryKey, setGalleryKey] = useState(0)
  const [monitors, setMonitors] = useState(null)
  const [monitorEmail, setMonitorEmail] = useState('')
  const [addingMonitor, setAddingMonitor] = useState(false)
  const [monitorMsg, setMonitorMsg] = useState(null) // { type, text }
  const [monitorToRemove, setMonitorToRemove] = useState(null)
  const [batches, setBatches] = useState([])
  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState(null) // { type, text }
  const [loadError, setLoadError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const sensor = isSensor(device) // plain ESP32 + DHT22 node: no camera, no scans
  const what = sensor ? 'sensor node' : 'camera'
  const dhtPin = device?.dht_pin ?? -1
  const dhtStatusText = dhtPin >= 0
    ? `DHT22: connected on ${sensor && dhtPin === 4 ? 'GPIO 4 (D4)' : `GPIO ${dhtPin}`} (set by the administrator)`
    : 'DHT22: not set up yet. The administrator configures it.'

  // the polling callback must always see the current value without restarting the timer
  const dirtyRef = useRef(false)
  const followUp = useRef(null)
  const sensorRef = useRef(false) // sensor nodes have no scans to load
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => () => clearTimeout(followUp.current), [])

  const loadDevice = async () => {
    try {
      const d = await deviceApi.device(id)
      sensorRef.current = isSensor(d)
      setDevice(d)
      setLoadError('')
      setForm((f) => (f && dirtyRef.current ? f : settingsFrom(d)))
    } catch (err) {
      setLoadError(err.message)
    }
  }

  const loadHistory = async () => {
    if (sensorRef.current) return
    try { setScans(await deviceApi.scans(id, 5, { detected: true })) } catch { /* keep the previous list */ }
  }

  const loadReadings = async () => {
    try { setReadings(await deviceApi.readings(id, 60)) } catch { /* keep the previous list */ }
  }

  const loadMonitors = async () => {
    try { setMonitors(await deviceApi.monitors(id)) } catch { /* the device itself still reports its access count */ }
  }

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([loadDevice(), loadHistory(), sensor ? loadReadings() : null, loadMonitors()])
    setGalleryKey((k) => k + 1)
    setRefreshing(false)
  }

  usePolling(() => Promise.all([loadDevice(), loadHistory()]), REFRESH_MS)
  usePolling(loadMonitors, 15000)
  // only a sensor node has readings (a camera has none); the stall's heat-unit rate comes from the stall climate
  usePolling(loadReadings, 15000, { enabled: sensor })
  const { stalls } = useStallConditions({ enabled: sensor })
  const chuRate = sensor ? stallChuRate(stalls, device) : null

  useEffect(() => {
    let cancelled = false
    api.batches().then((b) => { if (!cancelled) setBatches(b || []) }).catch(() => { if (!cancelled) setBatches([]) })
    return () => { cancelled = true }
  }, [])

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true) }

  const setTime = (i, v) => set('capture_times', form.capture_times.map((t, j) => (j === i ? v : t)))
  const addTime = () => set('capture_times', [...form.capture_times, '12:00'])
  const removeTime = (i) => set('capture_times', form.capture_times.filter((_, j) => j !== i))

  const save = async (e) => {
    e.preventDefault()
    setMessage(null)
    const times = [...new Set(form.capture_times.filter((t) => HHMM.test(t)))].sort()
    if (form.scan_mode === 'schedule' && times.length === 0) {
      setMessage({ type: 'error', text: 'Add at least one capture time, or switch to "Every N minutes".' })
      return
    }
    setSaving(true)
    try {
      const patch = {
        ...form,
        product_id: form.product_id === '' ? null : Number(form.product_id),
        capture_times: times.length ? times : [...DEFAULT_TIMES],
        scan_interval_s: Number(form.scan_interval_s),
      }
      delete patch.dht_pin // only the administrator sets the DHT22 pin
      const d = await deviceApi.updateDevice(id, patch)
      setDevice(d)
      setDirty(false)
      setForm(settingsFrom(d))
      setMessage({ type: 'success', text: `Settings saved. The ${what} picks them up within a few seconds.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  /** Put a changed scan (e.g. after feedback) back into the latest-scan card and history. */
  const applyScan = (scan) => {
    setDevice((d) => (d && d.latest_scan?.id === scan.id ? { ...d, latest_scan: scan } : d))
    setScans((list) => list.map((s) => (s.id === scan.id ? scan : s)))
    setGalleryKey((k) => k + 1)
  }

  const scanNow = async () => {
    setScanning(true)
    setMessage(null)
    try {
      const res = await deviceApi.scanNow(id)
      if (res.queued) {
        setMessage({ type: 'info', text: 'Scan requested. The result will appear in a few seconds.' })
        clearTimeout(followUp.current)
        followUp.current = setTimeout(() => { loadDevice(); loadHistory(); setGalleryKey((k) => k + 1) }, 6000)
      } else {
        setDevice((d) => (d ? { ...d, latest_scan: res.scan } : d))
        if (!isNoVegetable(res.scan)) setScans((s) => [res.scan, ...s.filter((x) => x.id !== res.scan.id)])
        setGalleryKey((k) => k + 1)
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setScanning(false)
    }
  }

  const addMonitor = async (e) => {
    e.preventDefault()
    const email = monitorEmail.trim()
    if (!email) {
      setMonitorMsg({ type: 'error', text: `Enter the e-mail of the stall operator who should get access to this ${what}.` })
      return
    }
    setAddingMonitor(true)
    setMonitorMsg(null)
    try {
      await deviceApi.addMonitor(id, email)
      setMonitorEmail('')
      setMonitorMsg({ type: 'success', text: `Access given. They can now use this ${what} from their Devices list.` })
      await Promise.all([loadMonitors(), loadDevice()])
    } catch (err) {
      setMonitorMsg({ type: 'error', text: err.message })
    } finally {
      setAddingMonitor(false)
    }
  }

  const confirmRemoveMonitor = async () => {
    const m = monitorToRemove
    setMonitorToRemove(null)
    if (!m) return
    setMonitorMsg(null)
    try {
      await deviceApi.removeMonitor(id, m.user_id)
      setMonitorMsg({ type: 'info', text: `${m.full_name || m.email} no longer has access to this ${what}.` })
      await Promise.all([loadMonitors(), loadDevice()])
    } catch (err) {
      setMonitorMsg({ type: 'error', text: err.message })
    }
  }

  const runConfirmed = async () => {
    const action = confirm
    setConfirm(null)
    setMessage(null)
    try {
      if (action === 'remove') {
        await deviceApi.removeDevice(id)
        navigate('/devices', { replace: true })
        return
      }
      if (action === 'leave') {
        await deviceApi.removeMonitor(id, user?.id)
        navigate('/devices', { replace: true })
        return
      }
      await deviceApi.command(id, action)
      setMessage({
        type: 'info',
        text: action === 'reboot'
          ? `Restart sent. The ${what} will be back online shortly.`
          : `Done. The ${what} is now in setup mode. Use "Add device" to connect it again.`,
      })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  if (loadError && !device) {
    return (
      <div className="app-shell">
        <div className="page page-no-nav">
          <Link to="/devices" className="dev-back"><ArrowLeft size={16} /> Devices</Link>
          <ErrorNotice message={loadError} onRetry={refresh} retrying={refreshing} />
        </div>
      </div>
    )
  }

  if (!device || !form) {
    return (
      <div className="app-shell">
        <div className="page page-no-nav" aria-busy="true">
          <Link to="/devices" className="dev-back"><ArrowLeft size={16} /> Devices</Link>
          <Skeleton height={26} width="55%" style={{ marginBottom: 14 }} />
          <Skeleton height={220} radius={14} style={{ marginBottom: 14 }} />
          <SkeletonCard lines={4} />
        </div>
      </div>
    )
  }

  const operate = canOperate(device) // owner, shared person or administrator: full use
  const manage = canManage(device) // owner only: remove, forget Wi-Fi, choose who has access
  const shared = isSharedWithMe(device)
  const sorted = [...readings].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) // oldest -> newest
  const latestScan = device.latest_scan || scans[0]
  const lastDetected = scans.find((s) => !isNoVegetable(s))
  const linkedBatch = operate ? batches.find((b) => String(b.id) === String(device.product_id)) : null
  const monitorCount = monitors?.count ?? device.monitor_count ?? 1
  const monitorMax = monitors?.maximum ?? 2

  return (
    <div className="app-shell">
      <div className="page page-no-nav device-detail">
        <Link to="/devices" className="dev-back"><ArrowLeft size={16} /> Devices</Link>

        <div className="device-detail__head">
          <div>
            <h1 className="dev-title">{device.name || deviceFallbackName(device)}</h1>
            <p className="dev-subtitle">{device.stall_location || 'No stall set'} · {CROP_LABELS[device.crop_type] || device.crop_type}</p>
            {(sensor || shared) && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <SensorBadge device={device} />
                <AccessBadge device={device} />
              </div>
            )}
          </div>
          <div className="devices-actions">
            <button type="button" className="icon-action" onClick={refresh} disabled={refreshing} aria-label="Refresh">
              <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
            </button>
            <OnlinePill online={device.online} />
          </div>
        </div>

        {loadError && <ErrorNotice message={loadError} onRetry={refresh} retrying={refreshing} hint="Showing the last information we received." />}
        {message && <div className={`notice ${message.type}`}>{message.text}</div>}

        {sensor ? (
          <section className="dev-section card">
            <h3>Stall sensor (DHT22)</h3>
            <SensorPanel reading={device.latest_reading} readings={readings} dhtPin={device.dht_pin} chuRate={chuRate} />
          </section>
        ) : (
          <>
          <section className="dev-section">
            <LiveCameraView deviceId={device.id} online={device.online} />
            {operate && (
              <button className="btn btn-green scan-btn" onClick={scanNow} disabled={scanning || !device.online}>
                {scanning ? <><Loader2 className="spin" size={18} /> Analysing…</> : <><ScanLine size={18} /> Scan now</>}
              </button>
            )}
            <p className="last-scan-line">
              {latestScan ? <>Last scan {timeAgo(latestScan.created_at)} · {scanSummary(latestScan)}</> : 'No scans yet'}
            </p>
            {linkedBatch && (
              <p className="linked-note">Results update batch <strong>{CROP_LABELS[linkedBatch.crop_type]} #{linkedBatch.id}</strong>.</p>
            )}
          </section>

          <section className="dev-section">
            <ScanResultCard scan={latestScan} onScanUpdated={applyScan} feedback={operate} />
            {latestScan && isNoVegetable(latestScan) && lastDetected && (
              <p className="last-detection">
                Last vegetable seen: <strong>{scanSummary(lastDetected)}</strong> · {timeAgo(lastDetected.created_at)}
              </p>
            )}
          </section>
          </>
        )}

        {sensor && operate && <StallClimateCard crops={batches.map((b) => b.crop_type)} className="dev-section" />}

        {!sensor && (
          <section className="dev-section card">
            <div className="section-head">
              <h3>Recent pictures</h3>
              <Link to={`/gallery?device=${device.id}`} className="gallery-link">All cameras</Link>
            </div>
            <ScanGallery deviceId={device.id} pageSize={6} refreshKey={galleryKey} />
          </section>
        )}

        {sensor && readings.length > 1 && (
          <section className="dev-section card">
            <h3>Recent readings</h3>
            <div className="history-list">
              {[...sorted].reverse().slice(0, 8).map((r) => (
                <div key={r.id} className="history-row history-row--readings">
                  <span>{formatDateTime(r.created_at)}</span>
                  <span>{fmt(r.temperature_c)}°C</span>
                  <span>{fmt(r.humidity_rh, 0)}% RH</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="dev-section card">
          <div className="section-head">
            <h3><Users size={16} style={{ verticalAlign: '-3px' }} /> {sensor ? 'Sensor access' : 'Camera access'}</h3>
            <span className="monitor-count is-ok">
              {monitorCount} of {monitorMax} people have access
            </span>
          </div>
          <p className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            A {what} can be used by its owner alone. You may also give one other stall operator access (two people at most).
          </p>

          <ul className="monitor-list">
            <li>
              <div>
                <strong>{monitors?.owner?.full_name || (manage ? 'You' : (sensor ? 'Node owner' : 'Camera owner'))}</strong>
                {monitors?.owner?.email && <small>{monitors.owner.email}</small>}
              </div>
              <span className="monitor-role">Owner</span>
            </li>
            {(monitors?.monitors || []).map((m) => (
              <li key={m.user_id}>
                <div>
                  <strong>{m.full_name || m.email}</strong>
                  {m.full_name && <small>{m.email}</small>}
                </div>
                {manage ? (
                  <button type="button" className="monitor-action" aria-label={`Remove access for ${m.full_name || m.email}`} onClick={() => setMonitorToRemove(m)}>
                    Remove access
                  </button>
                ) : String(m.user_id) === String(user?.id) ? (
                  <button type="button" className="monitor-action" onClick={() => setConfirm('leave')}>Leave</button>
                ) : (
                  <span className="monitor-role">Has access</span>
                )}
              </li>
            ))}
            {monitors && monitors.monitors.length === 0 && (
              <li className="monitor-empty">No one else has access (optional).</li>
            )}
          </ul>
          <p className="field-hint">Administrator: always has access</p>

          {monitorMsg && <div className={`notice ${monitorMsg.type}`} style={{ marginTop: 10, marginBottom: 0 }}>{monitorMsg.text}</div>}

          {manage && monitorCount < monitorMax && (
            <form className="monitor-form" onSubmit={addMonitor}>
              <label htmlFor="monitor-email">Give access to another stall operator (email)</label>
              <div className="monitor-form__row">
                <input id="monitor-email" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" placeholder="operator@example.com"
                  value={monitorEmail} onChange={(e) => setMonitorEmail(e.target.value)} />
                <button className="btn btn-green" disabled={addingMonitor || !monitorEmail.trim()}>
                  {addingMonitor ? <Loader2 size={16} className="spin" /> : <UserPlus size={16} />} Add
                </button>
              </div>
              <p className="field-hint">They must have an approved stall operator account.</p>
            </form>
          )}
          {manage && monitorCount >= monitorMax && (
            <p className="field-hint">Two people have access (the limit). Remove one to choose someone else.</p>
          )}
        </section>

        {operate && (
          <form className="dev-section card" onSubmit={save}>
            <h3>Settings</h3>
            <div className="input-group">
              <label>Name</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="input-group">
              <label>Stall / location</label>
              <input value={form.stall_location} onChange={(e) => set('stall_location', e.target.value)} />
            </div>
            <div className="input-group">
              <label>{sensor ? 'Produce this sensor node covers' : 'Produce this camera watches'}</label>
              <select value={form.crop_type} onChange={(e) => set('crop_type', e.target.value)}>
                <option value="EGGPLANT">Eggplant</option>
                <option value="CUCUMBER">Cucumber</option>
                <option value="CARROT">Carrot</option>
              </select>
            </div>
            {!sensor && (
              <div className="input-group">
                <label>Linked batch (scan results update its freshness)</label>
                <select value={form.product_id} onChange={(e) => set('product_id', e.target.value)}>
                  <option value="">— Not linked —</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>{CROP_LABELS[b.crop_type] || b.crop_type} #{b.id} · {b.quantity_kg} kg</option>
                  ))}
                </select>
              </div>
            )}

            {!sensor && (
              <>
                <label className="toggle-row">
                  <span>Scan automatically</span>
                  <input type="checkbox" checked={form.auto_scan} onChange={(e) => set('auto_scan', e.target.checked)} />
                </label>

                <div className="input-group">
                  <label>When to scan</label>
                  <div className="mode-tabs" role="radiogroup" aria-label="Scan mode">
                    <button type="button" role="radio" aria-checked={form.scan_mode === 'schedule'} disabled={!form.auto_scan}
                      className={`mode-tab${form.scan_mode === 'schedule' ? ' active' : ''}`} onClick={() => set('scan_mode', 'schedule')}>
                      Capture windows<br /><small>7:00 · 12:00 · 16:00</small>
                    </button>
                    <button type="button" role="radio" aria-checked={form.scan_mode === 'interval'} disabled={!form.auto_scan}
                      className={`mode-tab${form.scan_mode === 'interval' ? ' active' : ''}`} onClick={() => set('scan_mode', 'interval')}>
                      Every N minutes<br /><small>repeat all day</small>
                    </button>
                  </div>
                </div>

                {form.scan_mode === 'schedule' ? (
                  <div className="input-group">
                    <label>Capture times (every day)</label>
                    <div className="time-list">
                      {form.capture_times.map((t, i) => (
                        <div key={i} className="time-row">
                          <input type="time" value={t} disabled={!form.auto_scan} onChange={(e) => setTime(i, e.target.value)} aria-label={`Capture time ${i + 1}`} />
                          <button type="button" className="time-remove" aria-label={`Remove ${to12h(HHMM.test(t) ? t : '12:00')}`}
                            onClick={() => removeTime(i)} disabled={!form.auto_scan || form.capture_times.length <= 1}>
                            <X size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {form.capture_times.length < MAX_TIMES && (
                      <button type="button" className="link-btn" onClick={addTime} disabled={!form.auto_scan}><Plus size={14} /> Add a time</button>
                    )}
                    <p className="field-hint">
                      Morning, noon and afternoon scans track how the produce changes through the day. An extra scan is taken
                      automatically if it stays hotter than 35 °C for 2 hours.
                    </p>
                  </div>
                ) : (
                  <div className="input-group">
                    <label>Scan interval</label>
                    <select value={form.scan_interval_s} onChange={(e) => set('scan_interval_s', e.target.value)} disabled={!form.auto_scan}>
                      {INTERVALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      {!INTERVALS.some((o) => o.value === Number(form.scan_interval_s)) && (
                        <option value={form.scan_interval_s}>Every {Math.round(Number(form.scan_interval_s) / 60) || 1} min</option>
                      )}
                    </select>
                  </div>
                )}
              </>
            )}

            {sensor && (
              <div className="input-group">
                <label>DHT22 temperature/humidity sensor</label>
                <p className="field-hint" style={{ marginTop: 0 }}>{dhtStatusText}</p>
              </div>
            )}
            {!sensor && (
              <label className="toggle-row">
                <span>Turn on flash light while scanning</span>
                <input type="checkbox" checked={form.flash_on_scan} onChange={(e) => set('flash_on_scan', e.target.checked)} />
              </label>
            )}
            <button className="btn btn-green" disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}</button>
          </form>
        )}

        <section className="dev-section card">
          <h3>Device info</h3>
          <div className="info-list">
            <div><span>Type</span><strong>{sensor ? 'Sensor node (DHT22, no camera)' : 'Camera (ESP32-CAM)'}</strong></div>
            <div><span>Status</span><strong>{device.online ? 'Online' : `Offline · last seen ${timeAgo(device.last_seen)}`}</strong></div>
            <div><span>Last seen</span><strong>{device.last_seen ? `${formatDateTime(device.last_seen)} (${timeAgo(device.last_seen)})` : 'never'}</strong></div>
            <div><span>IP address</span><strong>{device.ip || '—'}</strong></div>
            <div><span>Wi-Fi</span><strong>{device.wifi_ssid || '—'}</strong></div>
            <div><span>Signal</span><strong>{device.rssi != null ? `${signalLabel(device.rssi)} (${device.rssi} dBm)` : '—'}</strong></div>
            <div><span>Firmware</span><strong>{device.fw_version || '—'}</strong></div>
            <div><span>MAC</span><strong>{device.mac || '—'}</strong></div>
            <div><span>Your access</span><strong>{shared ? 'Shared with you' : manage ? 'Owner' : 'Administrator'}</strong></div>
          </div>
        </section>

        {operate && (
          <section className="dev-section">
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => setConfirm('reboot')} disabled={!device.online}><RotateCw size={16} /> Restart</button>
              {manage && (
                <button className="btn btn-ghost" onClick={() => setConfirm('forget_wifi')} disabled={!device.online}><WifiOff size={16} /> Forget Wi-Fi</button>
              )}
            </div>
            {manage && (
              <button className="btn btn-danger remove-btn" onClick={() => setConfirm('remove')}><Trash2 size={16} /> Remove {what}</button>
            )}
            {shared && (
              <button className="btn btn-danger remove-btn" onClick={() => setConfirm('leave')}><LogOut size={16} /> Leave</button>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? confirmsFor(sensor)[confirm].title : ''}
        message={confirm ? confirmsFor(sensor)[confirm].message : ''}
        confirmLabel={confirm ? confirmsFor(sensor)[confirm].label : 'Confirm'}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={!!monitorToRemove}
        title="Remove access?"
        message={monitorToRemove
          ? `${monitorToRemove.full_name || monitorToRemove.email} will no longer have access to this ${what}.`
          : ''}
        confirmLabel="Remove access"
        onConfirm={confirmRemoveMonitor}
        onCancel={() => setMonitorToRemove(null)}
      />
    </div>
  )
}
