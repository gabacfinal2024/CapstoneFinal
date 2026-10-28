import { ShieldCheck, Camera, Thermometer, Droplets, Wind, Flame, Timer, Leaf, ScanLine, Gauge, Layers } from 'lucide-react'
import { timeAgo } from '../api/deviceApi'
import { statusLabel, formatDays, formatDateTime, formatTemp, formatRH, formatVpd, formatChu, toPercent } from '../utils/helpers'
import './FreshnessCheck.css'

const TRUST = {
  HIGH: { label: 'High confidence', tone: 'high' },
  MEDIUM: { label: 'Medium confidence', tone: 'medium' },
  LOW: { label: 'Low confidence', tone: 'low' },
  RULES_ONLY: { label: 'Estimated from storage conditions', tone: 'rules' },
}

const AGREEMENT = {
  agree: 'The camera and the storage rules agree on how fresh this batch is.',
  rules_stricter: 'The storage rules are stricter than the camera: heat has already used up shelf life that the produce does not show on its skin yet.',
  camera_stricter: 'The camera is stricter than the storage rules: the produce looks worse than the storage climate alone suggests.',
  no_camera: 'No accepted camera pictures yet, so only the storage rules (heat units and VPD) are used.',
}

const CAMERA_STATE = { fresh: 'Fresh', 'at-risk': 'At-Risk', rotten: 'Rotten' }

/** The batch status arrives as GREEN / AMBER / RED (or fresh / at-risk / rotten): always show the plain word. */
function statusWord(status) {
  if (!status) return '—'
  const s = String(status).toUpperCase().replace('_', '-')
  const key = { FRESH: 'GREEN', 'AT-RISK': 'AMBER', ROTTEN: 'RED' }[s] || s
  return statusLabel(key)
}

const num = (v) => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n }
const pctText = (v) => { const p = toPercent(v); return p == null ? '—' : `${p} %` }

function modelNote(model) {
  const a = num(model?.accuracy)
  if (a == null) return ''
  return `The freshness model scored ${(a <= 1 ? a * 100 : a).toFixed(1)} % on test photos`
}

/** One equal-size tile of a balanced grid. */
function Tile({ icon: Icon, label, value, note }) {
  return (
    <div className="fc-tile">
      <span className="fc-tile__label"><Icon size={14} />{label}</span>
      <strong className="fc-tile__value">{value}</strong>
      <span className="fc-tile__note">{note || ' '}</span>
    </div>
  )
}

function TrustBadge({ level }) {
  const t = TRUST[level]
  if (!t) return null
  return <span className={`fc-trust fc-trust--${t.tone}`}><ShieldCheck size={13} />{t.label}</span>
}

function ConfidenceBar({ label, value }) {
  const p = toPercent(value)
  return (
    <div className="fc-conf">
      <div className="fc-conf__row"><span>{label}</span><strong>{p == null ? '—' : `${p} %`}</strong></div>
      <div className="fc-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p ?? 0}>
        <span style={{ width: `${p ?? 0}%` }} />
      </div>
    </div>
  )
}

function Body({ loading, error, analysis, children }) {
  if (loading && !analysis) return <p className="fc-msg">Loading…</p>
  return (
    <>
      {error && !analysis && <p className="fc-msg fc-msg--warn">The detailed check is unavailable right now. {error}</p>}
      {children}
    </>
  )
}

/**
 * Freshness check from /api/batches/<id>/analysis/.
 * mode 'buyer': days to spoil, status, camera confidence and a trust label. Never any climate, CHU or VPD.
 * mode 'operator': the full analysis (camera ML, DHT22 rules, agreement, trust badge, explainer).
 * `fallback` ({ days, status, percent }) fills the tiles while the analysis is loading or unavailable.
 */
