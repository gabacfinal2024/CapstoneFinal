import { useEffect, useState } from 'react'
import { AlertCircle, CameraOff, RefreshCw, ScanLine } from 'lucide-react'
import { deviceApi } from '../api/deviceApi'
import { usePolling } from '../hooks/usePolling'

const MAX_REFRESH_MS = 9 * 60 * 1000 // signed URLs last 10 min
const REFRESH_MARGIN_MS = 60 * 1000 // renew this long before they expire
const MIN_REFRESH_MS = 20 * 1000
const URL_RETRY_MS = 8000 // backend unreachable: try again
const STREAM_RETRY_MS = 15000 // stream dropped, running on snapshots: try the stream again
const ERROR_RETRY_MS = 10000 // nothing works: automatic reconnect

function withParam(url, key, value) {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${value}`
}

/**
 * Live view of one ESP32-CAM, proxied through Django (works from any network the backend can see).
 *
 * - MJPEG stream first; if the browser can't keep it open, it falls back to refreshing snapshots
 *   and keeps retrying the stream in the background.
 * - The signed live URL is renewed shortly before `expires_at`.
 * - `preferSnapshot` (grid tiles) never opens a stream, which keeps the number of open browser
 *   connections low when many cameras are shown at once.
 * - When `online` flips the component restarts itself, so a camera that comes online starts
 *   streaming without a page reload.
 *
 * `offlineText` is shown under "Camera offline" (e.g. "Last seen 5 min ago").
 */
export default function LiveCameraView(props) {
  return <LiveCameraInner key={`${props.deviceId}-${props.online ? 'on' : 'off'}`} {...props} />
}

function LiveCameraInner({
  deviceId, online, scanning = false, overlay = null, preferSnapshot = false,
  snapshotMs = 1500, compact = false, offlineText = '', className = 'aspect-video w-full',
}) {
  const [urls, setUrls] = useState(null)
  const [mode, setMode] = useState(preferSnapshot ? 'snapshot' : 'stream') // stream | snapshot | error
  const [tick, setTick] = useState(0)
  const [snapshotFailures, setSnapshotFailures] = useState(0)
  const [error, setError] = useState('')
  const [generation, setGeneration] = useState(0)

  // Fetch the signed URLs and renew them before they expire. Retries on its own if the backend is unreachable.
  useEffect(() => {
    if (!online) return undefined
    let alive = true
    let timer
    const load = async () => {
      let delay
      try {
        const data = await deviceApi.live(deviceId)
        if (!alive) return
        setUrls(data)
        setError('')
        const ttl = data.expires_at ? new Date(data.expires_at).getTime() - Date.now() : MAX_REFRESH_MS + REFRESH_MARGIN_MS
        delay = Math.min(Math.max(ttl - REFRESH_MARGIN_MS, MIN_REFRESH_MS), MAX_REFRESH_MS)
      } catch (err) {
        if (!alive) return
        setError(err.message)
        delay = URL_RETRY_MS
      }
      timer = setTimeout(load, delay)
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [deviceId, online, generation])

  usePolling(() => setTick((t) => t + 1), snapshotMs, deviceId, online && mode === 'snapshot')

  // Auto-reconnect: after a failure, come back to the preferred mode on our own.
  useEffect(() => {
    if (!online || mode === 'stream') return undefined
    if (mode === 'snapshot' && preferSnapshot) return undefined
    const t = setTimeout(() => {
      setMode(preferSnapshot ? 'snapshot' : 'stream')
      setSnapshotFailures(0)
      setGeneration((g) => g + 1)
    }, mode === 'error' ? ERROR_RETRY_MS : STREAM_RETRY_MS)
    return () => clearTimeout(t)
  }, [mode, online, preferSnapshot])

  const retry = () => {
    setMode(preferSnapshot ? 'snapshot' : 'stream')
    setSnapshotFailures(0)
    setGeneration((g) => g + 1)
  }

  const iconSize = compact ? 28 : 44
  let body
  if (!online) {
    body = (
      <div className="text-center text-slate-400 p-4 flex flex-col items-center">
        <CameraOff size={iconSize} className="mb-2 opacity-70" />
        <p className="font-semibold text-white text-sm">Camera offline</p>
        {offlineText && <p className="text-xs mt-0.5">{offlineText}</p>}
        {!compact && <p className="text-xs mt-1 max-w-xs">Check that the ESP32-CAM is powered and within range of the stall Wi-Fi. This view starts by itself when it comes back online.</p>}
      </div>
    )
  } else if (mode === 'error' || (error && !urls)) {
    body = (
      <div className="text-center text-slate-400 p-4 flex flex-col items-center">
        <AlertCircle size={iconSize} className="mb-2 text-rose-500 opacity-80" />
        <p className="font-semibold text-white text-sm">Live view unavailable</p>
        {!compact && <p className="text-xs mt-1 max-w-xs">{error || 'The backend could not reach the camera.'} Reconnecting automatically…</p>}
        <button onClick={retry} className="mt-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg flex items-center gap-2">
          <RefreshCw size={12} /> Retry now
        </button>
      </div>
    )
  } else if (!urls) {
    body = <div className="text-slate-500 text-sm animate-pulse">Connecting to camera…</div>
  } else if (mode === 'stream') {
    body = (
      <img
        key={`stream-${generation}-${urls.stream_url}`}
        src={urls.stream_url}
        alt="ESP32-CAM live stream"
        className="w-full h-full object-contain"
        onError={() => setMode('snapshot')}
      />
    )
  } else {
    body = (
      <img
        src={withParam(urls.snapshot_url, 't', tick)}
        alt="ESP32-CAM snapshot"
        className="w-full h-full object-contain"
        onLoad={() => setSnapshotFailures(0)}
        onError={() => {
          const failures = snapshotFailures + 1
          setSnapshotFailures(failures)
          if (failures >= 4) setMode('error')
        }}
      />
    )
  }

  return (
    <div className={`relative bg-black flex items-center justify-center overflow-hidden ${className}`}>
      {body}
      {online && urls && mode !== 'error' && (
        <span className="absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-bold text-white bg-black/60 px-2 py-1 rounded-full">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          {mode === 'stream' ? 'LIVE' : 'SNAPSHOT'}
        </span>
      )}
      {scanning && (
        <div className="absolute top-3 left-3 bg-black/60 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-md border border-emerald-500/30 flex items-center gap-2 animate-pulse">
          <ScanLine size={14} /> Scanning…
        </div>
      )}
      {snapshotFailures > 0 && mode === 'snapshot' && (
        <span className="absolute bottom-2 left-2 text-[10px] text-amber-300 bg-black/60 px-2 py-1 rounded">Reconnecting…</span>
      )}
      {overlay}
    </div>
  )
}
