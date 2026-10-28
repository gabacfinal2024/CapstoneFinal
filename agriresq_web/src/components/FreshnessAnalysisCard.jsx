import { useCallback, useEffect, useState } from 'react'
import { Activity, Droplets, Flame, Gauge, Percent, ScanEye, Thermometer, Timer } from 'lucide-react'
import { deviceApi } from '../api/deviceApi'
import { fmtDateTime, freshnessMeta, titleCase } from '../lib/format'

/** How far to trust the result: badge style, label and the one-sentence explanation. */
const LEVELS = {
  HIGH: {
    label: 'High trust',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    text: 'At least two accepted camera scans agree with the stored status and the camera is at least 80 % confident, so this result is very reliable.',
  },
  MEDIUM: {
    label: 'Medium trust',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
    text: 'The camera agrees with the stored status (or sees good skin while heat has already used up days) with at least 60 % confidence, so the result is probably right.',
  },
  LOW: {
    label: 'Low trust',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    text: 'The camera is unsure or disagrees with the stored status, so check the produce by eye before acting on this result.',
  },
  RULES_ONLY: {
    label: 'Rules only - no camera scans yet',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    text: 'No accepted camera scans in the last 48 hours, so only the heat (CHU) and dryness (VPD) rules decide the status.',
  },
}

/** Plain-language line for how the camera and the rules compare. */
const AGREEMENTS = {
  agree: { tone: 'bg-emerald-50 border-emerald-100 text-emerald-800', text: (status) => `The camera and the rules agree: the batch is ${status}.` },
  rules_stricter: { tone: 'bg-amber-50 border-amber-100 text-amber-800', text: () => 'The camera sees good skin, but heat has already used up days of shelf life, so the rules are stricter and their result is kept.' },
  camera_stricter: { tone: 'bg-rose-50 border-rose-100 text-rose-800', text: () => 'The camera sees more spoilage than the rules do, so the camera can bring the status down once a second scan agrees (or one scan is at least 90 % confident).' },
  no_camera: { tone: 'bg-slate-50 border-slate-200 text-slate-600', text: () => 'There are no accepted camera scans to compare with, so only the rules speak.' },
}

const asFraction = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v) > 1 ? Number(v) / 100 : Number(v))
const pct = (v, digits = 0) => { const f = asFraction(v); return f == null ? '—' : `${(f * 100).toFixed(digits)} %` }
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/** Same-size tile used in both blocks so the two columns line up. */
function Tile({ icon: Icon, iconCls, value, label, hint, tone = 'bg-slate-50' }) {
  return (
    <div className={`rounded-xl px-3 py-3 min-w-0 h-[5.5rem] flex flex-col justify-between ${tone}`}>
      <p className="text-xl font-bold text-slate-800 leading-none flex items-center gap-1.5 tabular-nums whitespace-nowrap">
        <Icon size={15} className={`shrink-0 ${iconCls}`} aria-hidden="true" />
        <span className="truncate">{value}</span>
      </p>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-600 truncate">{label}</p>
        <p className="text-[11px] text-slate-400 truncate">{hint}</p>
      </div>
    </div>
  )
}

function Block({ icon: Icon, title, subtitle, badge, children, footer }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-start justify-between gap-3 min-h-10">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Icon size={16} className="text-[#2A6B48] shrink-0" aria-hidden="true" />{title}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        {badge}
      </div>
      <div className="grid grid-cols-3 gap-3">{children}</div>
      <p className="mt-auto pt-3 border-t border-slate-100 text-xs font-medium text-slate-400">{footer}</p>
    </section>
  )
}

