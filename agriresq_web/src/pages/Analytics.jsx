import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CROPS, cropLabel, isDetected } from '../api/deviceApi';
import { loadAnalytics, readingsCsv, rescuesCsv, scansCsv } from '../api/analyticsApi';
import { usePolling } from '../hooks/usePolling';
import { buyerTypeLabel, cropEmoji, fmtDate, fmtTime, peso, titleCase } from '../lib/format';

const ICON = { EGGPLANT: '🍆', CUCUMBER: '🥒', CARROT: '🥕' };
const MIN_REVIEWED = 5; // corrections needed before an accuracy figure is shown

const pct = (num, den) => (den > 0 ? (num / den) * 100 : null);
const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function Metric({ label, value, note, valueClass = 'text-slate-800' }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
      <h2 className={`text-4xl font-bold ${valueClass}`}>{value}</h2>
      <p className="text-sm text-slate-500 mt-2 font-medium">{note}</p>
    </div>
  );
}

function Bars({ items, unit = '', empty }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.every((i) => i.value === 0)) return <p className="h-48 flex items-center justify-center text-sm text-slate-400">{empty}</p>;
  return (
    <div className="h-48 flex items-end justify-center gap-6 pb-8 relative">
      {items.map((i) => (
        <div key={i.label} className="flex-1 max-w-24 h-full flex flex-col justify-end items-center relative">
          <span className="text-[11px] font-bold text-slate-700 mb-1">{i.value}{unit}</span>
          <div className={`w-full rounded-t-md border-2 ${i.cls || 'bg-emerald-50 border-emerald-200'}`} style={{ height: `${(i.value / max) * 80}%`, minHeight: i.value ? 4 : 0 }} />
          <span className="absolute -bottom-7 text-[10px] font-bold text-slate-600 text-center whitespace-nowrap">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

const Analytics = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exportMsg, setExportMsg] = useState('');

  usePolling(async () => {
    try {
      setData(await loadAnalytics());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, 60000);

  const stats = useMemo(() => {
    if (!data) return null;
    const sold = data.listings.filter((l) => l.listing_status === 'SOLD');
    const closed = data.listings.filter((l) => ['SOLD', 'EXPIRED', 'CANCELLED'].includes(l.listing_status));
    const kgOf = (l) => Number(l.products?.quantity_kg) || 0;
    const kgRescued = sold.reduce((a, l) => a + kgOf(l), 0);
    const revenue = sold.reduce((a, l) => a + (Number(l.listed_price) || 0), 0);

    const byCrop = CROPS.map((c) => ({
      crop: c.value,
      kg: sold.filter((l) => l.products?.crop_type === c.value).reduce((a, l) => a + kgOf(l), 0),
    }));

    // Operator corrections are the "ground truth" for camera accuracy in the field.
    const reviewed = data.scans.filter((s) => s.feedback_label);
    const accuracyRows = CROPS.map((c) => {
      const mine = reviewed.filter((s) => (s.detected_crop || s.crop_type) === c.value);
      const correct = mine.filter((s) => s.feedback_label === 'correct').length;
      return { crop: c.value, scans: data.scans.filter((s) => isDetected(s) && (s.detected_crop || s.crop_type) === c.value).length,
        reviewed: mine.length, correct, acc: pct(correct, mine.length) };
    });
    const totalReviewed = reviewed.length;
    const totalCorrect = reviewed.filter((s) => s.feedback_label === 'correct').length;

    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
      return { label: String(d.getDate()), key: dayKey(d), value: 0 };
    });
    for (const s of data.scans) {
      if (!isDetected(s)) continue;
      const slot = days.find((d) => d.key === dayKey(new Date(s.created_at)));
      if (slot) slot.value += 1;
    }

    const mix = CROPS.map((c) => {
      const items = data.products.filter((p) => p.crop_type === c.value);
      const n = (st) => items.filter((p) => p.freshness_status === st).length;
      return { crop: c.value, total: items.length, fresh: n('GREEN'), atRisk: n('AMBER'), spoiled: n('RED') };
    });

    return { sold, kgRescued, revenue, rescueRate: pct(sold.length, closed.length), closed: closed.length, byCrop,
      accuracyRows, totalReviewed, totalCorrect, accuracy: totalReviewed >= MIN_REVIEWED ? pct(totalCorrect, totalReviewed) : null,
      days, mix, detections: data.scans.filter(isDetected).length, recentDeals: data.deals.slice(0, 8) };
  }, [data]);

  const runExport = async (fn) => {
    setExportMsg('');
    try {
      await fn();
    } catch (err) {
      setExportMsg(`Export failed: ${err.message}`);
    }
  };

  if (error && !data) return <div role="alert" className="p-10 text-rose-600">Couldn't load analytics: {error}</div>;
  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-slate-400 animate-pulse">
        <h2 className="text-xl font-bold text-slate-600 mt-4">Generating Analytics Report...</h2>
      </div>
    );
  }

  const month = new Date().toLocaleString('en-PH', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Reports & Analytics</h1>
          <p className="text-slate-500 text-sm mt-1">Post-harvest performance of every stall • all time to {month}</p>
        </div>
        <button onClick={() => window.print()} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 shadow-sm">
          Print / Save as PDF
        </button>
      </div>

      {data.dealsError && (
        <div role="alert" className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm">
          Completed deals could not be loaded: {data.dealsError}
        </div>
      )}

      {data.deviceError && (
        <div role="alert" className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm">
          Camera backend not reachable ({data.deviceError}). Marketplace figures are shown; camera figures are empty.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Metric label="Total KG Rescued" value={<>{stats.kgRescued} <span className="text-xl">kg</span></>} valueClass="text-[#2A6B48]"
                note={`${stats.sold.length} listing${stats.sold.length === 1 ? '' : 's'} sold`} />
        <Metric label="Rescue Revenue" value={`₱${stats.revenue.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`}
                note="From sold rescue listings" />
        <Metric label="Rescue Rate" value={fmtPct(stats.rescueRate)} valueClass="text-[#2A6B48]"
                note={stats.closed ? `${stats.sold.length} of ${stats.closed} closed listings sold` : 'No closed listings yet'} />
        <Metric label="Camera Accuracy" value={fmtPct(stats.accuracy)} valueClass="text-blue-600"
                note={stats.accuracy == null ? `Needs ${MIN_REVIEWED}+ reviewed scans (${stats.totalReviewed} so far)` : `${stats.totalCorrect} of ${stats.totalReviewed} scans confirmed correct`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">kg Rescued by Crop</h3>
          <p className="text-xs text-slate-500 mb-6">Produce sold through the rescue marketplace</p>
          <Bars items={stats.byCrop.map((c) => ({ label: `${ICON[c.crop]} ${cropLabel(c.crop)}`, value: c.kg }))} unit=" kg" empty="No sold listings yet." />
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Camera detections — last 7 days</h3>
          <p className="text-xs text-slate-500 mb-6">Scans where an eggplant, cucumber or carrot was found ({stats.detections} in total)</p>
          <Bars items={stats.days} empty="No detections in the last 7 days." />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-800">Camera accuracy from operator corrections</h3>
            <p className="text-xs text-slate-500 mt-0.5">Each “Correct” / “Wrong” pressed on a scan counts here and is used to retrain the AI</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100 bg-slate-50/50">
                  <th className="p-4 pl-6">Crop</th><th className="p-4 text-center">Detections</th>
                  <th className="p-4 text-center">Reviewed</th><th className="p-4 text-center">Correct</th>
                  <th className="p-4">Accuracy</th><th className="p-4 pr-6">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {stats.accuracyRows.map((r) => {
                  const enough = r.reviewed >= MIN_REVIEWED;
                  const good = enough && r.acc >= 90;
                  const color = !enough ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-amber-500';
                  return (
                    <tr key={r.crop}>
                      <td className="p-4 pl-6 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-lg">{ICON[r.crop]}</div>
                        <span className="font-bold text-slate-800">{cropLabel(r.crop)}</span>
                      </td>
                      <td className="p-4 text-center text-slate-600">{r.scans}</td>
                      <td className="p-4 text-center text-slate-600">{r.reviewed}</td>
                      <td className="p-4 text-center text-slate-600">{r.correct}</td>
                      <td className={`p-4 font-bold ${color}`}>{enough ? fmtPct(r.acc) : '—'}</td>
                      <td className={`p-4 pr-6 text-xs font-bold ${color}`}>● {!enough ? 'Not enough reviews' : good ? 'Good' : 'Review'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Batch freshness mix</h3>
          <p className="text-xs text-slate-500 mb-6">Current batches by status</p>
          <div className="space-y-5">
            {stats.mix.map((m) => (
              <div key={m.crop}>
                <div className="flex justify-between text-sm mb-1.5 font-bold">
                  <span className="text-slate-800">{ICON[m.crop]} {cropLabel(m.crop)}</span>
                  <span className="text-slate-500 text-xs">{m.total} batch{m.total === 1 ? '' : 'es'}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 flex overflow-hidden" role="img"
                     aria-label={`${m.fresh} fresh, ${m.atRisk} at-risk, ${m.spoiled} rotten`}>
                  {m.total > 0 && <>
                    <div className="bg-emerald-500 h-2" style={{ width: `${(m.fresh / m.total) * 100}%` }} />
                    <div className="bg-amber-500 h-2" style={{ width: `${(m.atRisk / m.total) * 100}%` }} />
                    <div className="bg-rose-500 h-2" style={{ width: `${(m.spoiled / m.total) * 100}%` }} />
                  </>}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">{m.fresh} fresh • {m.atRisk} at-risk • {m.spoiled} rotten</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">Recent deals</h3>
            <p className="text-xs text-slate-500 mt-0.5">Latest completed rescue deals with the stall operator and the rescue buyer</p>
          </div>
          <Link to="/marketplace" className="text-sm font-bold text-[#2A6B48] hover:underline">All deals →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100 bg-slate-50/50">
                <th className="p-4 pl-6">Date</th><th className="p-4">Crop</th><th className="p-4">Qty / Total</th>
                <th className="p-4">Stall operator</th><th className="p-4 pr-6">Rescue buyer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.recentDeals.length === 0 && (
                <tr><td colSpan="5" className="p-6 text-center text-slate-400">{data.dealsError ? 'Deal history unavailable.' : 'No completed deals yet.'}</td></tr>
              )}
              {stats.recentDeals.map((d) => (
                <tr key={d.thread_id} className="align-top">
                  <td className="p-4 pl-6"><p className="font-bold text-slate-800">{fmtDate(d.completed_at)}</p><p className="text-xs text-slate-500">{fmtTime(d.completed_at)}</p></td>
                  <td className="p-4 font-bold text-slate-800">{cropEmoji(d.crop_type)} {titleCase(d.crop_type)}</td>
                  <td className="p-4"><p className="font-semibold text-slate-700">{d.quantity_kg} kg</p><p className="text-xs text-[#2A6B48] font-bold">{peso(d.total, 2)} <span className="text-slate-400 font-normal">({peso(d.price_per_kg, 2)}/kg)</span></p></td>
                  <td className="p-4"><p className="font-bold text-slate-800">{d.operator_name || 'Unknown'}</p><p className="text-xs text-slate-500">{d.stall_number ? `Stall ${d.stall_number}` : ''}</p><p className="text-xs text-slate-400 break-all">{d.operator_email}</p></td>
                  <td className="p-4 pr-6"><p className="font-bold text-slate-800">{d.buyer_name || 'Unknown'}</p><p className="text-xs text-slate-500">{buyerTypeLabel(d.buyer_type)}</p><p className="text-xs text-slate-400 break-all">{d.buyer_email}</p></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-base font-bold text-slate-800 mb-1">Downloadable data (CSV)</h3>
        <p className="text-xs text-slate-500 mb-5">Raw exports straight from the cameras and marketplace, ready for spreadsheets or your report</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            ['Scan log', 'Every camera scan: crop, status, freshness, confidence and your corrections.', () => scansCsv(data.scans, data.devices), !data.scans.length],
            ['Sensor log', 'DHT22 temperature, humidity and VPD readings from all nodes.', () => readingsCsv(data.devices), !data.devices.length],
            ['Rescue transactions', 'Marketplace listings and completed deals: date, crop, kg, price, plus the stall operator and rescue buyer (name, stall / buyer type, email).', () => rescuesCsv(data.listings, data.deals), !data.listings.length && !data.deals.length],
          ].map(([title, text, fn, disabled]) => (
            <button key={title} type="button" disabled={disabled} onClick={() => runExport(fn)}
                    className="text-left border border-slate-100 rounded-xl p-5 hover:border-emerald-200 disabled:opacity-50 disabled:hover:border-slate-100 transition-colors">
              <h4 className="font-bold text-slate-800 text-sm mb-2">{title}</h4>
              <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">{text}</p>
              <span className="text-[11px] font-bold text-[#2A6B48]">{disabled ? 'No data yet' : 'Download CSV'}</span>
            </button>
          ))}
        </div>
        {exportMsg && <p role="alert" className="text-xs text-rose-600 mt-3">{exportMsg}</p>}
      </div>
    </div>
  );
};

export default Analytics;
