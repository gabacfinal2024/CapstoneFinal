import { Thermometer, Droplets, Wind } from 'lucide-react'
import useStallConditions from '../hooks/useStallConditions'
import { useAuth } from '../context/AuthContext'
import { timeAgo } from '../api/deviceApi'
import { CROP_LABELS, formatTemp, formatRH, formatVpd, agingLine } from '../utils/helpers'
import './StallClimateCard.css'

const ALL_CROPS = ['EGGPLANT', 'CUCUMBER', 'CARROT']

function Block({ stall, crops, label }) {
  const measured = !!stall.measured
  return (
    <div className="stall-climate__block">
      <div className="stall-climate__top">
        <span className="stall-climate__who">{label}</span>
        <span className={`stall-climate__badge ${measured ? 'is-live' : 'is-assumed'}`}>
          {measured ? 'Live' : 'Assumed (no reading in 3 h)'}
        </span>
      </div>

      <div className="stall-climate__tiles">
        <div><span><Thermometer size={13} /> Temp</span><strong>{formatTemp(stall.temperature_c)}</strong></div>
        <div><span><Droplets size={13} /> Humidity</span><strong>{formatRH(stall.humidity_rh)}</strong></div>
        <div><span><Wind size={13} /> VPD</span><strong>{formatVpd(stall.vpd_kpa)}{stall.vpd_kpa != null ? ' kPa' : ''}</strong></div>
      </div>

      <p className="stall-climate__time">
        {measured && stall.updated_at ? `Updated ${timeAgo(stall.updated_at)}` : 'Using a standard 25°C storage climate until a sensor reports.'}
      </p>

      <ul className="stall-climate__aging">
        {crops.map((c) => {
          const line = agingLine(c, stall.aging?.[c])
          return <li key={c}>{line || `${CROP_LABELS[c] || c}: no shelf-life estimate yet`}</li>
        })}
      </ul>
    </div>
  )
}

/**
 * "Stall climate" card from /api/stall/conditions/. `crops` = crop types the operator has batches of
 * (all three when empty), so the card always lists the same balanced set of lines.
 */
export default function StallClimateCard({ crops = [], className = '' }) {
  const { user } = useAuth()
  const { stalls, error, loading } = useStallConditions()
  const list = [...new Set(crops.filter(Boolean))].filter((c) => ALL_CROPS.includes(c))
  const shown = list.length ? list : ALL_CROPS

  return (
    <section className={`card stall-climate ${className}`.trim()}>
      <h3>Stall climate</h3>
      {loading && stalls === null ? (
        <p className="stall-climate__msg">Loading…</p>
      ) : stalls === null ? (
        <p className="stall-climate__msg">Stall climate is unavailable right now. {error}</p>
      ) : stalls.length === 0 ? (
        <p className="stall-climate__msg">No stall climate yet. Connect a camera or sensor node with a DHT22.</p>
      ) : (
        stalls.map((s, i) => (
          <Block
            key={s.operator_id ?? i}
            stall={s}
            crops={shown}
            label={s.operator_id && user?.id && s.operator_id !== user.id ? 'Shared stall' : 'Your stall'}
          />
        ))
      )}
    </section>
  )
}
