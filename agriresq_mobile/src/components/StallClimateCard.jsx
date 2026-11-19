import { ChevronDown, Thermometer, Droplets, Wind } from 'lucide-react'
import useStallConditions from '../hooks/useStallConditions'
import useEntryState from '../hooks/useEntryState'
import { useAuth } from '../context/AuthContext'
import { timeAgo } from '../api/deviceApi'
import { CROP_LABELS, formatTemp, formatRH, formatVpd, formatShelfLifeUsage } from '../utils/helpers'
import './StallClimateCard.css'

const ALL_CROPS = ['EGGPLANT', 'CUCUMBER', 'CARROT']

function Block({ stall, crops, label }) {
  const measured = !!stall.measured
  const [expanded, setExpanded] = useEntryState('shelfLifeExpanded', false)
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

      <details className="stall-climate__aging" open={expanded}
        onToggle={(event) => {
          if (event.currentTarget.open !== expanded) setExpanded(event.currentTarget.open)
        }}>
        <summary>
          <span>See how much shelf life this climate uses</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <p>Shelf life used in one real day</p>
        <dl>
          {crops.map((crop) => (
            <div key={crop}>
              <dt>{CROP_LABELS[crop] || crop}</dt>
              <dd>{formatShelfLifeUsage(stall.aging?.[crop])}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}

/**
 * "Stall climate" card from /api/stall/conditions/. `crops` = crop types the operator has batches of
 * (all three when empty).
 */
export default function StallClimateCard({ crops = [], operatorId }) {
  const { user } = useAuth()
  const { stalls, error, loading } = useStallConditions()
  const stall = stalls?.find((item) => item.operator_id === operatorId)
  const list = [...new Set(crops.filter(Boolean))].filter((c) => ALL_CROPS.includes(c))
  const shown = list.length ? list : ALL_CROPS

  return (
    <section className="card stall-climate">
      <h2>Current stall climate</h2>
      {loading && stalls === null ? (
        <p className="stall-climate__msg">Loading…</p>
      ) : stalls === null ? (
        <p className="stall-climate__msg">Stall climate is unavailable right now. {error}</p>
      ) : !stall ? (
        <p className="stall-climate__msg">No stall climate yet. Connect a camera or sensor node with a DHT22.</p>
      ) : (
        <Block stall={stall} crops={shown} label={operatorId === user?.id ? 'Your stall' : 'Shared stall'} />
      )}
    </section>
  )
}
