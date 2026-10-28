import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Camera, Droplets, Gauge, RefreshCw,Thermometer, Video } from 'lucide-react'
import { STALE_READING_MS, cropLabel, deviceApi, isDetected, isSensor, scanBadgeStatus, timeAgo } from '../api/deviceApi'
import { useNow, usePolling } from '../hooks/usePolling'
import StatusBadge from '../components/StatusBadge'
import { AccessBadge, IpAddress, AccessCount,NetworkFacts, OnlinePill, SensorBadge } from '../components/DeviceBits'

function DeviceCard({ device, now }) {
  const sensor = isSensor(device)
  const scan = sensor ? null : device.latest_scan
  const detected = isDetected(scan)
  const reading = device.latest_reading
  const noDht = device.dht_pin != null && device.dht_pin < 0
  const stale = reading && now - new Date(reading.created_at).getTime() > STALE_READING_MS
  return (
    <div className={`relative bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow ${device.online ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="flex justify-between items-start gap-3">
        <div className="flex gap-3 items-center min-w-0">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${device.online ? 'bg-emerald-50 text-[#2A6B48]' : 'bg-slate-100 text-slate-400'}`}>
            {sensor ? <Thermometer size={22} /> : <Camera size={22} />}
          </div>
          <div className="min-w-0">
            {/* stretched link: the whole card opens the detail page, while the IP buttons below stay clickable */}
            <h3 className="font-bold text-slate-800 truncate">
              <Link to={`/devices/${device.id}`} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-2 focus-visible:outline-[#2A6B48]">
                {device.name}
              </Link>
            </h3>
            <p className="text-xs text-slate-500 truncate">{device.stall_location || 'No location set'} • {cropLabel(device.crop_type)}</p>
          </div>
        </div>
        <OnlinePill online={device.online} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <SensorBadge device={device} />
        <AccessCount device={device} />
        <AccessBadge device={device} />
      </div>

      {!sensor && (
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400">Latest scan</p>
          <p className="text-xs text-slate-500">{scan ? timeAgo(scan.created_at, now) : '—'}</p>
        </div>
        <div className="text-right flex items-center gap-2">
          {scan && !detected && <span className="text-xs font-semibold text-slate-500">Nothing detected</span>}
          {scan && detected && scan.crop_mismatch && (
            <span className="text-[11px] font-bold text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> crop mismatch</span>
          )}
          {scan && detected && scan.freshness_percent != null && (
            <span className="text-sm font-bold text-slate-700">{Math.round(scan.freshness_percent)}%</span>
          )}
          <StatusBadge status={scanBadgeStatus(scan)} />
        </div>
      </div>
      )}

      {sensor && (
      <div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl p-3 bg-amber-50/60 flex items-center gap-2">
            <Thermometer size={18} className="text-amber-500 shrink-0" />
            <div>
              <p className="text-base font-bold text-slate-800">{reading ? `${Number(reading.temperature_c).toFixed(1)}°C` : '—'}</p>
              <p className="text-[10px] text-slate-500">Temp</p>
            </div>
          </div>
          <div className="rounded-xl p-3 bg-emerald-50/60 flex items-center gap-2">
            <Droplets size={18} className="text-[#2A6B48] shrink-0" />
            <div>
              <p className="text-base font-bold text-slate-800">{reading ? `${Number(reading.humidity_rh).toFixed(0)}%` : '—'}</p>
              <p className="text-[10px] text-slate-500">Humidity</p>
            </div>
          </div>
          <div className="rounded-xl p-3 bg-sky-50/70 flex items-center gap-2">
            <Gauge size={18} className="text-sky-500 shrink-0" />
            <div>
              <p className="text-base font-bold text-slate-800">{reading?.vpd_kpa != null ? Number(reading.vpd_kpa).toFixed(2) : '—'}</p>
              <p className="text-[10px] text-slate-500">VPD kPa</p>
            </div>
          </div>
        </div>
        <p className={`text-[11px] mt-1.5 ${stale ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
          {noDht
            ? 'No DHT22 configured yet (the administrator sets this)'
            : reading
              ? `${stale ? 'Stale reading: ' : 'Reading '}${timeAgo(reading.created_at, now)}`
              : 'Waiting for the first DHT22 reading'}
        </p>
      </div>
      )}

      {!sensor && (
        <Link to={`/ai-vision?device=${encodeURIComponent(device.id)}`}
              className="relative z-10 self-start px-3.5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 text-white bg-[#2A6B48] hover:bg-[#1f5035]"
              aria-label={`Open the live view of ${device.name}`}>
          <Video size={16} /> Live{device.online ? '' : ' (offline)'}
        </Link>
      )}

      <div className="text-[11px] text-slate-500 flex flex-col gap-1.5 border-t border-slate-100 pt-3">
        <span className="relative z-10 flex flex-wrap items-center gap-1.5">
          <span className="font-bold text-slate-400 uppercase text-[10px]">{sensor ? 'Device IP' : 'Camera IP'}</span>
          <IpAddress ip={device.ip} online={device.online} />
        </span>
        <NetworkFacts device={device} now={now} className="text-slate-400" />
      </div>
    </div>
  )
}

export default function Devices() {
  const now = useNow(5000)
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [filter, setFilter] = useState('all') // all | online | offline | attention

  usePolling(async () => {
    try {
      setDevices(await deviceApi.list())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, 5000, refreshKey)

  const list = devices || []
  const onlineCount = list.filter((d) => d.online).length
  const shown = list.filter((d) => {
    if (filter === 'online') return d.online
    if (filter === 'offline') return !d.online
    return true
  })
  const FILTERS = [['all', 'All'], ['online', 'Online'], ['offline', 'Offline']]

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Devices</h1>
          <p className="text-slate-500 text-sm mt-1">Every stall's ESP32-CAM freshness cameras (scans only) and DHT22 sensor nodes (temperature, humidity and VPD only) (the administrator can always access every camera). Stall operators add and configure devices in the mobile app.</p>
        </div>
        <button onClick={() => setRefreshKey((k) => k + 1)}
                className="px-4 py-2.5 rounded-xl font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 flex items-center gap-2">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Devices</p>
          <h2 className="text-4xl font-bold text-slate-800">{devices ? devices.length : '—'}</h2>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Online now</p>
          <h2 className="text-4xl font-bold text-[#2A6B48]">{devices ? onlineCount : '—'}</h2>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">At-risk / rotten in last scan</p>
          <h2 className="text-4xl font-bold text-amber-500">
            {devices ? list.filter((d) => isDetected(d.latest_scan) && ['AMBER', 'RED'].includes(d.latest_scan.freshness_status)).length : '—'}
          </h2>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">
          Couldn't load devices: {error}. Is the Django backend running?
        </div>
      )}

      {devices === null && !error && <p className="text-slate-400 animate-pulse">Loading devices…</p>}

      {devices && devices.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter devices">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}
                    className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border ${filter === value ? 'bg-[#2A6B48] text-white border-[#2A6B48]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {devices && devices.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center">
          <Camera size={40} className="mx-auto text-slate-300" />
          <h2 className="mt-3 text-lg font-bold text-slate-700">No devices registered yet</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Stall operators connect their ESP32-CAM or sensor node from the AgriResQ mobile app. It will appear here as soon as it is paired.
          </p>
        </div>
      )}

      {devices && devices.length > 0 && shown.length === 0 && (
        <p className="text-sm text-slate-500">No devices match this filter.</p>
      )}

      {shown.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {shown.map((d) => <DeviceCard key={d.id} device={d} now={now} />)}
        </div>
      )}
    </div>
  )
}
