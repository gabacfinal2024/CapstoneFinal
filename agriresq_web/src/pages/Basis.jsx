import { useEffect, useMemo, useState } from 'react';
import { CROPS, cropLabel, deviceApi } from '../api/deviceApi';

const ICON = { EGGPLANT: '🍆', CUCUMBER: '🥒', CARROT: '🥕' };
const CROP_BADGE = {
  EGGPLANT: 'bg-violet-50 text-violet-700 border-violet-200',
  CUCUMBER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CARROT: 'bg-orange-50 text-orange-700 border-orange-200',
};

// Formula cards: the formulas themselves are text (the numbers come from the engine table below).
const FORMULAS = [
  {
    title: 'Aging rate',
    formula: 'rate = Q10 ^ ((T − 25) / 10)',
    lines: [
      'Produce ages Q10 times faster for every 10 °C of warmth, measured from 25 °C.',
      'Cool storage never slows ageing below 0.5×, and chilling-sensitive crops get no benefit below 10 °C.',
    ],
  },
  {
    title: 'VPD (kPa)',
    formula: 'VPD = 0.6108 · exp(17.27·T / (T + 237.3)) · (1 − RH/100)',
    lines: [
      'Tetens equation: how strongly the air pulls water out of the produce.',
      'Air drier than a crop’s VPD threshold adds water-loss ageing on top of the temperature effect.',
    ],
  },
  {
    title: 'CHU',
    formula: 'CHU = Σ (T − 25) · hours, for T above 25 °C',
    lines: [
      'Crop Heat Units: degree-hours spent above 25 °C.',
      'Each CHU removes 0.00125 days of remaining life, accumulated per batch since harvest.',
    ],
  },
  {
    title: 'Days to spoil',
    formula: 'days = baseline ÷ (rate + CHU penalty per day)',
    lines: [
      'Baseline is the crop’s shelf life at 25 °C. Faster ageing shortens it.',
      'Fresh: 3 days or more. At-Risk: under 3 days. Rotten: 0 days.',
    ],
  },
];

const VERDICT_STYLE = [
  [/^consistent/i, 'bg-emerald-100 text-emerald-700 border-emerald-200'],
  [/^conservative/i, 'bg-sky-100 text-sky-700 border-sky-200'],
  [/^right direction/i, 'bg-amber-100 text-amber-700 border-amber-200'],
];
const verdictClass = (v) => VERDICT_STYLE.find(([re]) => re.test(v || ''))?.[1] || 'bg-slate-100 text-slate-600 border-slate-200';

const num = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : String(Number(Number(v).toFixed(digits))));
const asRange = (v) => (Array.isArray(v) ? [Number(v[0]), Number(v[v.length - 1])] : v == null ? null : [Number(v), Number(v)]);
const rangeText = (r) => (!r ? '—' : r[0] === r[1] ? `${num(r[0])} days` : `${num(r[0])}–${num(r[1])} days`);

/** What the row compares: the observed band and the engine's number (extension studies compare extra days). */
function comparison(s) {
  const isExt = s.kind === 'extension';
  const band = asRange(isExt ? s.observed_extension_days ?? s.observed_days : s.observed_days);
  const predRange = asRange(isExt ? s.predicted_extension_days ?? s.predicted_days : s.predicted_days);
  return { isExt, band, pred: predRange ? predRange[0] : null, predHi: predRange ? predRange[1] : null };
}

function observedText(s) {
  const { band, isExt } = comparison(s);
  if (s.kind === 'range' && band) return rangeText(band);
  if (isExt && band) return `+${rangeText(band)} longer`;
  return s.observed || (band ? rangeText(band) : '—');
}

function predictedText(s) {
  const { isExt, pred, predHi } = comparison(s);
  if (pred == null) return 'no estimate';
  const body = pred === predHi ? rangeText([pred, pred]) : rangeText([pred, predHi]);
  return isExt ? `+${body} longer` : body;
}

