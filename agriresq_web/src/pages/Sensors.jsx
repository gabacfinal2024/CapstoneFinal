import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock, Droplets, Flame, Gauge, Settings2, Thermometer, Wind } from 'lucide-react'
import { STALE_READING_MS, cropLabel, deviceApi, formatDateTime, isSensor, timeAgo } from '../api/deviceApi'
import { api } from '../api/supabaseApi'
import { freshnessMeta, pairedSensor } from '../lib/format'
import { useNow, usePolling } from '../hooks/usePolling'
import ReadingsChart from '../components/ReadingsChart'
import { IpAddress, NetworkFacts, OnlinePill, SensorBadge } from '../components/DeviceBits'

const STRESS_TEMP = 25 // spoilage_engine stress threshold (°C)
const ALERT_TEMP = 30 // IoT alert threshold (°C)
const DRY_VPD = 1.0 // kPa above which stored produce loses water quickly
const WINDOWS = [30, 60, 120, 240] // readings shown in the chart / stats
const CROP_KEYS = ['EGGPLANT', 'CUCUMBER', 'CARROT']
const BATCH_PAGE = 15

const CROP_RANGES = [
  { crop: 'EGGPLANT', optimal: '10–12°C, 90–95% RH', stress: 25 },
  { crop: 'CUCUMBER', optimal: '10–13°C, 95% RH', stress: 25 },
  { crop: 'CARROT', optimal: '0–1°C, 98% RH', stress: 25 },
]

const hasDht = (device) => device.dht_pin != null && device.dht_pin >= 0
const readingAge = (reading, now) => (reading ? now - new Date(reading.created_at).getTime() : Infinity)
const isStale = (reading, now) => readingAge(reading, now) > STALE_READING_MS
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const stallLabel = (n) => (/^stall/i.test(String(n)) ? String(n) : `Stall ${n}`)

const TONES = {
  slate: 'bg-slate-50 border-slate-200 text-slate-600',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  rose: 'bg-rose-50 border-rose-200 text-rose-800',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
}

/** One-line status for a device card. `title` carries the longer advice. */
function conditionStatus({ configured, reading, stale, now }) {
  if (!configured) {
    return { Icon: Settings2, tone: 'slate', text: 'No DHT22 configured', title: 'Wire a DHT22, then pick its data pin under Device settings.' }
  }
  if (!reading) {
    return { Icon: Clock, tone: 'slate', text: 'Waiting for the first DHT22 reading', title: 'If nothing arrives, check the wiring (data pin, 3.3 V, ground) and that the node is online.' }
  }
  if (stale) {
    return { Icon: AlertTriangle, tone: 'amber', text: `Stale reading: last data ${timeAgo(reading.created_at, now)}`, title: 'The node may be offline or the DHT22 stopped responding. Check power, Wi-Fi and the sensor wiring.' }
  }
  const t = num(reading.temperature_c)
  const vpd = num(reading.vpd_kpa)
  if (t != null && t > ALERT_TEMP) {
    return { Icon: Flame, tone: 'rose', text: `High heat: ${t.toFixed(1)}°C is above the ${ALERT_TEMP}°C alert level`, title: 'Heat units (CHU) are accumulating fast and shelf life is shrinking.' }
  }
  if (vpd != null && vpd > DRY_VPD) {
    return { Icon: Wind, tone: 'amber', text: `Dry air: VPD ${vpd.toFixed(2)} kPa is high`, title: 'High vapour-pressure deficit dries produce out. Keep the stall cooler or more humid.' }
  }
  if (t != null && t > STRESS_TEMP) {
    return { Icon: Thermometer, tone: 'amber', text: `Warm: above the ${STRESS_TEMP}°C stress threshold`, title: 'Shelf life is shortening faster than normal.' }
  }
  return { Icon: CheckCircle2, tone: 'emerald', text: 'Conditions OK: within range', title: 'Temperature and VPD are within the safe range.' }
}

