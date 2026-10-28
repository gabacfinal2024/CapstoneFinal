import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/supabaseApi';
import { downloadCsv } from '../api/analyticsApi';
import { cropEmoji, fmtDate, fmtDateTime, fmtTime, cameraConfidencePct, freshnessMeta, pairedSensor, titleCase } from '../lib/format';

const selectCls = 'px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

const SORTS = [
  ['NEWEST', 'Sort: Newest'],
  ['DAYS_ASC', 'Sort: Days left (lowest)'],
  ['QTY_DESC', 'Sort: Quantity'],
  ['CROP', 'Sort: Crop'],
];

const mapBatch = (row) => ({
  id: row.id,
  node: row.iot_node_id ? `Node ${row.iot_node_id}` : 'No sensor node',
  crop: row.crop_type || 'Unknown',
  qty: Number(row.quantity_kg) || 0,
  price: row.current_price_per_kg,
  harvest: row.harvest_datetime || row.created_at,
  createdAt: row.created_at,
  days: row.predicted_shelf_life != null ? Number(row.predicted_shelf_life) : null,
  percent: row.freshness_percent,
  status: row.freshness_status || 'UNKNOWN',
  listed: !!row.is_listed,
  operator: row.profiles?.full_name || 'Unknown operator',
  stall: row.profiles?.stall_number || '',
  camConf: cameraConfidencePct(row),
  sensor: pairedSensor(row),
});