function CameraBlock({ camera }) {
  if (!camera) {
    return (
      <Block icon={ScanEye} title="Camera (ML)" subtitle="ESP32-CAM freshness model, recent accepted scans"
             badge={<span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 shrink-0">No scans</span>}
             footer="Last scan: none accepted in the last 48 hours">
        <Tile icon={Activity} iconCls="text-emerald-600" value="—" label="Scans agreeing" hint="of 0 recent scans" />
        <Tile icon={Percent} iconCls="text-sky-500" value="—" label="Mean confidence" hint="per accepted scan" />
        <Tile icon={Activity} iconCls="text-violet-500" value="—" label="Consistency" hint="how alike the scans are" />
        <div className="col-span-3 rounded-xl bg-slate-50 px-3 py-3 h-[5.5rem] flex items-center justify-center text-center text-xs text-slate-400">
          Place the batch in front of its camera and press Scan now to add the camera's opinion.
        </div>
      </Block>
    )
  }
  const meta = freshnessMeta(camera.status)
  const conf = asFraction(camera.confidence)
  const barCls = conf == null ? 'bg-slate-300' : conf >= 0.8 ? 'bg-emerald-500' : conf >= 0.6 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <Block icon={ScanEye} title="Camera (ML)" subtitle="ESP32-CAM freshness model, recent accepted scans"
           badge={<span className={`px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${meta.badge}`}>● {titleCase(camera.state || meta.label)}</span>}
           footer={`Last scan: ${camera.last_scan_at ? fmtDateTime(camera.last_scan_at) : 'none'}${camera.last_state ? ` (${titleCase(camera.last_state)})` : ''}`}>
      <Tile icon={Activity} iconCls="text-emerald-600" tone="bg-emerald-50/60" value={`${camera.agreeing ?? '—'} of ${camera.scans ?? '—'}`} label="Scans agreeing" hint="of the recent scans" />
      <Tile icon={Percent} iconCls="text-sky-500" tone="bg-sky-50/70" value={pct(camera.mean_confidence)} label="Mean confidence" hint="average over the scans" />
      <Tile icon={Activity} iconCls="text-violet-500" tone="bg-violet-50/60" value={pct(camera.consistency)} label="Consistency" hint="how alike the scans are" />
      <div className="col-span-3 rounded-xl bg-slate-50 px-3 py-3 h-[5.5rem] flex flex-col justify-between">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-slate-600">Combined confidence</p>
          <p className="text-xl font-bold text-slate-800 leading-none tabular-nums">{pct(camera.confidence)}</p>
        </div>
        <div role="progressbar" aria-label="Combined camera confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={conf == null ? undefined : Math.round(conf * 100)}
             className="relative h-2.5 rounded-full bg-slate-200 overflow-hidden">
          <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(100, Math.max(0, (conf || 0) * 100))}%` }} />
          <span className="absolute top-0 bottom-0 w-px bg-slate-400/70" style={{ left: '60%' }} aria-hidden="true" />
          <span className="absolute top-0 bottom-0 w-px bg-slate-400/70" style={{ left: '80%' }} aria-hidden="true" />
        </div>
        <p className="text-[11px] text-slate-400 truncate">mean confidence × consistency • marks at 60 % and 80 %</p>
      </div>
    </Block>
  )
}

function RulesBlock({ analysis }) {
  const meta = freshnessMeta(analysis.rules_status || analysis.status)
  const c = analysis.climate || null
  const temp = num(c?.temperature_c)
  const rh = num(c?.humidity_rh)
  const vpd = num(c?.vpd_kpa)
  const chu = num(c?.chu)
  const days = num(analysis.days_to_spoil)
  const pctFresh = num(analysis.freshness_percent)
  return (
    <Block icon={Flame} title="Rules (CHU / VPD)" subtitle="Heat units and dryness from the stall's DHT22"
           badge={<span className={`px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${meta.badge}`}>● {meta.label}</span>}
           footer={`Climate updated: ${c?.updated_at ? fmtDateTime(c.updated_at) : '—'}`}>
      <Tile icon={Timer} iconCls="text-emerald-600" tone="bg-emerald-50/60" value={days != null ? days.toFixed(1) : '—'} label="Days to spoil" hint={pctFresh != null ? `${Math.round(pctFresh)} % fresh` : 'predicted shelf life'} />
      <Tile icon={Flame} iconCls="text-rose-500" tone="bg-rose-50/60" value={chu != null ? Math.round(chu).toLocaleString() : '—'} label="Heat units (CHU)" hint="degree-hours above 25 °C" />
      <Tile icon={Gauge} iconCls="text-sky-500" tone="bg-sky-50/70" value={vpd != null ? vpd.toFixed(2) : '—'} label="VPD" hint="kPa, dryness of the air" />
      <Tile icon={Thermometer} iconCls="text-amber-500" tone="bg-amber-50/60" value={temp != null ? `${temp.toFixed(1)}°C` : '—'} label="Temperature" hint="stall sensor" />
      <Tile icon={Droplets} iconCls="text-[#2A6B48]" tone="bg-emerald-50/60" value={rh != null ? `${rh.toFixed(0)}%` : '—'} label="Humidity" hint="relative humidity" />
      <Tile icon={Percent} iconCls="text-slate-500" value={pctFresh != null ? `${Math.round(pctFresh)}%` : '—'} label="Freshness" hint={`status: ${freshnessMeta(analysis.status).label}`} />
    </Block>
  )
}

function ModelFooter({ model }) {
  if (!model) return null
  const acc = num(model.accuracy)
  const f1 = num(model.macro_f1)
  const n = num(model.test_images)
  const extras = [
    num(model.target_accepted) != null && `${pct(model.target_accepted, 1)} of target-vegetable photos accepted`,
    num(model.non_target_rejected_seen) != null && `${pct(model.non_target_rejected_seen, 1)} of other-vegetable photos rejected`,
    num(model.non_target_rejected_unseen) != null && `${pct(model.non_target_rejected_unseen, 1)} of never-seen objects rejected`,
  ].filter(Boolean)
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs text-slate-600">
      <p>
        <span className="font-bold text-slate-700">Model reliability. </span>
        The freshness model scored {acc != null ? `${(acc * 100).toFixed(1)} %` : '—'} accuracy and {f1 != null ? f1.toFixed(3) : '—'} macro-F1
        on {n != null ? n.toLocaleString('en-US') : '—'} held-out test photos.
        {extras.length > 0 && <span className="text-slate-500"> {extras.join(' • ')}.</span>}
      </p>
    </div>
  )
}

function Explainer() {
  const items = [
    ['Rules', 'Heat units (CHU, degree-hours above 25 °C) and dryness (VPD) from the stall sensor turn into days left and a status.'],
    ['Camera', 'Each accepted photo of the batch is classified fresh, at-risk or rotten. Confidence is the mean confidence of up to 10 scans from the last 48 hours, times how consistent they are.'],
    ['Together', 'The camera can only change the stored status after a second agreeing scan, unless one scan is at least 90 % confident. The trust level says how far to rely on the result.'],
  ]
  return (
    <div>
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">How the two are combined</h3>
      <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {items.map(([k, v]) => (
          <li key={k} className="rounded-xl border border-slate-100 p-3 text-xs text-slate-600 leading-relaxed">
            <span className="block font-bold text-slate-700 mb-0.5">{k}</span>{v}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Shell({ updated, children }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-slate-800">Freshness analysis</h2>
        {updated}
      </div>
      {children}
    </div>
  )
}

/** Why the analysis failed, in plain words. */
function errorText(err) {
  if (err?.status === 503) return `The hub cannot analyse batches yet: ${String(err.message || 'it has no Supabase key configured').replace(/\.+$/, '')}. Add the service key to the backend settings and restart it.`
  if (err?.status === 404) return 'The hub has no analysis for this batch (it may have been removed).'
  if (err?.status === 403 || err?.status === 401) return err.message
  return `The backend is offline or unreachable: ${err?.message || 'unknown error'}. Start the Django hub and try again.`
}

/** Combined camera (ML) + sensor-rules analysis of one batch, from GET /api/batches/<id>/analysis/. */
export default function FreshnessAnalysisCard({ productId }) {
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const load = useCallback(async () => {
    try {
      const data = await deviceApi.batchAnalysis(productId)
      setState({ loading: false, error: null, data })
    } catch (error) {
      setState((s) => ({ loading: false, error, data: s.data }))
    }
  }, [productId])

  useEffect(() => {
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, 30000)
    return () => clearInterval(timer)
  }, [load])

  const { loading, error, data } = state

  if (loading) {
    return (
      <Shell>
        <p className="text-sm text-slate-400 animate-pulse py-10 text-center">Analysing batch…</p>
      </Shell>
    )
  }
  if (!data) {
    return (
      <Shell>
        <div role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <span>{errorText(error)}</span>
          <button type="button" onClick={() => { setState({ loading: true, error: null, data: null }); load() }}
                  className="px-3 py-1.5 rounded-lg border border-amber-200 bg-white text-xs font-bold text-amber-800 hover:bg-amber-100">Try again</button>
        </div>
      </Shell>
    )
  }

  const level = LEVELS[data.level] || LEVELS.RULES_ONLY
  const agreement = AGREEMENTS[data.agreement] || AGREEMENTS.no_camera
  const statusLabel = freshnessMeta(data.status).label.toLowerCase()

  return (
    <Shell updated={error && <span className="text-xs text-amber-700">Showing the last result; refresh failed.</span>}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={`px-3 py-1.5 rounded-full text-sm font-bold border ${level.badge}`}>{level.label}</span>
        <p className="text-sm text-slate-600 flex-1 min-w-64">{level.text}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <CameraBlock camera={data.camera} />
        <RulesBlock analysis={data} />
      </div>

      <p role="status" className={`text-sm font-medium rounded-xl border px-4 py-3 ${agreement.tone}`}>{agreement.text(statusLabel)}</p>

      <ModelFooter model={data.model} />
      <Explainer />
    </Shell>
  )
}