/** min / avg / max of a numeric field over the readings window. */
function statsFor(readings, key) {
  const values = readings.map((r) => Number(r[key])).filter((v) => Number.isFinite(v))
  if (values.length === 0) return null
  return {
    min: Math.min(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    max: Math.max(...values),
  }
}

function StatsTable({ readings }) {
  const rows = [
    { label: 'Temperature', unit: '°C', digits: 1, stats: statsFor(readings, 'temperature_c') },
    { label: 'Humidity', unit: '%', digits: 0, stats: statsFor(readings, 'humidity_rh') },
    { label: 'VPD', unit: ' kPa', digits: 2, stats: statsFor(readings, 'vpd_kpa') },
  ]
  const oldest = readings[readings.length - 1]
  const newest = readings[0]
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 truncate">
        Min / avg / max • {readings.length} readings
        {oldest && <span className="normal-case font-medium"> ({formatDateTime(oldest.created_at)} to {formatDateTime(newest.created_at)})</span>}
      </p>
      <table className="w-full text-sm table-fixed">
        <thead className="text-[11px] text-slate-400 uppercase">
          <tr>
            <th scope="col" className="text-left font-bold pb-1 w-[34%]">Metric</th>
            <th scope="col" className="text-right font-bold pb-1">Min</th>
            <th scope="col" className="text-right font-bold pb-1">Avg</th>
            <th scope="col" className="text-right font-bold pb-1">Max</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(({ label, unit, digits, stats }) => (
            <tr key={label}>
              <th scope="row" className="text-left font-semibold text-slate-600 py-1">{label}</th>
              {['min', 'avg', 'max'].map((k) => (
                <td key={k} className="text-right text-slate-800 font-bold py-1 tabular-nums">{stats ? `${stats[k].toFixed(digits)}${unit}` : '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Same-size reading tile used on every device card. */
function Tile({ icon: Icon, iconCls, tone, value, label, hint }) {
  return (
    <div className={`rounded-xl px-3 py-3 min-w-0 ${tone}`}>
      <p className="text-xl font-bold text-slate-800 leading-none flex items-center gap-1.5 whitespace-nowrap tabular-nums">
        <Icon size={16} className={`shrink-0 ${iconCls}`} />
        <span className="truncate">{value}</span>
      </p>
      <p className="text-xs font-semibold mt-2 text-slate-600 truncate">{label}</p>
      <p className="text-[11px] text-slate-400 truncate">{hint}</p>
    </div>
  )
}

/** Heat units for a device: its linked batch, else the highest of its stall's batches. */
function heatUnitsFor(device, batches) {
  if (!batches) return { value: null, hint: 'loading…' }
  const mine = batches.filter((b) => b.operatorId === device.operator_id && b.sensor.chu != null)
  const linked = batches.find((b) => b.id === device.product_id && b.sensor.chu != null)
  if (linked) return { value: linked.sensor.chu, hint: `batch #${linked.id}` }
  if (mine.length > 0) {
    const top = mine.reduce((a, b) => (b.sensor.chu > a.sensor.chu ? b : a))
    return { value: top.sensor.chu, hint: `batch #${top.id}${mine.length > 1 ? ` (highest of ${mine.length})` : ''}` }
  }
  return { value: null, hint: 'no paired batch' }
}

function DeviceCard({ device, now, windowSize, batches }) {
  const configured = hasDht(device)
  const [readings, setReadings] = useState(null) // newest first
  const [readError, setReadError] = useState('')

  usePolling(async () => {
    try {
      setReadings(await deviceApi.readings(device.id, windowSize))
      setReadError('')
    } catch (err) {
      setReadError(err.message)
    }
  }, 30000, `${device.id}-${windowSize}`, configured)

  const reading = configured ? device.latest_reading : null
  const stale = !!reading && isStale(reading, now)
  const status = conditionStatus({ configured, reading, stale, now })
  const list = configured ? readings || [] : []
  const temp = num(reading?.temperature_c)
  const rh = num(reading?.humidity_rh)
  const vpd = num(reading?.vpd_kpa)
  const chu = heatUnitsFor(device, batches)
  const border = !configured ? 'border-dashed border-slate-300' : stale ? 'border-amber-300' : device.online ? 'border-emerald-300' : 'border-slate-200'

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-4 h-full ${border}`}>
      {/* 1. header */}
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link to={`/devices/${device.id}`} className="font-bold text-slate-800 text-lg hover:underline truncate">{device.name}</Link>
            <SensorBadge device={device} className="shrink-0" />
          </div>
          <p className="text-xs text-slate-500 mt-1 truncate">
            {device.stall_location || 'No location'} • {cropLabel(device.crop_type)} • DHT22 {configured ? `on GPIO ${device.dht_pin}` : 'not configured'}
          </p>
        </div>
        <OnlinePill online={device.online} />
      </div>

      {/* 2. network facts */}
      <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-500 space-y-1.5 min-h-[4rem]">
        <span className="flex flex-wrap items-center gap-1.5 min-h-6">
          <span className="font-bold text-slate-400 uppercase text-[10px]">Device IP</span>
          <IpAddress ip={device.ip} online={device.online} />
        </span>
        <NetworkFacts device={device} now={now} className="text-slate-400" />
      </div>

      {/* 3. readings: four equal tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile icon={Thermometer} iconCls="text-amber-500" tone="bg-amber-50/60" value={temp != null ? `${temp.toFixed(1)}°C` : '--°C'} label="Temperature" hint="live DHT22" />
        <Tile icon={Droplets} iconCls="text-[#2A6B48]" tone="bg-emerald-50/60" value={rh != null ? `${rh.toFixed(0)}%` : '--%'} label="Humidity" hint="relative (RH)" />
        <Tile icon={Gauge} iconCls="text-sky-500" tone="bg-sky-50/70" value={vpd != null ? vpd.toFixed(2) : '--'} label="VPD" hint="kPa" />
        <Tile icon={Flame} iconCls="text-rose-500" tone="bg-rose-50/60" value={chu.value != null ? Math.round(chu.value).toLocaleString() : '--'} label="Heat units (CHU)" hint={chu.hint} />
      </div>

      {/* 4. one-line status strip, fixed height */}
      <p role="status" title={status.title} className={`h-10 flex items-center gap-2 px-3 rounded-lg border text-xs font-bold ${TONES[status.tone]}`}>
        <status.Icon size={14} className="shrink-0" />
        <span className="truncate">{status.text}</span>
      </p>

      {/* 5. chart, fixed height */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 truncate">
          Trend{configured ? ` (last ${list.length} readings)` : ''}
        </p>
        <div className="h-60 overflow-hidden">
          {!configured ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 text-sm px-6">
              <p className="font-semibold text-slate-500">No DHT22 configured</p>
              <p className="text-xs mt-1">The administrator picks the DHT22 data pin in <Link to={`/devices/${device.id}`} className="font-bold text-[#2A6B48] hover:underline">this node's settings</Link>.</p>
            </div>
          ) : readings === null && !readError ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400 animate-pulse">Loading readings…</div>
          ) : (
            <ReadingsChart readings={list} />
          )}
        </div>
        {readError && <p role="alert" className="text-xs text-rose-600 mt-1 truncate">Couldn't load readings: {readError}</p>}
      </div>

      {/* 6. min / avg / max */}
      <StatsTable readings={list} />

      <div className="mt-auto pt-3 border-t border-slate-100 text-xs font-medium text-slate-400 truncate">
        Last reading: {reading ? `${timeAgo(reading.created_at, now)} (${formatDateTime(reading.created_at)})` : 'none yet'}
      </div>
    </div>
  )
}

/** One tile of the stall-climate band. */
function ClimateTile({ label, value, hint, valueCls = 'text-slate-800', tone = 'bg-slate-50' }) {
  return (
    <div className={`rounded-xl px-4 py-3 min-w-0 ${tone}`}>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
      <p className={`text-2xl font-bold mt-1 leading-tight tabular-nums ${valueCls}`}>{value}</p>
      <p className="text-[11px] text-slate-500 min-h-8 leading-4">{hint}</p>
    </div>
  )
}

function agingTone(days) {
  if (days == null) return { cls: 'text-slate-400', tone: 'bg-slate-50' }
  if (days >= 1.5) return { cls: 'text-rose-600', tone: 'bg-rose-50/60' }
  if (days > 1.05) return { cls: 'text-amber-600', tone: 'bg-amber-50/60' }
  return { cls: 'text-emerald-700', tone: 'bg-emerald-50/60' }
}

function StallClimateCard({ stall, name, now }) {
  const measured = !!stall.measured
  const t = num(stall.temperature_c)
  const rh = num(stall.humidity_rh)
  const vpd = num(stall.vpd_kpa)
  const dim = measured ? '' : 'opacity-80'
  const aging = CROP_KEYS.map((crop) => ({
    crop,
    days: num(stall.aging?.[crop]?.days_used_per_day),
    chu: num(stall.aging?.[crop]?.chu_per_hour),
  }))
  const known = aging.filter((a) => a.days != null)
  const sentence = known.length === 0
    ? 'Shelf-life aging is not available for this stall yet.'
    : `${measured ? 'At this climate' : 'At the assumed climate'} one real day uses ${known
      .map((a) => `${a.days.toFixed(1)} days of ${cropLabel(a.crop).toLowerCase()}`)
      .join(', ')} shelf life.`

  return (
    <div className="border border-slate-100 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-800 truncate min-w-0">{name}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`px-2.5 py-1 rounded-full font-bold border ${measured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
            ● {measured ? 'Live' : 'Assumed (no reading in 3 h)'}
          </span>
          <span className="font-medium text-slate-400">
            {stall.updated_at ? `Updated ${timeAgo(stall.updated_at, now)} (${formatDateTime(stall.updated_at)})` : 'No reading yet'}
          </span>
        </div>
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 ${dim}`}>
        <ClimateTile label="Temperature" value={t != null ? `${t.toFixed(1)}°C` : '--°C'} hint={measured ? 'DHT22 average' : 'assumed'} tone="bg-amber-50/60"
                     valueCls={t != null && t > STRESS_TEMP ? 'text-amber-600' : 'text-slate-800'} />
        <ClimateTile label="Humidity" value={rh != null ? `${rh.toFixed(0)}%` : '--%'} hint="relative humidity" tone="bg-emerald-50/60" />
        <ClimateTile label="VPD" value={vpd != null ? `${vpd.toFixed(2)} kPa` : '-- kPa'} hint="lower keeps produce moist" tone="bg-sky-50/70"
                     valueCls={vpd != null && vpd > DRY_VPD ? 'text-amber-600' : 'text-slate-800'} />
        {aging.map((a) => {
          const { cls, tone } = agingTone(a.days)
          return (
            <ClimateTile key={a.crop} label={cropLabel(a.crop)} value={a.days != null ? `${a.days.toFixed(1)}x` : '—'}
                         hint={<>shelf life used per day<br />{a.chu != null ? `+${a.chu.toFixed(1)} CHU per hour` : 'not available'}</>} valueCls={cls} tone={tone} />
          )
        })}
      </div>

      <p className="text-xs text-slate-500">
        {sentence} 1.0x is the 25°C baseline.
        {!measured && ' No DHT22 reported in the last 3 hours, so these values are an assumption, not a measurement.'}
      </p>
    </div>
  )
}

function StallClimate({ state, names, now }) {
  const stalls = state.data?.stalls || []
  return (
    <section aria-labelledby="stall-climate" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div>
        <h2 id="stall-climate" className="text-lg font-bold text-slate-800">Stall climate</h2>
        <p className="text-xs text-slate-500 mt-0.5">The stall's own DHT22 conditions and how fast they use up each crop's shelf life. Refreshes every 30 seconds.</p>
      </div>
      {state.error && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl p-3">Couldn't load stall climate: {state.error}</p>}
      {!state.data && !state.error && <p className="text-sm text-slate-400 animate-pulse">Loading stall climate…</p>}
      {state.data && stalls.length === 0 && (
        <p className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-xl p-4 text-center">No stall has paired a sensor node yet, so there is no climate to show.</p>
      )}
      {stalls.map((s) => <StallClimateCard key={s.operator_id} stall={s} name={names(s)} now={now} />)}
    </section>
  )
}

const SORT_COLUMNS = [
  { key: 'crop', label: 'Crop / batch', get: (b) => b.crop, text: true },
  { key: 'operator', label: 'Operator / stall', get: (b) => b.operator, text: true },
  { key: 'status', label: 'Status', get: (b) => ({ RED: 0, AMBER: 1, GREEN: 2 })[b.status] ?? null },
  { key: 'days', label: 'Days left', get: (b) => b.days, align: 'right' },
  { key: 'temp', label: 'Temp', get: (b) => b.sensor.temp, align: 'right' },
  { key: 'rh', label: 'RH', get: (b) => b.sensor.rh, align: 'right' },
  { key: 'vpd', label: 'VPD', get: (b) => b.sensor.vpd, align: 'right' },
  { key: 'chu', label: 'CHU', get: (b) => b.sensor.chu, align: 'right' },
  { key: 'updated', label: 'Updated', get: (b) => (b.sensor.updatedAt ? new Date(b.sensor.updatedAt).getTime() : null) },
]

function BatchSensorTable({ state, now }) {
  const [sort, setSort] = useState({ key: 'days', dir: 'asc' })
  const [limit, setLimit] = useState(BATCH_PAGE)
  const batches = state.rows

  const sorted = useMemo(() => {
    const col = SORT_COLUMNS.find((c) => c.key === sort.key) || SORT_COLUMNS[0]
    const dir = sort.dir === 'asc' ? 1 : -1
    return (batches || []).slice().sort((a, b) => {
      const x = col.get(a)
      const y = col.get(b)
      if (x == null && y == null) return a.id - b.id
      if (x == null) return 1 // missing values always last
      if (y == null) return -1
      const cmp = col.text ? String(x).localeCompare(String(y)) : x - y
      return cmp * dir || a.id - b.id
    })
  }, [batches, sort])

  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const noColumns = !!batches && batches.length > 0 && !batches.some((b) => b.sensor.available)
  const cell = (v, digits) => (v == null ? '—' : v.toFixed(digits))

  return (
    <section aria-labelledby="paired-batches" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100">
        <h2 id="paired-batches" className="text-lg font-bold text-slate-800">Batches paired with the sensors</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Every batch carries the latest reading of its stall's sensor node and the heat units (CHU) it has gathered since it was first tracked (private sensor data, shown to the administrator only). Click a column to sort.
        </p>
      </div>
      {state.error && <p role="alert" className="m-5 text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl p-3">Couldn't load batches: {state.error}</p>}
      {noColumns && (
        <p role="status" className="m-5 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3">
          Sensor data is not available yet. It appears after supabase/010_sensor_columns.sql is run (the private product_climate table).
        </p>
      )}
      {!batches && !state.error && <p className="p-6 text-sm text-slate-400 animate-pulse">Loading batches…</p>}
      {batches && batches.length === 0 && !state.error && <p className="p-6 text-sm text-slate-500 text-center">No batches registered yet.</p>}
      {batches && batches.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
              <tr>
                {SORT_COLUMNS.map((c, i) => {
                  const active = sort.key === c.key
                  return (
                    <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={`px-3 py-3 ${i === 0 ? 'pl-5' : ''} ${i === SORT_COLUMNS.length - 1 ? 'pr-5' : ''} ${c.align === 'right' ? 'text-right' : ''}`}>
                      <button type="button" onClick={() => toggle(c.key)}
                              className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider hover:text-[#2A6B48] ${active ? 'text-[#2A6B48]' : ''}`}>
                        {c.label}
                        <span aria-hidden="true" className="w-2 text-[9px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.slice(0, limit).map((b) => {
                const meta = freshnessMeta(b.status)
                return (
                  <tr key={b.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 pl-5">
                      <Link to={`/batches/${b.id}`} className="font-bold text-slate-800 hover:underline">{cropLabel(b.crop)} #{b.id}</Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-700">{b.operator}</p>
                      <p className="text-xs text-slate-400">{b.stall ? stallLabel(b.stall) : 'No stall number'}</p>
                    </td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 text-xs font-bold rounded-full ${meta.badge}`}>{meta.label}</span></td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${meta.text}`}>{b.days != null ? b.days : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{b.sensor.temp != null ? `${b.sensor.temp.toFixed(1)}°C` : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{b.sensor.rh != null ? `${b.sensor.rh.toFixed(0)}%` : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{cell(b.sensor.vpd, 2)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{b.sensor.chu != null ? Math.round(b.sensor.chu).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2.5 pr-5 text-xs text-slate-500 whitespace-nowrap">
                      {b.sensor.updatedAt ? <span title={formatDateTime(b.sensor.updatedAt)}>{timeAgo(b.sensor.updatedAt, now)}</span> : <span className="text-slate-400">No reading yet</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {batches && batches.length > limit && (
        <div className="p-4 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
          <span>Showing {limit} of {batches.length} batches</span>
          <button type="button" onClick={() => setLimit(batches.length)} className="text-sm font-bold text-[#2A6B48] hover:underline">Show all</button>
        </div>
      )}
    </section>
  )
}

const mapBatch = (row) => ({
  id: row.id,
  crop: row.crop_type || 'Unknown',
  operatorId: row.operator_id,
  operator: row.profiles?.full_name || 'Unknown operator',
  stall: row.profiles?.stall_number || '',
  status: row.freshness_status || 'UNKNOWN',
  days: row.predicted_shelf_life != null ? Number(row.predicted_shelf_life) : null,
  sensor: pairedSensor(row),
})

export default function Sensors() {
  const now = useNow(5000)
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState('')
  const [windowSize, setWindowSize] = useState(60)
  const [climate, setClimate] = useState({ data: null, error: '' })
  const [profiles, setProfiles] = useState([])
  const [batchState, setBatchState] = useState({ rows: null, error: '' })

  usePolling(async () => {
    try {
      setDevices(await deviceApi.list())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, 5000)

  usePolling(async () => {
    try {
      setClimate({ data: await deviceApi.stallConditions(), error: '' })
    } catch (err) {
      setClimate((c) => ({ ...c, error: err.message }))
    }
  }, 30000)

  usePolling(async () => {
    try {
      setProfiles(await api.stallProfiles())
    } catch { /* names fall back to the device list */ }
  }, 120000)

  usePolling(async () => {
    try {
      const rows = await api.batches()
      setBatchState({ rows: (rows || []).map(mapBatch), error: '' })
    } catch (err) {
      setBatchState((s) => ({ ...s, error: err.message }))
    }
  }, 30000)

  // Only sensor nodes (kind SENSOR) carry DHT22 readings; ESP32-CAM cameras are listed on the Devices page.
  const list = useMemo(() => (devices || []).filter(isSensor), [devices])
  const withDht = list.filter(hasDht)
  const fresh = withDht.filter((d) => d.latest_reading && !isStale(d.latest_reading, now))
  const staleCount = withDht.filter((d) => d.latest_reading && isStale(d.latest_reading, now)).length
  const avg = (key) => (fresh.length ? fresh.reduce((sum, d) => sum + Number(d.latest_reading[key]), 0) / fresh.length : null)
  const avgTemp = avg('temperature_c')
  const avgRh = avg('humidity_rh')

  // Name a stall: its operator's profile, else the devices that report for it.
  const stallName = (stall) => {
    const p = profiles.find((x) => x.id === stall.operator_id)
    if (p?.full_name) return `${p.full_name}${p.stall_number ? ` · ${stallLabel(p.stall_number)}` : ''}`
    const names = list.filter((d) => d.operator_id === stall.operator_id).map((d) => d.name)
    if (names.length) return names.join(', ')
    return `Stall ${String(stall.operator_id || '').slice(0, 6) || 'unknown'}`
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Sensor Nodes</h1>
          <p className="text-slate-500 text-sm mt-1">Live DHT22 temperature, humidity and VPD from every stall's sensor nodes. Only sensor nodes are listed here; ESP32-CAM cameras only take pictures and are on the Devices page.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold text-slate-500 flex items-center gap-2">
            Chart window
            <select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))}
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">
              {WINDOWS.map((n) => <option key={n} value={n}>Last {n} readings</option>)}
            </select>
          </label>
          <Link to="/devices" className="px-4 py-2.5 rounded-xl font-bold text-[#2A6B48] border border-emerald-200 bg-white hover:bg-emerald-50 text-sm">
            Manage devices
          </Link>
        </div>
      </div>

      {error && <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">Couldn't load sensor nodes: {error}</div>}

      <StallClimate state={climate} names={stallName} now={now} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Sensor nodes online</p>
          <h2 className="text-4xl font-bold text-[#2A6B48]">{devices ? `${list.filter((d) => d.online).length} / ${list.length}` : '—'}</h2>
          <p className="text-[11px] text-slate-400 mt-1">{devices ? `${withDht.length} with a DHT22` : ''}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Avg temperature (fresh)</p>
          <h2 className={`text-4xl font-bold ${avgTemp != null && avgTemp > STRESS_TEMP ? 'text-amber-500' : 'text-slate-800'}`}>
            {avgTemp != null ? `${avgTemp.toFixed(1)}°C` : '--°C'}
          </h2>
          <p className="text-[11px] text-slate-400 mt-1">across sensor nodes with a recent reading</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Avg humidity (fresh)</p>
          <h2 className="text-4xl font-bold text-[#2A6B48]">{avgRh != null ? `${avgRh.toFixed(0)}%` : '--%'}</h2>
          <p className="text-[11px] text-slate-400 mt-1">across sensor nodes with a recent reading</p>
        </div>
        <div className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between ${staleCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Stale sensors</p>
          <h2 className={`text-4xl font-bold ${staleCount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{devices ? staleCount : '—'}</h2>
          <p className="text-[11px] text-slate-400 mt-1">no reading for 10+ minutes</p>
        </div>
      </div>

      {devices === null && !error && <p className="text-slate-400 animate-pulse">Syncing node data…</p>}
      {devices && list.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No sensor nodes yet. Stall operators pair their DHT22 sensor node from the mobile app; the administrator configures the DHT22 pin on the device page. Cameras are not listed here.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch auto-rows-fr">
        {list.map((d) => <DeviceCard key={d.id} device={d} now={now} windowSize={windowSize} batches={batchState.rows} />)}
      </div>

      <BatchSensorTable state={batchState} now={now} />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Optimal storage conditions per crop and live status</caption>
          <thead className="bg-slate-50 text-slate-400 text-xs font-bold uppercase tracking-wider">
            <tr><th className="p-4">Crop</th><th className="p-4">Optimal</th><th className="p-4">Stress</th><th className="p-4">Status (live DHT22)</th></tr>
          </thead>
          <tbody>
            {CROP_RANGES.map((c) => {
              const temps = fresh.filter((d) => d.crop_type === c.crop).map((d) => Number(d.latest_reading.temperature_c))
              const hot = temps.some((t) => t > c.stress)
              return (
                <tr key={c.crop} className="border-t border-slate-100">
                  <td className="p-4 font-bold">{cropLabel(c.crop)}</td>
                  <td className="p-4">{c.optimal}</td>
                  <td className="p-4">{'>'}{c.stress}°C</td>
                  <td className={`p-4 font-bold ${temps.length === 0 ? 'text-slate-400' : hot ? 'text-amber-500' : 'text-emerald-600'}`}>
                    ● {temps.length === 0 ? 'No live reading' : hot ? 'Stress Active' : 'Normal'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
