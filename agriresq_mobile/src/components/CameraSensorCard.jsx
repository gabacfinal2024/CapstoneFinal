import { Thermometer, Droplets, Wind, Flame, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { timeAgo, isReadingStale } from '../api/deviceApi'
import { formatTemp, formatRH, formatVpd, formatChuRate, formatDateTime, climateState, HIGH_TEMP_C, HIGH_VPD_KPA } from '../utils/helpers'
import Sparkline from './Sparkline'
import './CameraSensorCard.css'

const fix = (n, d = 1) => (Number.isFinite(Number(n)) && n != null ? Number(n).toFixed(d) : '—')

function summarize(values) {
  const v = values.map((x) => (x == null ? NaN : Number(x))).filter(Number.isFinite)
  if (!v.length) return null
  return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length }
}

const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at)

/** One equal-size tile of the 2x2 grid. */
function Tile({ icon: Icon, label, value, note }) {
  return (
    <div className="sensor-tile">
      <span className="sensor-tile__label"><Icon size={14} />{label}</span>
      <strong className="sensor-tile__value">{value}</strong>
      <span className="sensor-tile__note">{note}</span>
    </div>
  )
}

/** One 3-cell row (min / avg / max). */
function StatRow({ label, stats, digits }) {
  return (
    <div className="sensor-stats__row">
      <span>{label}</span>
      <span>min <b>{stats ? fix(stats.min, digits) : '—'}</b></span>
      <span>avg <b>{stats ? fix(stats.avg, digits) : '—'}</b></span>
      <span>max <b>{stats ? fix(stats.max, digits) : '—'}</b></span>
    </div>
  )
}

/**
 * Fixed-layout DHT22 panel of a SENSOR NODE (cameras carry no sensor reading): 2x2 tiles (temperature,
 * humidity, VPD, heat-unit rate), a status strip, a trend area and a min/avg/max row. Every part keeps
 * its size whether there is data or not, so the card never jumps between online / offline.
 * `reading` is the device's latest reading, `readings` an optional history (any order).
 * `chuRate` is the stall's current heat-unit rate per hour from /api/stall/conditions/ (a dash when unknown).
 */
export function SensorPanel({ reading, readings = [], dhtPin, chuRate = null }) {
  const what = 'sensor node'
  const sorted = [...(readings || [])].sort(byTime) // oldest -> newest
  const latest = [reading, sorted[sorted.length - 1]].filter(Boolean).sort((a, b) => byTime(b, a))[0] || null
  const stale = latest ? isReadingStale(latest.created_at) : false
  const state = latest ? climateState(latest.temperature_c, latest.vpd_kpa) : null

  let tone = 'none'
  let Icon = Clock
  let title = 'No reading yet'
  let detail = dhtPin != null && dhtPin < 0
    ? 'DHT22 is not configured. Check the sensor-node firmware pin.'
    : `No recent upload. Check node Wi-Fi/server connectivity and DHT22 wiring on GPIO ${dhtPin ?? 4}.`
  if (latest) {
    const when = `updated ${timeAgo(latest.created_at)}`
    if (stale) {
      tone = 'warn'; Icon = AlertTriangle; title = 'Old reading'
      detail = `Last update ${timeAgo(latest.created_at)}. Check the sensor and ${what} power.`
    } else if (state === 'heat') {
      tone = 'bad'; Icon = Flame; title = 'High heat'; detail = `Above ${HIGH_TEMP_C}°C, ${when}`
    } else if (state === 'dry') {
      tone = 'warn'; Icon = AlertTriangle; title = 'Dry air'; detail = `VPD above ${HIGH_VPD_KPA} kPa, ${when}`
    } else {
      tone = 'ok'; Icon = CheckCircle2; title = 'OK'; detail = `Conditions are fine, ${when}`
    }
  }

  const tempStats = summarize(sorted.map((r) => r.temperature_c))
  const humStats = summarize(sorted.map((r) => r.humidity_rh))
  const hasTrend = sorted.length > 1

  return (
    <div className={`sensor-panel${stale ? ' is-stale' : ''}`}>
      <div className="sensor-tiles">
        <Tile icon={Thermometer} label="Temperature" value={latest ? formatTemp(latest.temperature_c) : '—'} note="Air temperature" />
        <Tile icon={Droplets} label="Humidity" value={latest ? formatRH(latest.humidity_rh) : '—'} note="Relative humidity" />
        <Tile icon={Wind} label="VPD" value={latest ? `${formatVpd(latest.vpd_kpa)}${latest.vpd_kpa != null ? ' kPa' : ''}` : '—'} note="Low is good for storage" />
        <Tile icon={Flame} label="Heat units" value={formatChuRate(chuRate)} note={chuRate != null ? '°C·h above 25°C, per hour' : 'Stall rate not available yet'} />
      </div>

      <div className={`sensor-strip sensor-strip--${tone}`} role="status">
        <Icon size={16} />
        <div>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
      </div>

      <div className="sensor-trend-box">
        {hasTrend ? (
          <>
            <div className="sensor-spark">
              <span>Temperature</span>
              <Sparkline values={sorted.map((r) => r.temperature_c)} color="var(--accent)" height={36} label="Temperature trend" />
            </div>
            <div className="sensor-spark">
              <span>Humidity</span>
              <Sparkline values={sorted.map((r) => r.humidity_rh)} color="var(--primary-light)" height={36} label="Humidity trend" />
            </div>
          </>
        ) : (
          <p className="sensor-trend-box__empty">The trend appears after a few readings.</p>
        )}
      </div>
      <p className="sensor-range">
        {hasTrend ? `Last ${sorted.length} readings, ${formatDateTime(sorted[0].created_at)} to ${formatDateTime(sorted[sorted.length - 1].created_at)}` : 'Last readings'}
      </p>
      <div className="sensor-stats" role="table" aria-label="Sensor statistics">
        <StatRow label="Temp °C" stats={tempStats} digits={1} />
        <StatRow label="RH %" stats={humStats} digits={0} />
      </div>
    </div>
  )
}
