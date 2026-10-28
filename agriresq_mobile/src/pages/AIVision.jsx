import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ScanLine, Loader2, Plus, Settings2 } from 'lucide-react'
import { deviceApi, isSensor } from '../api/deviceApi'
import usePolling from '../hooks/usePolling'
import LiveCameraView from '../components/LiveCameraView'
import ScanResultCard from '../components/ScanResultCard'
import ErrorNotice from '../components/ErrorNotice'
import { SkeletonCard } from '../components/Skeleton'
import '../styles/devices.css'
import './AIVision.css'

/** Live AI scanner: pick one of the operator's ESP32-CAMs, watch it and run a freshness scan. */
export default function AIVision() {
  const [devices, setDevices] = useState(null) // cameras only: sensor nodes have no camera
  const [sensorCount, setSensorCount] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [loadError, setLoadError] = useState('')
  const followUp = useRef(null)

  useEffect(() => () => clearTimeout(followUp.current), [])

  const loadDevices = async () => {
    try {
      const all = await deviceApi.devices()
      const list = all.filter((d) => !isSensor(d))
      setSensorCount(all.length - list.length)
      setDevices(list)
      setLoadError('')
      setSelectedId((cur) => cur || String((list.find((d) => d.online) || list[0])?.id ?? ''))
    } catch (err) {
      setLoadError(err.message)
      setDevices((cur) => cur ?? [])
    }
  }

  usePolling(loadDevices, 10000)

  const device = devices?.find((d) => String(d.id) === String(selectedId))

  // show the camera's latest scan when switching cameras
  useEffect(() => { setResult(device?.latest_scan || null) }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    if (!device) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await deviceApi.scanNow(device.id)
      if (res.queued) {
        setMessage({ type: 'info', text: 'Scan requested. Fetching the result…' })
        clearTimeout(followUp.current)
        followUp.current = setTimeout(async () => {
          try {
            const [latest] = await deviceApi.scans(device.id, 1)
            if (latest) { setResult(latest); setMessage(null) }
          } catch { /* keep message */ }
        }, 6000)
      } else {
        setResult(res.scan)
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="page page-no-nav ai-vision">
        <Link to="/home" className="dev-back"><ArrowLeft size={16} /> Home</Link>
        <h1 className="dev-title">AI Freshness Scanner</h1>
        <p className="dev-subtitle">Detects eggplant, cucumber and carrot · fresh / at-risk / rotten</p>

        {message && <div className={`notice ${message.type}`}>{message.text}</div>}
        <ErrorNotice message={loadError} onRetry={loadDevices} hint="Check that the AgriResQ server is running and your phone is on the same Wi-Fi." />

        {devices === null && !loadError && <SkeletonCard lines={4} />}

        {devices?.length === 0 && !loadError && (
          <div className="card ai-empty">
            <p>You haven't connected a camera yet.</p>
            {sensorCount > 0 && <p className="muted">Sensor nodes have no camera. See their temperature and humidity under <Link to="/devices">Devices</Link>.</p>}
            <Link to="/devices/add" className="btn btn-green"><Plus size={18} /> Add a camera</Link>
          </div>
        )}

        {devices?.length > 0 && (
          <>
            <div className="input-group ai-picker">
              <label>Camera</label>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name || `Camera #${d.id}`}{d.online ? '' : ' (offline)'}</option>
                ))}
              </select>
            </div>

            {device && (
              <>
                <LiveCameraView deviceId={device.id} online={device.online} />
                <button className="btn btn-green ai-scan" onClick={scan} disabled={busy || !device.online}>
                  {busy ? <><Loader2 className="spin" size={18} /> Analysing…</> : <><ScanLine size={18} /> Snap &amp; analyse</>}
                </button>
                <Link to={`/devices/${device.id}`} className="ai-settings-link"><Settings2 size={14} /> Camera settings</Link>
                <ScanResultCard scan={result} title="Analysis result" onScanUpdated={setResult} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
