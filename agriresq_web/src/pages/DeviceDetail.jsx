import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Loader2, Plus, Power, RotateCcw, Save, ScanLine, Trash2, WifiOff, X,
} from 'lucide-react'
import {
  DEVICE_CROPS, DEFAULT_CAPTURE_TIMES, STALE_READING_MS, cropLabel, canManage, canOperate, deviceApi, isDetected, isSensor, scanBadgeStatus, scanImageSrc, timeAgo,
} from '../api/deviceApi'
import { api } from '../api/supabaseApi'
import { useNow, usePolling } from '../hooks/usePolling'
import LiveCameraView from '../components/LiveCameraView'
import ScanResultCard from '../components/ScanResultCard'
import ReadingsChart from '../components/ReadingsChart'
import StatusBadge from '../components/StatusBadge'
import MonitorsPanel from '../components/MonitorsPanel'
import { AccessBadge, IpAddress, AccessCount,NetworkFacts, OnlinePill, SensorBadge } from '../components/DeviceBits'

// Only sensor nodes carry a DHT22 (cameras never report climate), so there is one list of pin options.
const SENSOR_DHT_GPIOS = [4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33]

function dhtPinOptions(currentPin) {
  const opts = [
    { value: -1, label: 'None (no DHT22)' },
    ...SENSOR_DHT_GPIOS.map((g) => ({ value: g, label: g === 4 ? 'GPIO 4 (D4)' : `GPIO ${g}` })),
  ]
  // Keep a legacy/out-of-list current value visible so the select never shows a blank.
  if (currentPin != null && !opts.some((o) => o.value === currentPin)) {
    opts.push({ value: currentPin, label: `GPIO ${currentPin}` })
  }
  return opts
}

const INTERVAL_MINUTES = [1, 5, 10, 15, 30, 60]
const MAX_CAPTURE_TIMES = 6

const SETTINGS_KEYS = [
  'name', 'stall_location', 'crop_type', 'product_id', 'auto_scan', 'scan_mode',
  'capture_times', 'scan_interval_s', 'dht_pin', 'flash_on_scan',
]

function settingsFrom(device) {
  const s = {}
  for (const k of SETTINGS_KEYS) s[k] = device[k]
  s.product_id = device.product_id ?? ''
  s.scan_mode = device.scan_mode === 'interval' ? 'interval' : 'schedule'
  s.capture_times = device.capture_times?.length ? [...device.capture_times] : [...DEFAULT_CAPTURE_TIMES]
  s.scan_interval_s = device.scan_interval_s || 300
  return s
}

function scheduleSummary(device) {
  if (!device.auto_scan) return 'Automatic scans off (Scan now still works)'
  if (device.scan_mode === 'interval') return `Scanning every ${Math.max(1, Math.round((device.scan_interval_s || 300) / 60))} min`
  const times = device.capture_times?.length ? device.capture_times : DEFAULT_CAPTURE_TIMES
  return `Scheduled scans at ${times.join(', ')}`
}

const inputCls = 'w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#2A6B48] focus:ring-2 focus:ring-emerald-100 outline-none text-sm bg-white'