export default function FreshnessCheck({ analysis, loading = false, error = '', mode = 'buyer', fallback, signedIn = true }) {
  const operator = mode === 'operator'
  const days = analysis?.days_to_spoil ?? fallback?.days
  const status = analysis?.status ?? fallback?.status
  const percent = analysis?.freshness_percent ?? fallback?.percent
  const camera = analysis?.camera || null
  const level = analysis?.level

  if (!operator) {
    const rulesOnly = level === 'RULES_ONLY' || (analysis && !camera)
    return (
      <section className="card freshness-check">
        <div className="fc-head">
          <h3>Freshness check</h3>
          {analysis && <TrustBadge level={rulesOnly ? 'RULES_ONLY' : level} />}
        </div>
        <div className="fc-tiles">
          <Tile icon={Timer} label="Days to spoil" value={formatDays(days)} note="Calculated estimate" />
          <Tile icon={Leaf} label="Freshness" value={statusWord(status)} note={num(percent) != null ? `${Math.round(num(percent))} % fresh` : ''} />
        </div>
        {!signedIn ? (
          <p className="fc-msg">Sign in to see how reliable this estimate is.</p>
        ) : (
          <Body loading={loading} error={error} analysis={analysis}>
            {analysis && !rulesOnly && camera && (
              <>
                <ConfidenceBar label="Camera freshness confidence" value={camera.confidence} />
                <p className="fc-sub"><Camera size={13} />{camera.agreeing ?? 0} of {camera.scans ?? 0} recent pictures agree</p>
                {modelNote(analysis.model) && <p className="fc-model">{modelNote(analysis.model)}</p>}
              </>
            )}
            {analysis && rulesOnly && (
              <p className="fc-sub">No camera pictures have been accepted for this batch yet.</p>
            )}
          </Body>
        )}
      </section>
    )
  }

  const c = analysis?.climate || null
  const state = camera ? (CAMERA_STATE[camera.state] || camera.state || '—') : '—'
  return (
    <section className="card freshness-check">
      <div className="fc-head">
        <h3>Freshness analysis</h3>
        {analysis && <TrustBadge level={level} />}
      </div>
      <Body loading={loading} error={error} analysis={analysis}>
        <div className="fc-block">
          <h4><Camera size={14} /> Camera (ML model)</h4>
          <div className="fc-tiles">
            <Tile icon={Leaf} label="State seen" value={state} note={camera ? 'Latest accepted scans' : 'No accepted scans yet'} />
            <Tile icon={ScanLine} label="Agreeing scans" value={camera ? `${camera.agreeing ?? 0} of ${camera.scans ?? 0}` : '—'} note="Match the batch status" />
            <Tile icon={Gauge} label="Mean confidence" value={camera ? pctText(camera.mean_confidence) : '—'} note="Average of the scans" />
            <Tile icon={Layers} label="Consistency" value={camera ? pctText(camera.consistency) : '—'} note="Scans giving one answer" />
          </div>
          <ConfidenceBar label="Combined confidence" value={camera?.confidence} />
          <p className="fc-sub">{camera?.last_scan_at ? `Last scan ${formatDateTime(camera.last_scan_at)} (${timeAgo(camera.last_scan_at)})` : 'No scan yet'}</p>
          {modelNote(analysis?.model) && <p className="fc-model">{modelNote(analysis.model)}</p>}
        </div>

        <div className="fc-block">
          <h4><Thermometer size={14} /> Storage rules (DHT22)</h4>
          <div className="fc-tiles">
            <Tile icon={Timer} label="Days to spoil" value={formatDays(days)} note="Calculated estimate" />
            <Tile icon={Leaf} label="Freshness" value={statusWord(status)} note={num(percent) != null ? `${Math.round(num(percent))} % fresh` : ''} />
            <Tile icon={Flame} label="Heat units" value={formatChu(c?.chu)} note="°C·h above 25°C" />
            <Tile icon={Wind} label="VPD" value={c?.vpd_kpa != null ? `${formatVpd(c.vpd_kpa)} kPa` : '—'} note="Low is good" />
            <Tile icon={Thermometer} label="Temperature" value={formatTemp(c?.temperature_c)} note="Air temperature" />
            <Tile icon={Droplets} label="Humidity" value={formatRH(c?.humidity_rh)} note="Relative humidity" />
          </div>
          <p className="fc-sub">{c?.updated_at ? `Sensor updated ${formatDateTime(c.updated_at)} (${timeAgo(c.updated_at)})` : 'No sensor reading yet'}</p>
        </div>

        {analysis?.agreement && AGREEMENT[analysis.agreement] && (
          <p className="fc-agree">{AGREEMENT[analysis.agreement]}</p>
        )}

        <div className="fc-explain">
          <strong>How the two are combined</strong>
          <p>
            The storage rules turn the stall's heat units (CHU) and VPD into days to spoil. The camera model labels each recent
            picture fresh, at-risk or rotten. Trust is <b>High</b> when at least two pictures agree with the batch status at 80 % confidence or more,
            <b> Medium</b> when they agree or the camera sees good skin while heat has already used up days (60 % or more), and <b>Low</b> otherwise.
            With no accepted pictures only the storage rules are used.
          </p>
        </div>
      </Body>
    </section>
  )
}
