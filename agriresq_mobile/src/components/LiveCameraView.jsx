import { useEffect, useRef, useState } from 'react'
import { CameraOff, RefreshCw } from 'lucide-react'
import { deviceApi } from '../api/deviceApi'
import './LiveCameraView.css'

const SNAPSHOT_INTERVAL_MS = 1500
const URL_REFRESH_MS = 8 * 60 * 1000 // signed URLs last 10 min

/**
 * Live ESP32-CAM frames are relayed through Django so cloud-hosted apps never
 * need a direct network connection to the camera.
 */
export default function LiveCameraView({ deviceId, online = true }) {
  const [urls, setUrls] = useState(null)
  const [snapSrc, setSnapSrc] = useState('')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const snapFailures = useRef(0)

  useEffect(() => {
    if (!deviceId || !online) return undefined
    let cancelled = false
    const load = () => {
      if (document.hidden) return
      deviceApi.live(deviceId)
        .then((u) => { if (!cancelled) { setUrls(u); setError('') } })
        .catch((err) => { if (!cancelled) setError(err.message) })
    }
    load()
    const t = setInterval(load, URL_REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [deviceId, online, reloadKey])

  useEffect(() => {
    if (!urls?.snapshot_url || error) return undefined
    const tick = () => {
      if (document.hidden) return
      const sep = urls.snapshot_url.includes('?') ? '&' : '?'
      setSnapSrc(`${urls.snapshot_url}${sep}t=${Date.now()}`)
    }
    tick()
    const t = setInterval(tick, SNAPSHOT_INTERVAL_MS)
    return () => clearInterval(t)
  }, [urls, error])

  useEffect(() => {
    if (!error) return undefined
    const timer = setTimeout(() => {
      snapFailures.current = 0
      setError('')
      setReloadKey((key) => key + 1)
    }, 8000)
    return () => clearTimeout(timer)
  }, [error])

  const retry = () => {
    snapFailures.current = 0
    setError('')
    setReloadKey((k) => k + 1)
  }

  if (!online) {
    return (
      <div className="live-view live-view--offline">
        <CameraOff size={34} />
        <p>Camera is offline</p>
        <span>Check that it has power and Wi-Fi.</span>
      </div>
    )
  }

  return (
    <div className="live-view">
      {error && (
        <div className="live-view__overlay">
          <CameraOff size={30} />
          <p>{error}</p>
          <button type="button" className="btn btn-small" onClick={retry}><RefreshCw size={14} /> Retry</button>
        </div>
      )}
      {!error && !urls && <div className="live-view__overlay"><p>Connecting to camera…</p></div>}
      {!error && urls && snapSrc && (
        <img
          src={snapSrc}
          alt="Camera snapshot"
          onLoad={() => { snapFailures.current = 0 }}
          onError={() => {
            snapFailures.current += 1
            if (snapFailures.current >= 4) setError('Live view unavailable right now.')
          }}
        />
      )}
      {urls && !error && <span className="live-view__badge"><span className="live-dot" /> LIVE</span>}
    </div>
  )
}
