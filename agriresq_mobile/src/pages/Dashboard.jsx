import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import IoTReadings from '../components/IoTReadings'
import BatchCard from '../components/BatchCard'
import ProduceCard from '../components/ProduceCard'
import StallClimateCard from '../components/StallClimateCard'
import BottomNav from '../components/BottomNav'
import './Dashboard.css'
import { supabase } from '../lib/supabase'
import { Bell, Plus, ArrowUpRight, Camera, ChevronRight, AlertTriangle, Thermometer, Droplets } from 'lucide-react'
import { deviceApi, timeAgo, isReadingStale, isSensor, deviceFallbackName } from '../api/deviceApi'
import usePolling from '../hooks/usePolling'
import { useNotifications } from '../context/NotificationsContext'
import { scanSummary } from '../components/ScanResultCard'

export default function Dashboard() {
  const { user, isOperator } = useAuth()
  const { unread } = useNotifications()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recommended, setRecommended] = useState(null)
  const prevSafeRef = useRef(true)
  const [devices, setDevices] = useState(null)

  const load = () => {
    api.dashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  const loadRecommended = () => {
    // For buyers: fetch a few marketplace listings
    api.marketplace().then((res) => setRecommended((res || []).slice(0, 5))).catch(() => setRecommended([]))
  }

  const loadDevices = () => {
    // keep the last good list if a refresh fails (a flaky Wi-Fi blip should not blank the card)
    deviceApi.devices().then(setDevices).catch(() => {})
  }

  // polling pauses while the tab is hidden and always cleans up on unmount
  usePolling(loadDevices, 15000, { enabled: !!isOperator })
  usePolling(load, 30000)

  useEffect(() => {
    if (!isOperator) loadRecommended()
  }, [isOperator])

  const alertReading = (devices || []).filter((d) => isSensor(d)).map((d) => d.latest_reading).filter(Boolean)
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0]

  useEffect(() => {
    // Only notify operators, from the stall's sensor node (the only source of temperature/humidity)
    if (!user || !alertReading) return
    const isOperator = user?.role === 'STALL_OPERATOR'
    if (!isOperator) return
    if (isReadingStale(alertReading.created_at)) return
    const temp = alertReading.temperature_c
    const humidity = alertReading.humidity_rh
    const overThreshold = (temp != null && temp > 30) || (humidity != null && humidity > 85)
    if (overThreshold && prevSafeRef.current) {
      // create an in-app notification for the operator
      // (a Supabase query builder has no .catch: await it inside try/catch instead)
      const alertText = `Sensor reading outside safe range: ${temp != null ? `${Number(temp).toFixed(1)}°C` : ''} ${humidity != null ? `${Number(humidity)}% RH` : ''}`
      ;(async () => {
        try {
          const { error } = await supabase.from('notifications').insert({
            user_id: user.id,
            notification_type: 'IOT_ALERT',
            title: 'IoT Alert',
            message: alertText,
          })
          if (error) console.error(error)
        } catch (err) {
          console.error(err)
        }
      })()
      prevSafeRef.current = false
    }
    if (!overThreshold) prevSafeRef.current = true
  }, [alertReading?.created_at, user])

  // Newest scan from any camera (to show "Nothing detected" vs a real result)
  const latestDeviceScan = (devices || [])
    .map((d) => d.latest_scan)
    .filter(Boolean)
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0]

  // Only sensor nodes carry a DHT22 reading (cameras have none): newest reading across the stall's sensor nodes
  const sensorNodes = (devices || []).filter((d) => isSensor(d))
  const latestDeviceReading = sensorNodes
    .map((d) => d.latest_reading)
    .filter(Boolean)
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0]

  const freshestIsStale = latestDeviceReading ? isReadingStale(latestDeviceReading.created_at) : false
  const freshestDevice = latestDeviceReading
    ? sensorNodes.find((d) => d.latest_reading && d.latest_reading.created_at === latestDeviceReading.created_at)
    : null
  const showTemp = latestDeviceReading?.temperature_c
  const showHum = latestDeviceReading?.humidity_rh

  return (
    <div className="app-shell">
      <div className="page dashboard">
        <header className="dash-header">
          <div>
            <p className="dash-greet">Good day,</p>
            <h1>{user?.full_name || user?.email?.split('@')[0]}</h1>
            <p className="role-tag">{isOperator ? 'Stall Operator' : 'Rescue Buyer'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link to="/notifications" className="notif-btn" aria-label="Notifications"><Bell size={20} strokeWidth={2.2} />{unread > 0 && (<span className="notif-badge">{unread > 9 ? '9+' : unread}</span>)}</Link>
          </div>
        </header>

        {isOperator && (
          <section className="dash-section">
            <h2 className="section-title">Stall sensors</h2>
            <IoTReadings temp={showTemp} humidity={showHum} vpd={latestDeviceReading?.vpd_kpa} />
            {latestDeviceReading ? (
              <p className={`sensor-caption${freshestIsStale ? ' is-stale' : ''}`}>
                {freshestIsStale && <AlertTriangle size={13} />}
                {freshestDevice?.name || 'Sensor node'} DHT22 · {freshestIsStale ? `old reading, ${timeAgo(latestDeviceReading.created_at)}. Check the sensor.` : `updated ${timeAgo(latestDeviceReading.created_at)}`}
              </p>
            ) : (
              <p className="sensor-caption">
                {devices === null
                  ? 'Loading sensors…'
                  : sensorNodes.length === 0
                    ? 'No sensor node connected yet. Cameras do not measure temperature or humidity.'
                    : 'No DHT22 reading from your sensor node yet. Open it to check the sensor.'}
              </p>
            )}
            {sensorNodes.length > 0 ? (
              <div className="card sensor-rows">
                {sensorNodes.map((d) => (
                  <Link key={d.id} to={`/devices/${d.id}`} className="sensor-row">
                    <span className="sensor-row__name"><Thermometer size={14} /> {d.name || deviceFallbackName(d)}</span>
                    {d.latest_reading ? (
                      <span className={`sensor-row__vals${isReadingStale(d.latest_reading.created_at) ? ' is-stale' : ''}`}>
                        <span>{Number(d.latest_reading.temperature_c).toFixed(1)}°C</span>
                        <span><Droplets size={13} /> {Number(d.latest_reading.humidity_rh).toFixed(0)}%</span>
                        <small>{isReadingStale(d.latest_reading.created_at) ? 'old · ' : ''}{timeAgo(d.latest_reading.created_at)}</small>
                        <ChevronRight size={16} />
                      </span>
                    ) : (
                      <span className="sensor-row__vals is-none">{d.dht_pin >= 0 ? 'Waiting for reading' : 'No sensor'} <ChevronRight size={16} /></span>
                    )}
                  </Link>
                ))}
              </div>
            ) : devices !== null && (
              <Link to="/devices/add" className="card sensor-empty-link">
                <Plus size={16} /> Add a sensor node to see live temperature and humidity
              </Link>
            )}
            <StallClimateCard crops={(data?.active_batches || []).map((b) => b.crop_type)} />
          </section>
        )}

        {isOperator && (
          <section className="dash-section">
            <Link to="/devices" className="card dash-devices">
              <div className="dash-devices__icon"><Camera size={22} /></div>
              <div className="dash-devices__text">
                <strong>My devices</strong>
                <span>
                  {devices === null
                    ? 'ESP32-CAM scanners and sensor nodes'
                    : devices.length === 0
                      ? 'No device yet: tap to add one'
                      : `${devices.filter((d) => d.online).length} of ${devices.length} online`}
                </span>
                {latestDeviceScan && (
                  <span className="dash-devices__scan">
                    {scanSummary(latestDeviceScan)} · {timeAgo(latestDeviceScan.created_at)}
                  </span>
                )}
              </div>
              <ChevronRight size={18} />
            </Link>
          </section>
        )}

        {isOperator && data?.at_risk_count > 0 && (
          <div className="alert-banner">
            ⚠️ {data.at_risk_count} batch(es) at risk — auto-discount applied & listed in Listings
          </div>
        )}

        {isOperator ? (
          <section className="dash-section">
            <div className="section-row">
              <h2 className="section-title">My Batches</h2>
              <Link to="/batch/new" className="add-link"><Plus size={16} /> Add Product</Link>
            </div>
            {loading ? (
              <p className="muted">Loading...</p>
            ) : data?.active_batches?.length ? (
              data.active_batches.map((b) => <BatchCard key={b.id} batch={b} />)
            ) : (
              <div className="empty-state card">
                <p>No active batches yet.</p>
                <Link to="/batch/new">Add product (ESP32-CAM scan) <ArrowUpRight size={15} /></Link>
              </div>
            )}
          </section>
        ) : (
          <section className="dash-section">
            <div className="section-row">
              <h2 className="section-title">Fresh Picks</h2>
              <Link to="/marketplace" className="add-link">See all <ChevronRight size={16} /></Link>
            </div>
            {recommended === null ? (
              <p className="muted">Loading...</p>
            ) : recommended.length ? (
              recommended.map((l) => <ProduceCard key={l.id} listing={l} />)
            ) : (
              <div className="empty-state card">
                <p>No listings right now.</p>
                <p className="muted">Check back soon: vendors list surplus produce at a discount.</p>
              </div>
            )}
          </section>
        )}
        {isOperator && (
          <section className="dash-section">
            <h2 className="section-title">Dynamic Pricing</h2>
            <div className="pricing-legend card">
              <div><span className="legend-dot fresh" /> Fresh — full price</div>
              <div><span className="legend-dot at-risk" /> At-Risk — 30% auto-discount</div>
              <div><span className="legend-dot spoiled" /> Rotten — removed from market</div>
            </div>
          </section>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
