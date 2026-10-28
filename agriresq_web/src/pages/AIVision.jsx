import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Camera, Clock, Eye, ImageIcon, Loader2, Maximize2, ScanLine, StopCircle, Upload, X } from 'lucide-react'
import { CROPS, cropLabel, deviceApi, formatDateTime, canOperate, isDetected, isSensor, scanBadgeStatus, scanImageSrc, timeAgo } from '../api/deviceApi'
import { useNow, usePolling } from '../hooks/usePolling'
import LiveCameraView from '../components/LiveCameraView'
import ScanResultCard from '../components/ScanResultCard'
import StatusBadge from '../components/StatusBadge'
import { AccessBadge, IpAddress,NetworkFacts, OnlinePill } from '../components/DeviceBits'

function UploadAnalyzer() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [crop, setCrop] = useState('EGGPLANT')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const pick = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setResult(null)
    setError('')
  }

  const analyze = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await deviceApi.analyzeUpload(file, crop))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2 font-bold text-slate-800"><Upload size={18} className="text-[#2A6B48]" /> Analyse a photo</div>
      <p className="text-xs text-slate-500">No camera nearby? Upload a photo of one eggplant, cucumber or carrot on a plain background. Photos of anything else are rejected.</p>
      <div className="flex flex-wrap gap-3 items-center">
        <input type="file" accept="image/*" onChange={pick} className="text-sm" aria-label="Photo to analyse" />
        <select value={crop} onChange={(e) => setCrop(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm" aria-label="Expected crop">
          {CROPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button onClick={analyze} disabled={!file || busy}
                className="px-4 py-2 rounded-xl font-bold text-white bg-[#2A6B48] hover:bg-[#1f5035] disabled:opacity-50 flex items-center gap-2 text-sm">
          {busy && <Loader2 size={14} className="animate-spin" />} Analyse
        </button>
      </div>
      {preview && !result && <img src={preview} alt="Selected" className="max-h-48 rounded-xl border border-slate-100" />}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {/* the card handles: nothing detected / crop mismatch / low confidence */}
      {result && <ScanResultCard scan={result} title="Uploaded photo" />}
    </div>
  )
}

const offlineNote = (device, now) => (device.last_seen
  ? `Last seen ${timeAgo(device.last_seen, now)} (${formatDateTime(device.last_seen)})`
  : 'Never seen online')

/** One camera in the "all cameras" grid. Online cameras show a refreshing snapshot (streams are reserved for the big viewer). */
function CameraTile({ device, now, selected, onSelect }) {
  return (
    <article className={`relative bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${selected ? 'border-[#2A6B48] ring-2 ring-emerald-100' : device.online ? 'border-emerald-200' : 'border-slate-200'}`}>
      {selected ? (
        <div className="aspect-video w-full bg-slate-900 flex flex-col items-center justify-center text-slate-300 text-xs gap-1">
          <Eye size={22} /> Showing in the main viewer
        </div>
      ) : (
        <LiveCameraView deviceId={device.id} online={device.online} preferSnapshot snapshotMs={3000} compact
                        offlineText={offlineNote(device, now)} />
      )}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-slate-800 text-sm truncate">{device.name}</h3>
          <OnlinePill online={device.online} className="!text-[10px] !px-2 !py-0.5" />
        </div>
        <p className="text-[11px] text-slate-500 truncate">{device.stall_location || 'No location'} • {cropLabel(device.crop_type)}</p>
        <div className="relative z-10 text-[11px] flex flex-wrap items-center gap-1.5">
          <IpAddress ip={device.ip} online={device.online} showLink={false} />
        </div>
      </div>
      <button type="button" onClick={onSelect} aria-pressed={selected}
              aria-label={`Show ${device.name} in the main viewer`}
              className="absolute inset-0 w-full h-full rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-[#2A6B48]" />
    </article>
  )
}

export default function AIVision() {
  const now = useNow(5000)
  const viewerRef = useRef(null)
  const [devices, setDevices] = useState(null) // cameras only: sensor nodes have no stream
  const [sensorCount, setSensorCount] = useState(0)
  const [autoId, setAutoId] = useState(null) // first online camera (sticky while it stays online)
  const [searchParams, setSearchParams] = useSearchParams()
  const deviceParam = searchParams.get('device') // /ai-vision?device=<id> preselects a camera (Devices page 'Live' link)
  const [userPick, setUserPick] = useState(deviceParam || null) // camera clicked by the user
  const [expanded, setExpanded] = useState(false)
  const [scans, setScans] = useState([])
  const [showEmpty, setShowEmpty] = useState(false)
  const [pinned, setPinned] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [togglingAuto, setTogglingAuto] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  // Camera status every 4 s: a camera that comes online starts streaming without a reload.
  usePolling(async () => {
    try {
      const all = await deviceApi.list()
      const rows = all.filter((d) => !isSensor(d))
      setSensorCount(all.length - rows.length)
      setDevices(rows)
      setAutoId((cur) => {
        const current = rows.find((d) => String(d.id) === String(cur))
        if (current?.online) return cur
        return (rows.find((d) => d.online) || current || rows[0])?.id ?? null
      })
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, 4000)

  // The query param can change while the page is open (clicking 'Live' on another card).
  useEffect(() => {
    if (deviceParam) { setUserPick(deviceParam); setScans([]); setPinned(null); setNotice('') }
  }, [deviceParam])

  const list = devices || []
  const pickValid = userPick != null && list.some((d) => String(d.id) === String(userPick))
  const selectedId = pickValid ? userPick : autoId
  const device = list.find((d) => String(d.id) === String(selectedId))
  const operate = canOperate(device)
  const onlineCount = list.filter((d) => d.online).length

  usePolling(async () => {
    try { setScans(await deviceApi.scans(selectedId, 20, { detected: !showEmpty })) } catch { /* keep last list */ }
  }, 5000, `${selectedId}-${showEmpty}`, !!selectedId)

  // Esc closes the enlarged view
  useEffect(() => {
    if (!expanded) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  // pinned = clicked history row / manual scan just taken; otherwise the true latest scan (even "nothing detected")
  const latest = pinned ? (scans.find((s) => s.id === pinned.id) || pinned) : (device?.latest_scan || scans[0] || null)

  const scanNow = async () => {
    setScanning(true)
    setNotice('')
    try {
      const res = await deviceApi.scanNow(selectedId)
      if (res.queued) {
        setNotice('Scan requested — the camera will upload within a few seconds.')
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
    setScans((rows) => rows.map((s) => (s.id === updated.id ? updated : s)))
    setPinned((p) => (p?.id === updated.id ? updated : p))
    setDevices((rows) => rows?.map((d) => (d.latest_scan?.id === updated.id ? { ...d, latest_scan: updated } : d)))
  }

  const toggleAuto = async () => {
    setTogglingAuto(true)
    setNotice('')
    try {
      const updated = await deviceApi.update(selectedId, { auto_scan: !device.auto_scan })
      setDevices((rows) => rows.map((d) => (d.id === updated.id ? updated : d)))
    } catch (err) {
      setNotice(`Could not change automatic scans: ${err.message}`)
    } finally {
      setTogglingAuto(false)
    }
  }

  const selectDevice = (id, { scroll = false } = {}) => {
    if (String(id) !== String(selectedId)) {
      setScans([])
      setPinned(null)
      setNotice('')
    }
    setUserPick(id)
    if (scroll) viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const followAuto = () => {
    if (deviceParam) setSearchParams({}, { replace: true })
    setUserPick(null)
    setScans([])
    setPinned(null)
    setNotice('')
  }

  const scanScheduleText = !device ? '' : device.scan_mode === 'interval'
    ? `every ${Math.max(1, Math.round((device.scan_interval_s || 300) / 60))} min`
    : `at ${(device.capture_times?.length ? device.capture_times : ['07:00', '12:00', '16:00']).join(', ')}`

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Live Camera</h1>
          <p className="text-slate-500 text-sm mt-1">
            {devices ? `${onlineCount} of ${list.length} camera${list.length === 1 ? '' : 's'} online` : 'Connecting…'}
            {' • '}the live view opens on the first online camera and updates every few seconds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pickValid && (
            <button type="button" onClick={followAuto}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Auto-select online camera
            </button>
          )}
          {list.length > 0 && (
            <select value={selectedId ?? ''} onChange={(e) => selectDevice(e.target.value)} aria-label="Camera"
                    className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">
              {list.map((d) => (
                <option key={d.id} value={d.id}>{d.name} — {d.online ? 'online' : 'offline'}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">Couldn't load cameras: {error}. Retrying…</div>}
      {devices === null && !error && <p className="text-slate-400 animate-pulse">Loading cameras…</p>}

      {devices && list.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <Camera size={36} className="mx-auto text-slate-300" />
          <p className="mt-2 font-bold text-slate-700">No camera connected yet</p>
          <p className="text-sm text-slate-500">Stall operators pair their ESP32-CAM from the mobile app. Cameras appear here and on the <Link to="/devices" className="text-[#2A6B48] font-bold underline">Devices</Link> page.</p>
          {sensorCount > 0 && (
            <p className="text-sm text-slate-500 mt-2">
              Sensor nodes have no camera, so they are not listed here. See them on the <Link to="/sensors" className="text-[#2A6B48] font-bold underline">Sensors</Link> page.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {device && (
            <div ref={viewerRef}
                 className={expanded
                   ? 'fixed inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center gap-3 p-4'
                   : 'bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col scroll-mt-4'}>
              <div className={`p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-2 bg-slate-50 ${expanded ? 'w-full max-w-5xl rounded-xl' : ''}`}>
                <Link to={`/devices/${device.id}`} className="flex flex-wrap items-center gap-x-2 text-slate-800 font-bold hover:underline">
                  <Camera size={18} className="text-[#2A6B48]" /> {device.name}
                  <span className="text-xs font-normal text-slate-400">• {cropLabel(device.crop_type)} • {device.stall_location || 'no location'}</span>
                </Link>
                <span className="flex items-center gap-2">
                  <OnlinePill online={device.online} />
                  <button type="button" onClick={() => setExpanded((v) => !v)}
                          aria-label={expanded ? 'Close enlarged view' : 'Enlarge live view'}
                          className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-[#2A6B48]">
                    {expanded ? <X size={16} /> : <Maximize2 size={16} />}
                  </button>
                </span>
              </div>

              <LiveCameraView deviceId={device.id} online={device.online} scanning={scanning}
                              offlineText={offlineNote(device, now)}
                              className={expanded ? 'aspect-video w-full max-w-[min(64rem,calc((100vh-9rem)*16/9))] rounded-xl' : 'aspect-video w-full'} />

              {!expanded && (
                <>
                  <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className="flex items-center gap-1.5"><span className="font-bold text-slate-400 uppercase text-[10px]">Camera IP</span> <IpAddress ip={device.ip} online={device.online} /></span>
                      <NetworkFacts device={device} now={now} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <AccessBadge device={device} />
                    </div>
                  </div>

                  {operate ? (
                    <div className="p-5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <button onClick={scanNow} disabled={scanning || !device.online}
                              className="flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-slate-700 border-2 border-slate-200 bg-white hover:border-slate-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                        {scanning ? <Loader2 className="animate-spin" size={18} /> : <ScanLine size={18} />} Scan now
                      </button>
                      <button onClick={toggleAuto} disabled={togglingAuto}
                              className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-white shadow-sm disabled:opacity-60 ${device.auto_scan ? 'bg-rose-500 hover:bg-rose-600' : 'bg-[#2A6B48] hover:bg-[#1f5035]'}`}>
                        {device.auto_scan ? <StopCircle size={18} /> : <ScanLine size={18} />}
                        {device.auto_scan ? `Stop automatic scans (${scanScheduleText})` : 'Start automatic scans'}
                      </button>
                    </div>
                  ) : (
                    <p className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500 flex items-center gap-2">
                      <Eye size={14} /> {device.auto_scan ? `Automatic scans run ${scanScheduleText}.` : 'Automatic scans are off.'}
                    </p>
                  )}
                  {notice && <p role="status" className="px-5 pb-4 text-sm text-slate-600">{notice}</p>}
                </>
              )}
            </div>
          )}

          {list.length > 0 && (
            <section aria-labelledby="all-cameras">
              <h2 id="all-cameras" className="text-lg font-bold text-slate-800 mb-3">All cameras</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[...list].sort((a, b) => Number(b.online) - Number(a.online)).map((d) => (
                  <CameraTile key={d.id} device={d} now={now} selected={String(d.id) === String(selectedId)}
                              onSelect={() => selectDevice(d.id, { scroll: true })} />
                ))}
              </div>
            </section>
          )}

          <UploadAnalyzer />
        </div>

        <div className="space-y-6">
          {device && (
            <div className="space-y-2">
              <ScanResultCard scan={latest} title={pinned ? 'Selected scan' : 'Latest scan'} onScanUpdated={onScanUpdated} readOnly={!operate} />
              {pinned && (
                <button type="button" onClick={() => setPinned(null)} className="text-xs font-bold text-[#2A6B48] hover:underline">
                  ← Back to the latest scan
                </button>
              )}
            </div>
          )}

          {device && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col max-h-[640px]">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-slate-500" />
                  <h2 className="text-lg font-bold text-slate-800">Scan history</h2>
                </div>
                <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-md">{scans.length} scans</span>
              </div>
              <label className="px-5 py-2 border-b border-slate-100 flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
                <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
                Show empty scans (nothing detected)
              </label>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
                {scans.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-10 px-4">
                    {showEmpty ? 'Waiting for scans…' : 'No detections yet. Place one eggplant, cucumber or carrot in front of the camera.'}
                  </p>
                ) : scans.map((s) => {
                  const detected = isDetected(s)
                  return (
                    <button key={s.id} onClick={() => setPinned(s)}
                            className={`w-full text-left bg-white rounded-xl border p-3 flex gap-3 items-center ${latest?.id === s.id ? 'border-emerald-300' : 'border-slate-200'} ${detected ? '' : 'opacity-70'}`}>
                      {scanImageSrc(s) && <img src={scanImageSrc(s)} alt="" className="w-16 h-12 object-cover rounded-md bg-black" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-xs font-bold text-slate-400">{new Date(s.created_at).toLocaleTimeString()}</span>
                          <StatusBadge status={scanBadgeStatus(s)} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                          {!detected ? 'Nothing detected' : (
                            <>
                              {cropLabel(s.detected_crop || s.crop_type)}
                              {s.freshness_percent != null ? ` • ${Math.round(s.freshness_percent)}% fresh` : ''}
                              {` • ${Math.round((Number(s.ml_confidence) || 0) * 100)}% conf`}
                              {s.low_confidence ? ' ⚠' : ''}
                              {s.crop_mismatch && <AlertTriangle size={12} className="text-amber-500" aria-label="Crop mismatch" />}
                            </>
                          )}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
              <Link to="/gallery" className="p-3 border-t border-slate-100 text-xs font-bold text-[#2A6B48] hover:underline flex items-center justify-center gap-1.5">
                <ImageIcon size={14} /> Open the full scan gallery
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