const Batches = () => {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [cropFilter, setCropFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [listedFilter, setListedFilter] = useState('ALL');
  const [sort, setSort] = useState('NEWEST');

  useEffect(() => {
    let alive = true;
    api.batches()
      .then((data) => { if (alive) setBatches((data || []).map(mapBatch)); })
      .catch((err) => {
        console.error('Failed to fetch batches:', err);
        if (alive) setError(err.message || 'Could not load batches.');
      })
      .finally(() => { if (alive) setIsLoading(false); });
    return () => { alive = false; };
  }, []);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = batches.filter((b) => {
      if (cropFilter !== 'ALL' && b.crop !== cropFilter) return false;
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (listedFilter === 'LISTED' && !b.listed) return false;
      if (listedFilter === 'UNLISTED' && b.listed) return false;
      if (!term) return true;
      return [b.id, `batch ${b.id}`, b.crop, b.operator, b.stall, b.node].some((v) => String(v ?? '').toLowerCase().includes(term));
    });
    const sorters = {
      NEWEST: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      DAYS_ASC: (a, b) => (a.days ?? 999) - (b.days ?? 999),
      QTY_DESC: (a, b) => b.qty - a.qty,
      CROP: (a, b) => a.crop.localeCompare(b.crop),
    };
    return list.slice().sort(sorters[sort]);
  }, [batches, q, cropFilter, statusFilter, listedFilter, sort]);

  const count = (status) => batches.filter((b) => b.status === status).length;
  const filtersActive = q || cropFilter !== 'ALL' || statusFilter !== 'ALL' || listedFilter !== 'ALL';
  const reset = () => { setQ(''); setCropFilter('ALL'); setStatusFilter('ALL'); setListedFilter('ALL'); };

  const exportCsv = () => {
    downloadCsv('agriresq_batches.csv',
      ['batch_id', 'crop', 'operator', 'stall', 'kg', 'price_per_kg', 'harvest_time', 'days_left', 'freshness_percent', 'status', 'camera_confidence_percent', 'listed', 'temp_c', 'humidity_rh', 'vpd_kpa', 'chu'],
      visible.map((b) => [b.id, b.crop, b.operator, b.stall, b.qty, b.price, b.harvest, b.days, b.percent, freshnessMeta(b.status).label, b.camConf, b.listed ? 'yes' : 'no', b.sensor.temp, b.sensor.rh, b.sensor.vpd, b.sensor.chu]));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-slate-400 animate-pulse">
        <h2 className="text-xl font-bold text-slate-600 mt-4">Loading harvest batches...</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Batches</h1>
          <p className="text-slate-500 text-sm mt-1">Bulua Westbound Terminal • All stalls</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={visible.length === 0}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          Export CSV
        </button>
      </div>

      {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">Could not load batches: {error}</div>}

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Total Batches</p>
          <h2 className="text-3xl font-bold text-emerald-800">{batches.length}</h2>
          <p className="text-sm text-slate-500 mt-1">Across every stall</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">At-Risk Batches</p>
          <h2 className="text-3xl font-bold text-amber-500">{count('AMBER')}</h2>
          <p className="text-sm text-amber-600 mt-1">Should be listed for rescue</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-emerald-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Fresh Batches</p>
          <h2 className="text-3xl font-bold text-emerald-600">{count('GREEN')}</h2>
          <p className="text-sm text-emerald-600 mt-1">Within safe threshold</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-rose-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Rotten</p>
          <h2 className="text-3xl font-bold text-rose-500">{count('RED')}</h2>
          <p className="text-sm text-rose-500 mt-1">Past saleable freshness</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search batches"
               placeholder="Search batch #, crop, operator or stall..."
               className="flex-1 min-w-[220px] px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm" />
        <select value={cropFilter} onChange={(e) => setCropFilter(e.target.value)} aria-label="Filter by crop" className={selectCls}>
          <option value="ALL">All Crops</option>
          {['EGGPLANT', 'CUCUMBER', 'CARROT'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by freshness" className={selectCls}>
          <option value="ALL">All Status</option>
          <option value="GREEN">Fresh</option>
          <option value="AMBER">At-Risk</option>
          <option value="RED">Rotten</option>
        </select>
        <select value={listedFilter} onChange={(e) => setListedFilter(e.target.value)} aria-label="Filter by marketplace listing" className={selectCls}>
          <option value="ALL">Listed or not</option>
          <option value="LISTED">On marketplace</option>
          <option value="UNLISTED">Not listed</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort batches" className={selectCls}>
          {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {filtersActive && <button type="button" onClick={reset} className="px-3 py-2.5 text-sm font-bold text-emerald-700 hover:underline">Clear</button>}
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-base font-bold text-slate-800">Harvest Batches</h2>
            <p className="text-slate-500 text-xs mt-0.5">{visible.length} of {batches.length} batches • click a batch to see its camera pictures and details</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                <th className="p-4 pl-6">Batch</th>
                <th className="p-4">Operator</th>
                <th className="p-4">Qty / Price</th>
                <th className="p-4">Harvested</th>
                <th className="p-4">Days-to-Spoil</th>
                <th className="p-4">Status</th>
                <th className="p-4">Camera</th>
                <th className="p-4">Stall climate</th>
                <th className="p-4 pr-6">Marketplace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {visible.length === 0 && (
                <tr><td colSpan="9" className="p-10 text-center text-slate-400">
                  {batches.length === 0 ? 'No batches have been registered yet.' : 'No batch matches your search or filters.'}
                </td></tr>
              )}
              {visible.map((row) => {
                const meta = freshnessMeta(row.status);
                return (
                  <tr key={row.id} onClick={() => navigate(`/batches/${row.id}`)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <td className="p-4 pl-6 align-top">
                      <Link to={`/batches/${row.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 group">
                        <span className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl">{cropEmoji(row.crop)}</span>
                        <span>
                          <span className="block font-bold text-slate-800 group-hover:text-emerald-700 group-hover:underline">{titleCase(row.crop)} #{row.id}</span>
                          <span className="block text-xs text-slate-500">{row.node}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="p-4 align-top pt-5">
                      <p className="font-bold text-slate-800">{row.operator}</p>
                      <p className="text-xs text-slate-500">{row.stall ? `Stall ${row.stall}` : 'No stall number'}</p>
                    </td>
                    <td className="p-4 align-top pt-5">
                      <p className="font-bold text-slate-800">{row.qty} kg</p>
                      <p className="text-xs text-slate-500">{row.price != null ? `₱${row.price}/kg` : '—'}</p>
                    </td>
                    <td className="p-4 align-top pt-5">
                      <p className="font-bold text-slate-800">{fmtDate(row.harvest)}</p>
                      <p className="text-xs text-slate-500">{fmtTime(row.harvest)}</p>
                    </td>
                    <td className="p-4 align-top pt-5">
                      <p className={`font-bold ${meta.text}`}>{row.days != null ? `${row.days} days` : '—'}</p>
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                        <div className={`h-full ${meta.bar}`} style={{ width: `${Math.min(100, Math.max(0, ((row.days || 0) / 8) * 100))}%` }}></div>
                      </div>
                    </td>
                    <td className="p-4 align-top pt-5">
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-full whitespace-nowrap ${meta.badge}`}>
                        <span className="mr-1.5">●</span>{meta.label}{row.percent != null ? ` ${row.percent}%` : ''}
                      </span>
                    </td>
                    <td className="p-4 align-top pt-5 whitespace-nowrap" title="Confidence of the ESP32-CAM freshness model over this batch's recent accepted scans">
                      <p className="font-bold text-slate-800">{row.camConf != null ? `${row.camConf}%` : '—'}</p>
                      <p className="text-xs text-slate-500">{row.camConf != null ? 'camera' : 'no scans yet'}</p>
                    </td>
                    <td className="p-4 align-top pt-5 whitespace-nowrap" title={row.sensor.updatedAt ? `Updated ${fmtDateTime(row.sensor.updatedAt)}` : undefined}>
                      <p className="font-bold text-slate-800">
                        {row.sensor.has
                          ? `${row.sensor.temp != null ? `${row.sensor.temp.toFixed(1)}°C` : '—'} · ${row.sensor.rh != null ? `${row.sensor.rh.toFixed(0)}% RH` : '—'}`
                          : '—'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.sensor.has ? `VPD ${row.sensor.vpd != null ? row.sensor.vpd.toFixed(2) : '—'} kPa` : 'No sensor reading yet'}
                      </p>
                    </td>
                    <td className="p-4 pr-6 align-top pt-5">
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${row.listed ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {row.listed ? 'Listed' : 'Not listed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Batches;
