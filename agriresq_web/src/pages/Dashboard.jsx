import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/supabaseApi';
import { cropLabel, deviceApi, isDetected, isSensor, scanBadgeStatus, timeAgo } from '../api/deviceApi';
import { useNow, usePolling } from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';
import { cameraConfidencePct, pairedSensor } from '../lib/format';

const STATUS_LABEL = { GREEN: 'Fresh', AMBER: 'At-Risk', RED: 'Rotten', UNKNOWN: 'Unknown' };

/** Compact camera overview: devices online, last real detection per device, at-risk batches. */
function CameraStatusStrip({ devices, lastDetections, error, atRiskBatches, now }) {
  const online = (devices || []).filter((d) => d.online).length;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-bold text-slate-800">Camera status</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
            {devices ? `${online} of ${devices.length} online` : 'Checking…'}
          </span>
          <span className={`px-2.5 py-1 rounded-full ${atRiskBatches > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
            {atRiskBatches} at-risk batch{atRiskBatches === 1 ? '' : 'es'}
          </span>
          <Link to="/devices" className="text-[#2A6B48] hover:underline">Manage →</Link>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
          Camera backend not reachable ({error}). Batch data below still loads from the database.
        </p>
      )}

      {devices && devices.length === 0 && !error && (
        <p className="text-sm text-slate-500">No camera registered yet. <Link to="/devices" className="text-[#2A6B48] font-bold underline">Open Devices</Link>.</p>
      )}

      <ul className="divide-y divide-slate-100">
        {(devices || []).map((d) => {
          const last = lastDetections[d.id];
          const latest = d.latest_scan;
          const nothingNow = latest && !isDetected(latest);
          return (
            <li key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${d.online ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-label={d.online ? 'online' : 'offline'} />
                <div className="min-w-0">
                  <Link to={`/devices/${d.id}`} className="font-bold text-slate-800 hover:underline truncate block">{d.name}</Link>
                  <p className="text-xs text-slate-400">{cropLabel(d.crop_type)} • seen {timeAgo(d.last_seen, now)}</p>
                </div>
              </div>
              <div className="text-sm text-right flex flex-col items-end gap-1">
                <Link to={`/ai-vision?device=${encodeURIComponent(d.id)}`} className="text-xs font-bold text-[#2A6B48] hover:underline">
                  {d.online ? 'Live view →' : 'Live view (offline) →'}
                </Link>
                {last ? (
                  <span className="flex items-center gap-2 justify-end">
                    <span className="text-slate-600">{cropLabel(last.detected_crop || last.crop_type)}</span>
                    <StatusBadge status={scanBadgeStatus(last)} />
                    <span className="text-xs text-slate-400">{Math.round((Number(last.ml_confidence) || 0) * 100)}% • {timeAgo(last.created_at, now)}</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">No detection yet</span>
                )}
                {nothingNow && <p className="text-[11px] text-slate-400 mt-0.5">Last scan: nothing in view ({timeAgo(latest.created_at, now)})</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const Dashboard = () => {
  const now = useNow(5000);
  const [batches, setBatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [devices, setDevices] = useState(null);
  const [sensorNodes, setSensorNodes] = useState(null);
  const [lastDetections, setLastDetections] = useState({});
  const [deviceError, setDeviceError] = useState('');
  const [profile, setProfile] = useState(null);

  usePolling(async () => {
    try {
      const all = await deviceApi.list();
      const list = all.filter((d) => !isSensor(d)); // camera overview: sensor nodes have no scans
      setSensorNodes(all.filter(isSensor));         // only sensor nodes carry DHT22 readings
      setDevices(list);
      setDeviceError('');
      const entries = await Promise.all(list.map(async (d) => {
        try {
          const [scan] = await deviceApi.scans(d.id, 1, { detected: true });
          return [d.id, scan || null];
        } catch {
          return [d.id, null];
        }
      }));
      setLastDetections(Object.fromEntries(entries));
    } catch (err) {
      setDevices((cur) => cur ?? []);
      setSensorNodes((cur) => cur ?? []);
      setDeviceError(err.message);
    }
  }, 15000);

  useEffect(() => {
    api.me().then(setProfile).catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const result = await api.dashboard();
        const mapped = (result.active_batches || []).map((batch) => {
          const status = batch.freshness_status || 'UNKNOWN';
          const statusColor = status === 'AMBER'
            ? 'bg-amber-100 text-amber-700'
            : status === 'RED'
            ? 'bg-rose-100 text-rose-700'
            : 'bg-emerald-100 text-emerald-700';

          return {
            id: batch.id,
            crop: batch.crop_type || batch.crop || 'Unknown',
            qty: batch.quantity_kg ? `${batch.quantity_kg} kg` : '—',
            operator: batch.profiles?.full_name || 'Unknown operator',
            stall: batch.profiles?.stall_number || '',
            days: batch.predicted_shelf_life != null ? `${batch.predicted_shelf_life} days` : '—',
            status,
            statusColor,
            camConf: cameraConfidencePct(batch),
            sensor: pairedSensor(batch),
          };
        });

        setBatches(mapped);
      } catch (error) {
        console.error("Error loading dashboard data:", error);
        setBatches([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-slate-400 animate-pulse">
        <h2 className="text-xl font-bold text-slate-600 mt-4">Loading Dashboard...</h2>
      </div>
    );
  }

  // Dynamically calculate metrics (batch status codes are GREEN / AMBER / RED)
  const atRiskCount = batches.filter(b => b.status === 'AMBER').length;
  const withReading = (sensorNodes || []).filter((d) => d.latest_reading);
  const avgOf = (key) => (withReading.length
    ? withReading.reduce((sum, d) => sum + Number(d.latest_reading[key]), 0) / withReading.length
    : null);
  const avgTemp = avgOf('temperature_c');
  const avgRh = avgOf('humidity_rh');
  const sensorsOnline = (sensorNodes || []).filter((d) => d.online).length;
  const place = [
    profile?.market_location || 'Bulua Westbound Terminal',
    profile?.role === 'ADMIN' ? 'All stalls' : profile?.stall_number ? `Stall ${profile.stall_number}` : null,
  ].filter(Boolean).join(' • ');

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Dashboard Overview</h1>
        <p className="text-slate-500 text-sm mt-1">{place}</p>
      </div>

      <CameraStatusStrip devices={devices} lastDetections={lastDetections} error={deviceError}
                         atRiskBatches={atRiskCount} now={now} />

      {/* Top Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Active Batches</p>
            <h2 className="text-3xl font-bold text-slate-800">{batches.length}</h2>
          </div>
          <p className="text-sm text-emerald-600 mt-4 font-medium">Across all stalls, not yet rotten</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-rose-200 shadow-sm flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">At-Risk Items</p>
            <h2 className="text-3xl font-bold text-rose-500">{atRiskCount}</h2>
          </div>
          <p className="text-sm text-rose-600 mt-4">{atRiskCount > 0 ? 'Needs attention' : 'Nothing at risk'}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Avg Temp Now</p>
            <h2 className="text-3xl font-bold text-amber-500">{avgTemp != null ? `${avgTemp.toFixed(1)}°` : '—'}</h2>
          </div>
          <p className={`text-sm mt-4 ${avgTemp != null && avgTemp > 30 ? 'text-rose-600' : 'text-amber-600'}`}>
            {avgTemp == null ? 'No sensor readings yet'
              : avgTemp > 30 ? `↑ ${(avgTemp - 30).toFixed(1)}° above threshold` : 'Below 30° alert threshold'}
          </p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Avg Humidity</p>
            <h2 className="text-3xl font-bold text-emerald-600">{avgRh != null ? `${avgRh.toFixed(0)}%` : '—'}</h2>
          </div>
          <p className="text-sm text-slate-500 mt-4">
            {sensorNodes ? `${sensorsOnline} of ${sensorNodes.length} sensor node${sensorNodes.length === 1 ? '' : 's'} online` : 'Checking sensor nodes…'}
          </p>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">Active harvest batches</h2>
          <Link to="/batches" className="text-emerald-600 text-sm font-semibold hover:underline">View all →</Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-400 text-xs font-bold uppercase tracking-wider border-b border-slate-100">
                <th className="p-4 pl-6">Crop</th>
                <th className="p-4">Operator</th>
                <th className="p-4">Qty</th>
                <th className="p-4">Days Left</th>
                <th className="p-4">Camera</th>
                <th className="p-4">Stall climate</th>
                <th className="p-4 pr-6">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {batches.length === 0 && (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400">No active batches yet.</td></tr>
              )}
              {batches.map((batch) => (
                <tr key={batch.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4 pl-6 font-bold text-slate-800">
                    <Link to={`/batches/${batch.id}`} className="hover:text-emerald-700 hover:underline">{batch.crop}</Link>
                    <span className="block text-xs text-slate-400 font-normal">Batch {batch.id}</span>
                  </td>
                  <td className="p-4 text-slate-700">
                    {batch.operator}
                    {batch.stall && <span className="block text-xs text-slate-400">Stall {batch.stall}</span>}
                  </td>
                  <td className="p-4 font-semibold text-slate-700">{batch.qty}</td>
                  <td className="p-4 font-bold text-slate-800">{batch.days}</td>
                  <td className="p-4 text-xs font-semibold text-slate-600 whitespace-nowrap" title="Confidence of the ESP32-CAM freshness model over recent scans">
                    {batch.camConf != null ? `${batch.camConf}% conf.` : <span className="font-medium text-slate-400">No scans yet</span>}
                  </td>
                  <td className="p-4 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    {batch.sensor.has
                      ? `${batch.sensor.temp != null ? `${batch.sensor.temp.toFixed(1)}°C` : '—'} · ${batch.sensor.rh != null ? `${batch.sensor.rh.toFixed(0)}% RH` : '—'}`
                      : <span className="font-medium text-slate-400">No reading yet</span>}
                  </td>
                  <td className="p-4 pr-6">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${batch.statusColor}`}>
                      ● {STATUS_LABEL[batch.status] || batch.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
