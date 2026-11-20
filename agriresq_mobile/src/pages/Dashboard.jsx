import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import { CROP_IMAGES, CROP_LABELS } from '../utils/helpers'
import IoTReadings from '../components/IoTReadings'
import BatchCard from '../components/BatchCard'
import ProduceCard from '../components/ProduceCard'
import PageTitle from '../components/PageTitle'
import BottomNav from '../components/BottomNav'
import ErrorNotice from '../components/ErrorNotice'
import marketHarvest from '../assets/market-harvest.webp'
import './Dashboard.css'
import { Bell, Plus, ArrowRight, ChevronRight, AlertTriangle, Thermometer, Droplets } from 'lucide-react'
import { deviceApi, timeAgo, isReadingStale, isSensor, deviceFallbackName } from '../api/deviceApi'
import usePolling from '../hooks/usePolling'
import useEntryState from '../hooks/useEntryState'
import { useNotifications } from '../context/NotificationsContext'

export default function Dashboard() {
  const { user, isOperator } = useAuth()
  const { unread } = useNotifications()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recommended, setRecommended] = useState(null)
  const [homeError, setHomeError] = useState('')
  const [recommendationsError, setRecommendationsError] = useState('')
  const [devices, setDevices] = useState(null)
  const [sensorError, setSensorError] = useState('')
  const [batchView, setBatchView] = useEntryState('home-batches', 'all')
  const batchSection = useRef(null)

  const load = () => {
    api.dashboard()
      .then((result) => { setData(result); setHomeError('') })
      .catch((error) => setHomeError(error.message || 'Could not load your batches.'))
      .finally(() => setLoading(false))
  }

  const loadRecommended = () => {
    api.marketplace()
      .then((result) => { setRecommended((result || []).slice(0, 4)); setRecommendationsError('') })
      .catch((error) => setRecommendationsError(error.message || 'Could not load available produce.'))
  }

  const loadDevices = () =>
    deviceApi.devices()
      .then((result) => { setDevices(result); setSensorError('') })
      .catch((error) => setSensorError(error.message || 'Could not load stall sensors.'))

  // polling pauses while the tab is hidden and always cleans up on unmount
  usePolling(loadDevices, 15000, { enabled: !!isOperator })
  usePolling(load, 30000, { enabled: !!isOperator })

  useEffect(() => {
    if (!isOperator) loadRecommended()
  }, [isOperator])

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
  const batches = data?.active_batches ?? []
  const visibleBatches = batchView === 'at-risk' ? batches.filter((batch) => batch.freshness_status === 'AMBER') : batches
  const Greeting = isOperator ? 'h1' : 'p'

  const showBatches = (view) => {
    setBatchView(view)
    batchSection.current?.focus({ preventScroll: true })
    batchSection.current?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="app-shell">
      <div className="page dashboard">
        <header className="dash-header">
          <div>
            <Greeting className="dashboard-greeting">{user?.full_name || user?.email?.split('@')[0] || 'Home'}</Greeting>
            <p className="role-tag">{isOperator
              ? `Stall Operator${user?.stall_number ? ` · Stall ${user.stall_number}` : ''}`
              : 'Rescue Buyer'}</p>
          </div>
          <Link to="/notifications" className="notif-btn" aria-label="Notifications"><Bell size={20} aria-hidden="true" />{unread > 0 && (<span className="notif-badge">{unread > 9 ? '9+' : unread}</span>)}</Link>
        </header>

        {!isOperator && (
          <header className="page-title-header">
            <PageTitle>Home</PageTitle>
          </header>
        )}

        {isOperator ? (
          <section className="stall-overview dash-section" aria-labelledby="stall-overview-title">
            <div className="stall-overview__header">
              <h2 id="stall-overview-title">Stall overview</h2>
              <Link to="/batch/new" className="home-primary-action"><Plus size={18} aria-hidden="true" /> Add batch</Link>
            </div>
            <div className="stall-metrics" role="group" aria-label="Stall activity">
              <button type="button" aria-controls="home-batches" aria-pressed={batchView === 'all'} onClick={() => showBatches('all')}>
                <strong>{data ? batches.length : '—'}</strong><span>Active batches</span>
              </button>
              <button type="button" className={data?.at_risk_count > 0 ? 'is-attention' : ''} aria-controls="home-batches"
                aria-pressed={batchView === 'at-risk'} onClick={() => showBatches('at-risk')}>
                <strong>{data?.at_risk_count ?? '—'}</strong><span>At-risk batches</span>
              </button>
            </div>
          </section>
        ) : (
          <section className="buyer-feature dash-section" aria-labelledby="buyer-feature-title">
            <img src={marketHarvest} alt="" width="1440" height="960" fetchPriority="high" />
            <div className="buyer-feature__content">
              <h2 id="buyer-feature-title">Rescue local produce</h2>
              <p>Find available batches and arrange pickup with the stall.</p>
              <Link to="/marketplace" className="home-primary-action">Browse listings <ArrowRight size={17} aria-hidden="true" /></Link>
            </div>
          </section>
        )}

        {!isOperator && (
          <section className="dash-section home-crops" aria-labelledby="home-crops-title">
            <h2 id="home-crops-title" className="section-title">Shop by crop</h2>
            <div className="home-crops__grid">
              {Object.entries(CROP_IMAGES).map(([crop, image]) => (
                <Link key={crop} to="/marketplace" state={{ crop }}>
                  <img src={image} alt="" width="100" height="60" />
                  <span>{CROP_LABELS[crop]}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {isOperator ? (
          <section ref={batchSection} className="dash-section home-batches" id="home-batches" tabIndex={-1} aria-labelledby="home-batches-title">
            <div className="section-row">
              <h2 id="home-batches-title" className="section-title">{batchView === 'at-risk' ? 'At-risk batches' : 'My Batches'}</h2>
              {batchView === 'at-risk' && <button className="add-link home-batches__reset" type="button" onClick={() => showBatches('all')}>Show all batches</button>}
            </div>
            <ErrorNotice message={homeError} onRetry={load} />
            {loading ? (
              <p className="muted">Loading...</p>
            ) : visibleBatches.length ? (
              visibleBatches.map((batch) => <BatchCard key={batch.id} batch={batch} />)
            ) : !homeError && (
              <div className="empty-state card">
                <p>{batchView === 'at-risk' ? 'No at-risk batches right now.' : 'No active batches yet. Add a batch to start listing produce.'}</p>
              </div>
            )}
          </section>
        ) : (
          <section className="dash-section">
            <div className="section-row">
              <h2 className="section-title">Available to rescue</h2>
              <Link to="/marketplace" className="add-link">See all <ChevronRight size={16} /></Link>
            </div>
            <ErrorNotice message={recommendationsError} onRetry={loadRecommended} />
            {recommendationsError ? null : recommended === null ? (
              <p className="muted">Loading...</p>
            ) : recommended.length ? (
              <div className="listing-grid">
                {recommended.map((listing) => <ProduceCard key={listing.id} listing={listing} />)}
              </div>
            ) : (
              <div className="empty-state card">
                <p>No listings right now.</p>
              </div>
            )}
          </section>
        )}

        {isOperator && (
          <section className="dash-section">
            <h2 className="section-title">Stall sensors</h2>
            <ErrorNotice message={sensorError} onRetry={loadDevices} hint={devices ? 'Showing the last information we received.' : undefined} />
            <IoTReadings temp={showTemp} humidity={showHum} vpd={latestDeviceReading?.vpd_kpa} />
            {latestDeviceReading ? (
              <p className={`sensor-caption${freshestIsStale ? ' is-stale' : ''}`}>
                {freshestIsStale && <AlertTriangle size={13} />}
                {freshestDevice?.name || 'Sensor node'} DHT22 · {freshestIsStale ? `old reading, ${timeAgo(latestDeviceReading.created_at)}. Check the sensor.` : `updated ${timeAgo(latestDeviceReading.created_at)}`}
              </p>
            ) : !sensorError && (
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
