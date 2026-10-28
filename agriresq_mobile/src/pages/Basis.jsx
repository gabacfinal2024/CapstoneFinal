import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Thermometer, Droplets, Flame, Gauge } from 'lucide-react'
import { deviceApi } from '../api/deviceApi'
import { CROP_LABELS } from '../utils/helpers'
import ErrorNotice from '../components/ErrorNotice'
import './Basis.css'

const num = (v, digits = 1) => {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || Number.isNaN(n)) return null
  return String(Number(n.toFixed(digits)))
}

/** Colour of the verdict dot, judged from the server's verdict wording only (grey when unsure). */
function verdictTone(verdict) {
  const v = String(verdict || '').toLowerCase()
  if (!v) return 'neutral'
  if (v.startsWith('consistent')) return 'ok'
  if (v.startsWith('optimistic')) return 'warn'
  return 'neutral'
}

function Study({ s }) {
  const tone = verdictTone(s.verdict)
  const fullText = String(s.access || '').toLowerCase().startsWith('full')
  const predicted = num(s.predicted_days)
  const ext = s.conditions?.text
  return (
    <article className="basis-card card basis-study">
      <div className="basis-study-top">
        <span className={`basis-crop basis-crop-${String(s.crop || '').toLowerCase()}`}>{CROP_LABELS[s.crop] || s.crop || 'Crop'}</span>
        <span className={`basis-access ${fullText ? 'is-full' : 'is-abstract'}`}>{fullText ? 'full text' : 'abstract only'}</span>
      </div>
      <p className="basis-place">{[s.place, s.country].filter(Boolean).join(', ') || '—'}</p>
      {ext && <p className="basis-cond">Conditions: {ext}</p>}

      <div className="basis-rows">
        {s.observed && <div><span>Observed</span><strong>{s.observed}</strong></div>}
        <div><span>System predicts</span><strong>{predicted ? `${predicted} days` : 'No prediction for this case'}</strong></div>
        {s.observed_extension_days != null && <div><span>Observed extension</span><strong>{num(s.observed_extension_days)} days</strong></div>}
        {s.predicted_extension_days != null && <div><span>Predicted extension</span><strong>{num(s.predicted_extension_days)} days</strong></div>}
        {s.spoiled_before_days != null && <div><span>Spoiled before</span><strong>{num(s.spoiled_before_days)} days</strong></div>}
      </div>

      {s.verdict && (
        <p className="basis-verdict">
          <span className={`basis-dot basis-dot-${tone}`} aria-hidden="true" />
          <span>{s.verdict}</span>
        </p>
      )}

      {s.citation && <p className="basis-cite">{s.citation}</p>}
      {s.url && (
        <a className="basis-link" href={s.url} target="_blank" rel="noopener noreferrer">
          Open the source <ExternalLink size={13} />
        </a>
      )}
    </article>
  )
}

export default function Basis() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await deviceApi.referenceShelfLife())
    } catch (err) {
      setData(null)
      setError(err.message || 'Could not load the studies.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const engine = data?.engine
  const studies = Array.isArray(data?.studies) ? data.studies : []
  const params = Array.isArray(data?.parameters) ? data.parameters : []
  const crops = engine?.crops ? Object.entries(engine.crops) : []

  return (
    <div className="app-shell">
      <div className="page page-no-nav basis">
        <button type="button" className="basis-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/profile'))}>
          <ArrowLeft size={18} /> Back
        </button>
        <h1 className="basis-title">How days-to-spoil is calculated</h1>
        <p className="basis-sub">The “days to spoil” you see is an estimate. Here is how it works and what it is based on.</p>

        <section className="basis-card card">
          <h2><Thermometer size={18} /> Warmth speeds up ageing</h2>
          <p>Produce ages faster when it is warm. Every +10 °C makes it age about 2.5 times faster, and every 10 °C cooler slows it down by the same amount. A stall that is hot at midday uses up shelf life much faster than a cool one.</p>
        </section>

        <section className="basis-card card">
          <h2><Droplets size={18} /> Dry air dries produce out</h2>
          <p>The drier the air is compared with how warm it is, the faster water leaves the produce, so it wilts and shrivels sooner. This “air dryness” is measured as VPD (vapour pressure deficit). When VPD is high, days to spoil go down.</p>
        </section>

        <section className="basis-card card">
          <h2><Flame size={18} /> Heat units (CHU)</h2>
          <p>
            Heat units add up how long the produce has been hotter than {num(engine?.reference_temp_c, 0) ?? 'a reference'} °C. One hour at one degree above that counts as one degree-hour, and the degree-hours keep adding up while the produce sits in the heat. The more it has collected, the fewer days it has left.
          </p>
        </section>

        <section className="basis-card card">
          <h2><Gauge size={18} /> From days to Fresh, At-Risk and Rotten</h2>
          <ul className="basis-states">
            <li><span className="basis-dot basis-dot-ok" aria-hidden="true" /><span><strong>Fresh</strong> – 3 days or more are left.</span></li>
            <li><span className="basis-dot basis-dot-warn" aria-hidden="true" /><span><strong>At-Risk</strong> – fewer than 3 days are left. Sell or rescue it soon.</span></li>
            <li><span className="basis-dot basis-dot-bad" aria-hidden="true" /><span><strong>Rotten</strong> – no days are left (0).</span></li>
          </ul>
        </section>

        <h2 className="basis-heading">What it is based on</h2>

        {loading && <p className="basis-muted" role="status">Loading the studies…</p>}
        <ErrorNotice message={error} onRetry={load} retrying={loading} />

        {!loading && !error && data && (
          <>
            {studies.length === 0 && <p className="basis-muted">No studies are listed yet.</p>}
            {studies.map((s) => <Study key={s.id ?? s.citation} s={s} />)}

            {(crops.length > 0 || params.length > 0) && (
              <>
                <h2 className="basis-heading">Settings used for each crop</h2>
                {crops.map(([crop, c]) => (
                  <section key={crop} className="basis-card card">
                    <h3>{CROP_LABELS[crop] || crop}</h3>
                    <div className="basis-rows">
                      {num(c.baseline_days_at_25c) && <div><span>Baseline shelf life at 25 °C</span><strong>{num(c.baseline_days_at_25c)} days</strong></div>}
                      {num(c.min_rh, 0) && <div><span>Minimum humidity</span><strong>{num(c.min_rh, 0)}%</strong></div>}
                      {num(c.q10) && <div><span>Ageing speed-up per +10 °C</span><strong>×{num(c.q10)}</strong></div>}
                      {num(c.chilling_below_c) && <div><span>Chilling injury below</span><strong>{num(c.chilling_below_c)} °C</strong></div>}
                      {num(c.vpd_threshold_kpa, 2) && <div><span>Air counts as dry above</span><strong>{num(c.vpd_threshold_kpa, 2)} kPa</strong></div>}
                    </div>
                  </section>
                ))}
                {params.length > 0 && (
                  <section className="basis-card card">
                    <h3>Where each setting comes from</h3>
                    <ul className="basis-params">
                      {params.map((p, i) => (
                        <li key={i}><strong>{p.parameter}</strong>{p.basis && <span>{p.basis}</span>}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {data.limits && (
              <div className="basis-limits" role="note">
                <strong>Limits</strong>
                <p>{data.limits}</p>
              </div>
            )}
          </>
        )}

        <Link to="/profile" className="basis-foot">Back to Profile</Link>
      </div>
    </div>
  )
}
