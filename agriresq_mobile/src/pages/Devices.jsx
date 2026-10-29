import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Plus, Thermometer, Droplets, ChevronRight, Wifi, RefreshCw, Images, AlertTriangle } from 'lucide-react'
import { deviceApi, timeAgo, signalLabel, isReadingStale, isSensor, deviceFallbackName } from '../api/deviceApi'
import usePolling from '../hooks/usePolling'
import { CROP_LABELS } from '../utils/helpers'
import { ScanChip, isNoVegetable } from '../components/ScanResultCard'
import OnlinePill from '../components/OnlinePill'
import { AccessBadge, SensorBadge } from '../components/MonitorBadges'
import ErrorNotice from '../components/ErrorNotice'
import { SkeletonCard } from '../components/Skeleton'
import BottomNav from '../components/BottomNav'
import '../styles/devices.css'
import './Devices.css'

const REFRESH_MS = 5000

export default function Devices() {
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    try {
      setDevices(await deviceApi.devices())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  usePolling(load, REFRESH_MS)

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const onlineCount = devices?.filter((d) => d.online).length ?? 0

  return (
    <div className="app-shell">
      <div className="page devices-page">
        <header className="devices-header">
          <div>
            <h1 className="dev-title">My Devices</h1>
            <p className="dev-subtitle">
              {devices ? `${onlineCount} of ${devices.length} online` : 'ESP32-CAM scanners and sensor nodes'}
            </p>
          </div>
          <div className="devices-actions">
            <button type="button" className="icon-action" onClick={refresh} disabled={refreshing} aria-label="Refresh devices">
              <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
            </button>
            <Link to="/gallery" className="icon-action" aria-label="Scan gallery"><Images size={18} /></Link>
            <Link to="/devices/add" className="devices-add"><Plus size={18} /> Add</Link>
          </div>
        </header>

        <ErrorNotice
          message={error}
          onRetry={refresh}
          retrying={refreshing}
          hint={devices ? 'Showing the last information we received.' : 'Check that the AgriResQ server is running and your phone is on the same Wi-Fi.'}
        />

        {devices === null && !error && (
          <div className="devices-list" aria-busy="true">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
        )}

        {devices?.length === 0 && (
          <div className="card devices-empty">
            <div className="devices-empty__icon"><Camera size={30} /></div>
            <h3>Connect your first device</h3>
            <ol>
              <li>Plug in the AgriResQ ESP32-CAM near your produce.</li>
              <li>Tap <strong>Add device</strong>: the app will show you how to connect it to your stall's Wi-Fi.</li>
              <li>A camera scans freshness at your chosen times; a separate sensor node reports the stall's temperature and humidity. Results show here.</li>
            </ol>
            <Link to="/devices/add" className="btn btn-green"><Plus size={18} /> Add device</Link>
          </div>
        )}

        <div className="devices-list">
          {devices?.map((d) => (
            <Link key={d.id} to={`/devices/${d.id}`} className="card device-card">
              <div className="device-card__top">
                <div className="device-card__icon">{isSensor(d) ? <Thermometer size={22} /> : <Camera size={22} />}</div>
                <div className="device-card__name">
                  <strong>{d.name || deviceFallbackName(d)}</strong>
                  <span>{d.stall_location || 'No stall set'} · {CROP_LABELS[d.crop_type] || d.crop_type}</span>
                </div>
                <OnlinePill online={d.online} />
              </div>

              <div className="device-card__stats">
                {isSensor(d) ? (
                  <div className="device-card__scan"><SensorBadge device={d} /></div>
                ) : (
                  <div className="device-card__scan">
                    <ScanChip scan={d.latest_scan} />
                    {d.latest_scan && (
                      <span className="device-card__ago">
                        {isNoVegetable(d.latest_scan) ? 'Nothing in view · ' : ''}scanned {timeAgo(d.latest_scan.created_at)}
                      </span>
                    )}
                  </div>
                )}
                {isSensor(d) && (
                  <div className="device-card__env" title={d.latest_reading ? `Sensor updated ${timeAgo(d.latest_reading.created_at)}` : 'No sensor reading'}
                    style={d.latest_reading && isReadingStale(d.latest_reading.created_at) ? { opacity: 0.55 } : undefined}>
                    <span><Thermometer size={14} /> {d.latest_reading ? `${Number(d.latest_reading.temperature_c).toFixed(1)}°C` : '—'}</span>
                    <span><Droplets size={14} /> {d.latest_reading ? `${Number(d.latest_reading.humidity_rh).toFixed(1)}%` : '—'}</span>
                    {d.latest_reading && isReadingStale(d.latest_reading.created_at) && <span style={{ color: '#92400E' }}><AlertTriangle size={13} /> old</span>}
                  </div>
                )}
              </div>

              <div className="device-card__net">
                <span title={d.ip || ''}>IP <b className="mono">{d.ip || '—'}</b></span>
                <span title={d.wifi_ssid || ''}>Wi-Fi <b>{d.wifi_ssid || '—'}</b></span>
                <span>Signal <b>{d.rssi != null ? `${signalLabel(d.rssi)} (${d.rssi})` : '—'}</b></span>
                <span>Firmware <b>{d.fw_version || '—'}</b></span>
              </div>

              {d.my_access === 'monitor' && (
                <div className="device-card__badges">
                  <AccessBadge device={d} />
                </div>
              )}

              <div className="device-card__foot">
                <span><Wifi size={13} /> {d.online ? 'Online' : 'Offline'} · last seen {timeAgo(d.last_seen)}</span>
                <ChevronRight size={18} />
              </div>
            </Link>
          ))}
        </div>
      </div>
      <BottomNav />
    </div>
  )
}