function Toggle({ checked, onChange, label, hint }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${checked ? 'bg-[#2A6B48]' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

/** Remount per device so the settings form never shows another device's values. */
export default function DeviceDetail() {
  const { id } = useParams()
  return <DeviceDetailView key={id} id={id} />
}

function DeviceDetailView({ id }) {
  const navigate = useNavigate()
  const now = useNow(5000)

  const [device, setDevice] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [readingError, setReadingError] = useState('')
  const [scans, setScans] = useState([])
  const [showEmpty, setShowEmpty] = useState(false)
  const [readings, setReadings] = useState([])
  const [products, setProducts] = useState(null)
  const [pinned, setPinned] = useState(null)

  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionBusy, setActionBusy] = useState('')

  usePolling(async () => {
    try {
      const d = await deviceApi.get(id)
      setDevice(d)
      setForm((f) => f ?? settingsFrom(d))
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    }
  }, 5000, id)

  const sensor = isSensor(device)

  usePolling(async () => {
    try { setScans(await deviceApi.scans(id, 30, { detected: !showEmpty })) } catch { /* shown via device error */ }
  }, 5000, `${id}-${showEmpty}`, !sensor)

  usePolling(async () => {
    try {
      setReadings(await deviceApi.readings(id, 60))
      setReadingError('')
    } catch (err) {
      setReadingError(err.message)
    }
  }, 10000, id, sensor)

  const operate = canOperate(device)
  const manage = canManage(device)

  // linked-batch choices are only needed by the settings form
  usePolling(async () => {
    try { setProducts(await api.batches()) } catch { setProducts([]) }
  }, 120000, 'products', operate)

  const refreshDevice = async () => {
    try {
      setDevice(await deviceApi.get(id))
      if (sensor) {
        setReadings(await deviceApi.readings(id, 60))
        setReadingError('')
      }
    } catch (err) {
      if (sensor) setReadingError(err.message)
      else setLoadError(err.message)
    }
  }

  const setField = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setSaveMsg('')
  }

  const setTime = (index, value) => setField('capture_times', form.capture_times.map((t, i) => (i === index ? value : t)))
  const addTime = () => setField('capture_times', [...form.capture_times, '12:00'])
  const removeTime = (index) => setField('capture_times', form.capture_times.filter((_, i) => i !== index))

  const saveSettings = async (e) => {
    e.preventDefault()
    setSaveMsg('')
    const times = [...new Set(form.capture_times.filter(Boolean))].sort()
    if (form.scan_mode === 'schedule' && times.length === 0) {
      setSaveMsg('Error: add at least one capture time, or switch to “Every N minutes”.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        product_id: form.product_id === '' ? null : Number(form.product_id),
        scan_interval_s: Number(form.scan_interval_s) || 300,
        capture_times: times.length ? times : DEFAULT_CAPTURE_TIMES,
      }
      // The DHT22 pin belongs to sensor nodes only; a camera never sends it.
      if (sensor) payload.dht_pin = Number(form.dht_pin)
      else delete payload.dht_pin
      const d = await deviceApi.update(id, payload)
      setDevice(d)
      setForm(settingsFrom(d))
      setSaveMsg('Saved. The ' + (sensor ? 'node' : 'camera') + ' picks up new settings within a few seconds.')
    } catch (err) {
      setSaveMsg(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const scanNow = async () => {
    setScanning(true)
    setNotice('')
    try {
      const res = await deviceApi.scanNow(id)
      if (res.queued) {
        setNotice('Scan requested — the camera will capture and upload within a few seconds.')
      } else {
        if (isDetected(res.scan) || showEmpty) setScans((s) => [res.scan, ...s.filter((x) => x.id !== res.scan.id)])
        setPinned(res.scan)
      }
    } catch (err) {
      setNotice(`Scan failed: ${err.message}`)
    } finally {
      setScanning(false)
    }
  }

  const onScanUpdated = (updated) => {
    setScans((list) => list.map((s) => (s.id === updated.id ? updated : s)))
    setPinned((p) => (p?.id === updated.id ? updated : p))
    setDevice((d) => (d?.latest_scan?.id === updated.id ? { ...d, latest_scan: updated } : d))
  }

  const runAction = async (kind) => {
    const what = sensor ? 'sensor node' : 'camera'
    const prompts = {
      reboot: `Restart this ${what}? It will be offline for about 15 seconds.`,
      forget_wifi: `Make the ${what} forget its Wi-Fi? It will go back to setup mode (AgriResQ-XXXX hotspot) and must be set up again, but stays linked to your account.`,
      remove: sensor
        ? 'Remove this device from your account? The sensor node will reset to setup mode.'
        : 'Remove this device from your account? The camera will reset to setup mode and its scan history will be kept only on the server.',
    }
    if (!window.confirm(prompts[kind])) return
    setActionBusy(kind)
    setNotice('')
    try {
      if (kind === 'remove') {
        await deviceApi.remove(id)
        navigate('/devices')
        return
      }
      await deviceApi.command(id, kind)
      setNotice(kind === 'reboot' ? 'Restart command sent.' : 'Forget Wi-Fi command sent. Use “Add device” to connect it again.')
    } catch (err) {
      setNotice(`Error: ${err.message}`)
    } finally {
      setActionBusy('')
    }
  }

  if (!device) {
    return (
      <div className="p-10 text-slate-400">
        <Link to="/devices" className="text-sm font-bold text-[#2A6B48] flex items-center gap-1 mb-4"><ArrowLeft size={16} /> Devices</Link>
        {loadError ? <p className="text-rose-500">Couldn't load this device: {loadError}</p> : <p className="animate-pulse">Loading device…</p>}
      </div>
    )
  }

  // pinned = the row the user clicked (or the manual scan just taken); otherwise the true latest scan, even "nothing detected"
  const selectedScan = pinned ? (scans.find((s) => s.id === pinned.id) || pinned) : (device.latest_scan || scans[0] || null)
  const latestReading = device.latest_reading || readings[0] || null
  const reading = device.latest_reading
  const readingStale = !!reading && now - new Date(reading.created_at).getTime() > STALE_READING_MS
  const cropProducts = (products || []).filter((p) => form?.crop_type === 'ALL' || !form?.crop_type || p.crop_type === form.crop_type)
  const intervalMinutes = Math.max(1, Math.round((Number(form?.scan_interval_s) || 300) / 60))
  const intervalOptions = INTERVAL_MINUTES.includes(intervalMinutes) ? INTERVAL_MINUTES : [...INTERVAL_MINUTES, intervalMinutes].sort((a, b) => a - b)

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <Link to="/devices" className="text-sm font-bold text-[#2A6B48] flex items-center gap-1 mb-2"><ArrowLeft size={16} /> Devices</Link>
          <h1 className="text-3xl font-bold text-slate-800 flex flex-wrap items-center gap-3">
            {device.name}
            <OnlinePill online={device.online} />
          </h1>
          <p className="text-slate-500 text-sm mt-1">{device.stall_location || 'No location'} • {cropLabel(device.crop_type)}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <SensorBadge device={device} />
            <AccessCount device={device} />
            <AccessBadge device={device} />
          </div>
        </div>
        {operate && (
          <div className="flex flex-wrap gap-2">
            {!sensor && (
              <button onClick={scanNow} disabled={scanning || !device.online}
                      className="px-5 py-2.5 rounded-xl font-bold text-white bg-[#2A6B48] hover:bg-[#1f5035] disabled:opacity-50 flex items-center gap-2 shadow-sm">
                {scanning ? <Loader2 size={18} className="animate-spin" /> : <ScanLine size={18} />} Scan now
              </button>
            )}
            <button onClick={() => runAction('reboot')} disabled={!!actionBusy || !device.online}
                    className="px-4 py-2.5 rounded-xl font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">
              <Power size={16} /> Restart
            </button>
            {manage && (
              <>
                <button onClick={() => runAction('forget_wifi')} disabled={!!actionBusy || !device.online}
                        className="px-4 py-2.5 rounded-xl font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">
                  <WifiOff size={16} /> Forget Wi-Fi
                </button>
                <button onClick={() => runAction('remove')} disabled={!!actionBusy}
                        className="px-4 py-2.5 rounded-xl font-bold text-rose-600 border border-rose-200 bg-white hover:bg-rose-50 disabled:opacity-50 flex items-center gap-2">
                  <Trash2 size={16} /> Remove camera
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">{sensor ? 'Device IP address' : 'Camera IP address'}</p>
          <IpAddress ip={device.ip} online={device.online} />
          <p className="text-[11px] text-slate-400 mt-1">LAN address. The {sensor ? "node's" : "camera's"} own page only opens from the same Wi-Fi.</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Wi-Fi</p>
          <NetworkFacts device={device} now={now} className="text-slate-600" />
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">MAC</p>
          <span className="font-mono text-slate-600">{device.mac || '—'}</span>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Last seen</p>
          <span className="text-slate-600">{device.last_seen ? `${timeAgo(device.last_seen, now)} (${new Date(device.last_seen).toLocaleString()})` : 'never'}</span>
        </div>
      </div>

      {notice && <div role="status" className="p-3 rounded-xl bg-slate-800 text-white text-sm">{notice}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {!sensor && <LiveCameraView key={id} deviceId={id} online={device.online} scanning={scanning} />}
            <div className="p-4 flex flex-wrap gap-4 justify-between text-sm text-slate-500">
              {sensor ? <span className="font-bold text-slate-700">Latest DHT22 reading</span> : <span>{scheduleSummary(device)}</span>}
              {sensor && (
                <span className={readingStale ? 'text-amber-600 font-semibold' : ''}>
                  {device.dht_pin < 0
                    ? 'No DHT22 configured yet (the administrator sets this)'
                    : reading
                      ? `🌡 ${Number(reading.temperature_c).toFixed(1)}°C • 💧 ${Number(reading.humidity_rh).toFixed(0)}% RH • VPD ${reading.vpd_kpa != null ? Number(reading.vpd_kpa).toFixed(2) : '—'} kPa • ${readingStale ? 'stale, ' : ''}${timeAgo(reading.created_at, now)}`
                      : 'Waiting for the first DHT22 reading'}
                </span>
              )}
            </div>
          </div>

          {!sensor && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-800">Scan history</h2>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
                  Show empty scans (nothing detected)
                </label>
              </div>
              {scans.length === 0 ? (
                <p className="p-6 text-sm text-slate-400">
                  {showEmpty ? 'No scans yet.' : 'No detections yet. Place one eggplant, cucumber or carrot in front of the camera and press “Scan now”.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-400 text-xs font-bold uppercase tracking-wider">
                      <tr><th className="p-3 pl-5">Image</th><th className="p-3">Time</th><th className="p-3">Source</th><th className="p-3">Result</th><th className="p-3">Freshness</th><th className="p-3">Confidence</th><th className="p-3 pr-5">Review</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {scans.map((s) => {
                        const detected = isDetected(s)
                        return (
                          <tr key={s.id} onClick={() => setPinned(s)}
                              className={`cursor-pointer hover:bg-slate-50 ${selectedScan?.id === s.id ? 'bg-emerald-50/50' : ''} ${detected ? '' : 'opacity-70'}`}>
                            <td className="p-2 pl-5">
                              {scanImageSrc(s) ? <img src={scanImageSrc(s)} alt="" className="w-16 h-10 object-cover rounded-md bg-black" /> : '—'}
                            </td>
                            <td className="p-3 text-slate-600">{new Date(s.created_at).toLocaleString()}</td>
                            <td className="p-3 text-xs font-semibold text-slate-500">{s.source}</td>
                            <td className="p-3">
                              {detected ? (
                                <span className="flex items-center gap-1.5">
                                  <StatusBadge status={scanBadgeStatus(s)} />
                                  {s.crop_mismatch && <AlertTriangle size={14} className="text-amber-500" aria-label="Crop mismatch" />}
                                </span>
                              ) : <span className="text-xs font-semibold text-slate-400">Nothing detected</span>}
                            </td>
                            <td className="p-3 font-bold text-slate-700">{detected && s.freshness_percent != null ? `${Math.round(s.freshness_percent)}%` : '—'}</td>
                            <td className="p-3 text-slate-600">
                              {detected ? `${Math.round((Number(s.ml_confidence) || 0) * 100)}%${s.low_confidence ? ' ⚠' : ''}` : '—'}
                            </td>
                            <td className="p-3 pr-5 text-slate-500" title={s.feedback_label || ''}>
                              {s.feedback_label ? (s.feedback_label === 'correct' ? '✔' : '✖') : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {!sensor && (
            <div className="space-y-2">
              <ScanResultCard scan={selectedScan} title={pinned ? 'Selected scan' : 'Latest scan'} onScanUpdated={onScanUpdated} readOnly={!operate} />
              {pinned && (
                <button type="button" onClick={() => setPinned(null)} className="text-xs font-bold text-[#2A6B48] hover:underline">
                  ← Back to the latest scan
                </button>
              )}
            </div>
          )}

          {sensor && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Live sensor readings</h2>
              <p className="text-xs text-slate-500 mb-3">
                {latestReading
                  ? `Updated ${new Date(latestReading.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
                  : 'Waiting for the first DHT22 reading. The node reports every 30 seconds.'}
              </p>
              {readingError && <p role="alert" className="mb-3 rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">Could not refresh sensor readings: {readingError}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {[
                  ['Temperature', latestReading ? `${Number(latestReading.temperature_c).toFixed(1)} °C` : '—'],
                  ['Humidity', latestReading ? `${Number(latestReading.humidity_rh).toFixed(1)} %RH` : '—'],
                  ['VPD', latestReading?.vpd_kpa != null ? `${Number(latestReading.vpd_kpa).toFixed(2)} kPa` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
              <h3 className="text-sm font-bold text-slate-700 mb-2">Temperature & humidity history</h3>
              <ReadingsChart readings={readings} />
            </div>
          )}

          <MonitorsPanel deviceId={id} canManage={manage} onChanged={refreshDevice} />

          {!operate && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-lg font-bold text-slate-800 mb-3">Device settings</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  ...(!sensor ? [['Crop', cropLabel(device.crop_type)]] : []),
                  ['Linked batch', device.product_id ? `#${device.product_id}` : 'Not linked'],
                  ...(sensor ? [] : [['Scanning', scheduleSummary(device)]]),
                  ...(sensor ? [['DHT22 pin', device.dht_pin >= 0 ? (device.dht_pin === 4 ? 'GPIO 4 (D4)' : `GPIO ${device.dht_pin}`) : 'None (no DHT22)']] : []),
                  ...(sensor ? [] : [['Flash LED', device.flash_on_scan ? 'On during scan' : 'Off']]),
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[10px] uppercase font-bold text-slate-400">{k}</dt>
                    <dd className="text-slate-700">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {operate && form && (
            <form onSubmit={saveSettings} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <h2 className="text-lg font-bold text-slate-800">Device settings</h2>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Name
                <input className={`${inputCls} mt-1`} value={form.name || ''} onChange={(e) => setField('name', e.target.value)} />
              </label>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Stall / location
                <input className={`${inputCls} mt-1`} value={form.stall_location || ''} onChange={(e) => setField('stall_location', e.target.value)} />
              </label>
              {!sensor && <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Crop
                <select className={`${inputCls} mt-1`} value={form.crop_type} onChange={(e) => {
                  const crop = e.target.value
                  const linked = products?.find((p) => String(p.id) === String(form.product_id))
                  setField('crop_type', crop)
                  if (linked && crop !== 'ALL' && linked.crop_type !== crop) setField('product_id', '')
                }}>
                  {DEVICE_CROPS.filter((c) => !sensor || c.value !== 'ALL').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>}
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Linked harvest batch
                <select className={`${inputCls} mt-1`} value={form.product_id} onChange={(e) => setField('product_id', e.target.value)}>
                  <option value="">— Not linked —</option>
                  {cropProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.id} {cropLabel(p.crop_type)} • {p.quantity_kg} kg • {p.freshness_status}
                    </option>
                  ))}
                </select>
                <span className="block normal-case font-normal text-slate-400 mt-1">
                  Scans of a linked batch update its freshness, price and marketplace listing. In All vegetables mode, only matching-crop scans update the linked batch.
                  {products && cropProducts.length === 0 ? ` No ${cropLabel(form.crop_type).toLowerCase()} batches found.` : ''}
                </span>
              </label>

              {!sensor && (
                <>
                  <Toggle checked={!!form.auto_scan} onChange={(v) => setField('auto_scan', v)} label="Automatic scans"
                          hint="Scan automatically. Turn off to stop all automatic scans (Scan now still works)." />

                  <fieldset disabled={!form.auto_scan} className="space-y-3 disabled:opacity-50">
                    <legend className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">When to scan</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {[['schedule', 'Capture windows'], ['interval', 'Every N minutes']].map(([value, label]) => (
                        <label key={value} className={`px-3 py-2 rounded-xl border text-sm font-semibold cursor-pointer text-center ${form.scan_mode === value ? 'border-[#2A6B48] bg-emerald-50 text-[#2A6B48]' : 'border-slate-200 text-slate-500'}`}>
                          <input type="radio" name="scan_mode" value={value} checked={form.scan_mode === value}
                                 onChange={() => setField('scan_mode', value)} className="sr-only" />
                          {label}
                        </label>
                      ))}
                    </div>

                    {form.scan_mode === 'schedule' ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400">Daily capture times (default 07:00 morning baseline, 12:00 peak heat, 16:00 end-of-day).</p>
                        {form.capture_times.map((t, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input type="time" required value={t} onChange={(e) => setTime(i, e.target.value)} className={inputCls} aria-label={`Capture time ${i + 1}`} />
                            <button type="button" onClick={() => removeTime(i)} disabled={form.capture_times.length <= 1}
                                    className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-30" aria-label={`Remove capture time ${i + 1}`}>
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={addTime} disabled={form.capture_times.length >= MAX_CAPTURE_TIMES}
                                className="text-xs font-bold text-[#2A6B48] hover:underline disabled:opacity-40 flex items-center gap-1">
                          <Plus size={14} /> Add time {form.capture_times.length >= MAX_CAPTURE_TIMES ? `(max ${MAX_CAPTURE_TIMES})` : ''}
                        </button>
                      </div>
                    ) : (
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Scan every
                        <select className={`${inputCls} mt-1`} value={intervalMinutes} onChange={(e) => setField('scan_interval_s', Number(e.target.value) * 60)}>
                          {intervalOptions.map((m) => <option key={m} value={m}>{m === 60 ? '1 hour' : `${m} minute${m === 1 ? '' : 's'}`}</option>)}
                        </select>
                      </label>
                    )}
                  </fieldset>
                </>
              )}

              {sensor && (
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">DHT22 data pin
                  <select className={`${inputCls} mt-1`} value={form.dht_pin} onChange={(e) => setField('dht_pin', Number(e.target.value))}>
                    {dhtPinOptions(form.dht_pin).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <span className="block normal-case font-normal text-slate-400 mt-1">
                    Only the administrator configures the DHT22. Sensor nodes come set to GPIO 4 (D4).
                  </span>
                  {Number(device.dht_pin) === 4 && (
                    <span className="block normal-case font-semibold text-emerald-700 mt-1">DHT22 ready on GPIO 4 (D4)</span>
                  )}
                </label>
              )}
              {!sensor && (
                <Toggle checked={!!form.flash_on_scan} onChange={(v) => setField('flash_on_scan', v)} label="Flash LED during scan"
                        hint="Helps in dim stalls; may cause glare on glossy skins" />
              )}

              <div className="flex items-center gap-3 pt-2">
                <button type="submit" disabled={saving}
                        className="px-5 py-2.5 rounded-xl font-bold text-white bg-[#2A6B48] hover:bg-[#1f5035] disabled:opacity-50 flex items-center gap-2">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save settings
                </button>
                <button type="button" onClick={() => { setForm(settingsFrom(device)); setSaveMsg('') }}
                        className="px-3 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-50 flex items-center gap-1 text-sm">
                  <RotateCcw size={14} /> Reset
                </button>
              </div>
              {saveMsg && <p role="status" className={`text-xs ${saveMsg.startsWith('Error') ? 'text-rose-600' : 'text-emerald-700'}`}>{saveMsg}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