/** Observed band + engine marker on one shared 0..max scale, so every row has the same width. */
function CompareBar({ study, max }) {
  const { band, pred, isExt } = comparison(study);
  const pos = (v) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const label = `${band ? `Observed ${rangeText(band)}` : 'No numeric observation'}; engine ${pred == null ? 'has no estimate' : rangeText([pred, pred])}`;
  return (
    <div role="img" aria-label={label} title={label} className="w-44">
      <div className="relative h-4 rounded-full bg-slate-100">
        {band && (
          <div className="absolute top-0.5 bottom-0.5 rounded-full bg-emerald-300/80 border border-emerald-400"
               style={{ left: pos(band[0]), width: `max(6px, calc(${pos(band[1])} - ${pos(band[0])}))` }} />
        )}
        {study.spoiled_before_days != null && (
          <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-rose-400" style={{ left: pos(study.spoiled_before_days) }} title={`Spoiled before ${num(study.spoiled_before_days)} days`} />
        )}
        {pred != null && (
          <div className="absolute -top-1 -bottom-1 w-1 -ml-0.5 rounded bg-slate-800" style={{ left: pos(pred) }} />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
        <span>0</span><span>{isExt ? '+' : ''}{num(max)} d</span>
      </div>
    </div>
  );
}

function Card({ title, children, className = '' }) {
  return (
    <section className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-6 ${className}`}>
      {title && <h2 className="text-base font-bold text-slate-800 mb-1">{title}</h2>}
      {children}
    </section>
  );
}

const Th = ({ children, className = '' }) => (
  <th className={`px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap ${className}`}>{children}</th>
);

const Basis = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    deviceApi.referenceShelfLife()
      .then((d) => { if (alive) { setData(d); setError(''); } })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [tick]);

  const crops = data?.engine?.crops || {};
  const cropOrder = useMemo(() => {
    const known = CROPS.map((c) => c.value);
    const extra = Object.keys(crops).filter((c) => !known.includes(c));
    return [...known, ...extra];
  }, [crops]);

  const groups = useMemo(() => {
    const studies = data?.studies || [];
    const all = [...new Set([...cropOrder, ...studies.map((s) => s.crop)])];
    return all
      .map((crop) => ({ crop, rows: studies.filter((s) => s.crop === crop) }))
      .filter((g) => g.rows.length);
  }, [data, cropOrder]);

  // One shared scale for every comparison bar (largest number on the page, rounded up).
  const max = useMemo(() => {
    const vals = (data?.studies || []).flatMap((s) => {
      const c = comparison(s);
      return [...(c.band || []), c.pred, c.predHi, s.spoiled_before_days].filter((v) => v != null && !Number.isNaN(v));
    });
    return Math.max(1, Math.ceil(Math.max(0, ...vals)));
  }, [data]);

  const engine = data?.engine;

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Days-to-Spoil Basis</h1>
        <p className="text-slate-500 text-sm mt-1">How AgriResQ estimates shelf life, and the published measurements it is checked against</p>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm flex flex-wrap items-center justify-between gap-3">
          <span>Could not load the reference data: {error}</span>
          <button onClick={() => { setError(''); setTick((t) => t + 1); }} className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 font-bold hover:bg-rose-100">Try again</button>
        </div>
      )}

      {/* 1. Formulas (static text) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
        {FORMULAS.map((f) => (
          <Card key={f.title} className="flex flex-col h-full">
            <h2 className="text-base font-bold text-slate-800">{f.title}</h2>
            <code className="block mt-3 mb-4 px-3 py-2.5 rounded-lg bg-slate-900 text-emerald-300 text-[13px] leading-relaxed font-mono break-words">{f.formula}</code>
            <ul className="space-y-2 text-sm text-slate-600 list-disc pl-5 marker:text-emerald-500">
              {f.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </Card>
        ))}
      </div>

      {!data && !error && (
        <div className="p-10 text-center text-slate-400 animate-pulse bg-white rounded-2xl border border-slate-200">Loading engine parameters and published studies…</div>
      )}

      {data && (
        <>
          {/* 2. Engine parameters */}
          <Card title="Engine parameters">
            <p className="text-xs text-slate-500 mb-4">The values the spoilage engine uses right now, per crop.</p>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-slate-100">
                  <tr><Th>Crop</Th><Th>Baseline at 25 °C</Th><Th>Q10</Th><Th>Min. RH</Th><Th>VPD threshold</Th><Th>Chilling below</Th></tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {Object.entries(crops).sort(([a], [b]) => cropOrder.indexOf(a) - cropOrder.indexOf(b)).map(([crop, p]) => (
                    <tr key={crop}>
                      <td className="px-4 py-3 font-bold text-slate-700">{ICON[crop]} {cropLabel(crop)}</td>
                      <td className="px-4 py-3 text-slate-600">{num(p.baseline_days_at_25c)} days</td>
                      <td className="px-4 py-3 text-slate-600">{num(p.q10)}</td>
                      <td className="px-4 py-3 text-slate-600">{p.min_rh == null ? '—' : `${num(p.min_rh)} %`}</td>
                      <td className="px-4 py-3 text-slate-600">{p.vpd_threshold_kpa == null ? '—' : `${num(p.vpd_threshold_kpa, 2)} kPa`}</td>
                      <td className="px-4 py-3 text-slate-600">{p.chilling_below_c == null ? 'not sensitive' : `${num(p.chilling_below_c)} °C`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {engine && (
              <dl className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  ['Water loss per kPa', engine.vpd_water_loss_per_kpa],
                  ['CHU penalty (days per degree-hour)', engine.chu_penalty_days_per_degree_hour],
                  ['Reference temperature', engine.reference_temp_c == null ? null : `${num(engine.reference_temp_c)} °C`],
                  ['Fastest rate', engine.max_rate == null ? null : `${num(engine.max_rate, 2)}×`],
                  ['Slowest rate', engine.min_rate == null ? null : `${num(engine.min_rate, 2)}×`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{k}</dt>
                    <dd className="text-lg font-bold text-slate-800 mt-1">{v ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {/* 3. Evidence */}
          <Card title="Evidence: published measurements vs the engine">
            <p className="text-xs text-slate-500 mb-3">Each row is a real storage study. The green band is what was observed; the dark marker is what our engine predicts for the same temperature and humidity.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500 mb-4">
              <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-2.5 rounded-full bg-emerald-300/80 border border-emerald-400" /> Observed range</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-1 h-3.5 rounded bg-slate-800" /> Engine prediction</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-0.5 h-3.5 bg-rose-400" /> Spoiled before this</span>
              <span>All bars share one scale: 0 to {num(max)} days</span>
            </div>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="border-b border-slate-100">
                  <tr><Th>Crop</Th><Th>Where</Th><Th>Conditions</Th><Th>Observed</Th><Th>Engine</Th><Th>Comparison</Th><Th>Verdict</Th><Th>Source</Th></tr>
                </thead>
                {groups.map(({ crop, rows }) => (
                  <tbody key={crop} className="divide-y divide-slate-50 border-b border-slate-100 last:border-0">
                    {rows.map((s) => (
                      <tr key={s.id} className="align-top">
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold ${CROP_BADGE[s.crop] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            {ICON[s.crop]} {cropLabel(s.crop)}
                          </span>
                          <p className="text-[11px] text-slate-400 mt-1 font-mono">{s.id}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <p className="font-medium">{s.country}</p>
                          {s.place && <p className="text-xs text-slate-500">{s.place}</p>}
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-52">{s.conditions?.text || '—'}</td>
                        <td className="px-4 py-3 text-slate-700 max-w-52">
                          <p className="font-medium">{observedText(s)}</p>
                          {s.kind === 'upper_bound' && s.spoiled_before_days != null && <p className="text-xs text-slate-500">spoiled before {num(s.spoiled_before_days)} days</p>}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{predictedText(s)}</td>
                        <td className="px-4 py-3"><CompareBar study={s} max={max} /></td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-1 rounded-full border text-xs font-bold ${verdictClass(s.verdict)}`}>{s.verdict || 'not rated'}</span>
                        </td>
                        <td className="px-4 py-3 max-w-64">
                          {s.url
                            ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline font-medium text-xs leading-snug">{s.citation}</a>
                            : <span className="text-xs text-slate-600">{s.citation}</span>}
                          <p className="mt-1">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${/^full/i.test(s.access || '') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{s.access || 'access unknown'}</span>
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </Card>

          {/* 4. Parameter basis and limits */}
          {data.parameters?.length > 0 && (
            <Card title="How each parameter was chosen">
              <ul className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                {data.parameters.map((p) => (
                  <li key={p.parameter} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-sm font-bold text-slate-800">{p.parameter}</p>
                    <p className="text-sm text-slate-600 mt-1">{p.basis}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div role="note" className="p-5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
            <p className="font-bold text-sm">These are published measurements from other cultivars and handling; validate with our own spoilage records.</p>
            {data.limits && <p className="text-sm mt-2 text-amber-800">{data.limits}</p>}
          </div>
        </>
      )}
    </div>
  );
};

export default Basis;
