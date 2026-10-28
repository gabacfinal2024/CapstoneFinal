import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/supabaseApi';
import { adminCancelListing, adminListBatch } from '../api/dealsApi';
import { batchPhotos, photoSrc } from '../api/batchPhotosApi';
import Modal from '../components/Modal';
import FreshnessAnalysisCard from '../components/FreshnessAnalysisCard';
import ReadingsChart from '../components/ReadingsChart';
import { cropEmoji, daysUntil, fixedOrDash, fmtDate, fmtDateTime, freshnessMeta, peso, titleCase } from '../lib/format';

const selectCls = 'px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 outline-none focus:border-emerald-500';

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

/** Raw DHT22 readings logged for this batch (admin / operator only), below the freshness analysis. */
function SensorHistoryCard({ log }) {
  const rows = log.rows || [];
  const chartRows = rows.map((r) => ({ ...r, created_at: r.recorded_at, vpd_kpa: r.vpd_value }));
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
          Sensor history{rows.length ? ` (last ${rows.length} logged readings)` : ''}
        </p>
        {log.loading && <p className="text-sm text-slate-400 animate-pulse py-6 text-center">Loading sensor history…</p>}
        {log.error && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3">Sensor history is unavailable: {log.error}</p>}
        {!log.loading && !log.error && rows.length === 0 && (
          <p className="text-sm text-slate-400 py-4 text-center">No sensor history logged for this batch yet. A row is saved about every 5 minutes while a DHT22 reports.</p>
        )}
        {rows.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="min-h-48">
              {rows.length < 2
                ? <p className="text-sm text-slate-400 h-48 flex items-center justify-center">Need at least two logged readings to draw a trend.</p>
                : <ReadingsChart readings={chartRows} />}
            </div>
            <div className="max-h-60 overflow-auto rounded-xl border border-slate-100">
              <table className="w-full text-sm text-left">
                <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="p-2 pl-3 font-bold">Time</th>
                    <th scope="col" className="p-2 font-bold text-right">Temp</th>
                    <th scope="col" className="p-2 font-bold text-right">RH</th>
                    <th scope="col" className="p-2 pr-3 font-bold text-right">VPD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.recorded_at}>
                      <td className="p-2 pl-3 text-slate-600 whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
                      <td className="p-2 text-right font-semibold text-slate-800">{fixedOrDash(r.temperature_c, 1)}°C</td>
                      <td className="p-2 text-right font-semibold text-slate-800">{fixedOrDash(r.humidity_rh, 0)}%</td>
                      <td className="p-2 pr-3 text-right font-semibold text-slate-800">{fixedOrDash(r.vpd_value, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const stateText = (scan) => {
  if (!scan) return '—';
  if (scan.detected === false || scan.state === 'none') return 'Nothing detected';
  return titleCase(scan.state || scan.freshness_status);
};
const pctText = (v) => (v == null || v === '' ? null : `${Math.round(Number(v) <= 1 ? Number(v) * 100 : Number(v))}%`);

/** Normalised gallery entries: the listing photo first, then the camera scans (newest first). */
function buildPictures(product, scans) {
  const pictures = [];
  if (product?.image_url) {
    pictures.push({ key: 'listing', src: product.image_url, kind: 'listing', title: 'Listing photo', time: product.created_at });
  }
  for (const scan of scans) {
    const src = photoSrc(scan);
    if (src) pictures.push({ key: `scan-${scan.id}`, src, kind: 'scan', scan, time: scan.created_at });
  }
  return pictures;
}

function PictureDetails({ pic, large = false }) {
  const s = pic.scan;
  const size = large ? 'text-sm' : 'text-xs';
  if (pic.kind === 'listing') {
    return (
      <div className={`${size} text-slate-600`}>
        <p className="font-bold text-slate-800">{pic.title}</p>
        <p>Uploaded {fmtDateTime(pic.time)}</p>
      </div>
    );
  }
  const crop = s.detected_crop ? titleCase(s.detected_crop) : null;
  const conf = pctText(s.ml_confidence);
  return (
    <div className={`${size} text-slate-600 space-y-0.5`}>
      <p className="font-bold text-slate-800">{fmtDateTime(pic.time)}</p>
      <p>
        {crop ? `${cropEmoji(crop)} ${crop} · ` : ''}{stateText(s)}{conf ? ` · ${conf} confidence` : ''}
      </p>
      {s.days_to_spoil != null && <p>{Number(s.days_to_spoil).toFixed(1)} days to spoil{s.freshness_percent != null ? ` · ${s.freshness_percent}% fresh` : ''}</p>}
      {(s.device_name || s.device_ip) && <p className="text-slate-400">{s.device_name || 'Camera'}{s.device_ip ? ` (${s.device_ip})` : ''}</p>}
      {large && s.message && <p className="text-slate-500">{s.message}</p>}
    </div>
  );
}

function Lightbox({ pictures, index, onClose, onIndex }) {
  const pic = pictures[index];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') onIndex((index - 1 + pictures.length) % pictures.length);
      if (e.key === 'ArrowRight') onIndex((index + 1) % pictures.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, pictures.length, onIndex]);

  return (
    <Modal title={pic.kind === 'listing' ? 'Listing photo' : fmtDateTime(pic.time)} onClose={onClose} wide label="Batch picture">
      <img src={pic.src} alt={pic.kind === 'listing' ? 'Batch listing photo' : `Camera picture taken ${fmtDateTime(pic.time)}`} className="w-full max-h-[60vh] object-contain rounded-xl bg-slate-100" />
      <div className="mt-4 flex items-start justify-between gap-4">
        <PictureDetails pic={pic} large />
        {pictures.length > 1 && (
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => onIndex((index - 1 + pictures.length) % pictures.length)} aria-label="Previous picture" className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50">←</button>
            <span className="text-xs text-slate-500">{index + 1} / {pictures.length}</span>
            <button type="button" onClick={() => onIndex((index + 1) % pictures.length)} aria-label="Next picture" className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50">→</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function BatchDetail() {
  const { id } = useParams();
  return <BatchDetailView key={id} id={id} />;
}

function BatchDetailView({ id }) {
  const [state, setState] = useState({ loading: true, error: '', product: null, listing: null });
  const [history, setHistory] = useState([]);
  const [sensorLog, setSensorLog] = useState({ loading: true, error: '', rows: [] });
  const [scans, setScans] = useState([]);
  const [photosState, setPhotosState] = useState({ loading: true, error: '' });
  const [lightbox, setLightbox] = useState(null);

  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const loadBatch = useCallback(async () => {
    try {
      const { product, listing } = await api.batch(id);
      setState({ loading: false, error: product ? '' : 'Batch not found.', product, listing });
    } catch (err) {
      setState({ loading: false, error: err.message, product: null, listing: null });
    }
  }, [id]);

  useEffect(() => {
    // loadBatch() only sets state after its awaited request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBatch();

    let alive = true;
    api.batchHistory(id).then((rows) => { if (alive) setHistory(rows); }).catch(() => {});
    api.sensorHistory(id, 50)
      .then((rows) => { if (alive) setSensorLog({ loading: false, error: '', rows }); })
      .catch((err) => { if (alive) setSensorLog({ loading: false, error: err.message, rows: [] }); });
    batchPhotos(id)
      .then((list) => { if (alive) { setScans(list); setPhotosState({ loading: false, error: '' }); } })
      .catch((err) => { if (alive) setPhotosState({ loading: false, error: err.message }); });
    return () => { alive = false; };
  }, [id, loadBatch]);

  const { product, listing } = state;
  const listingActive = !!listing && listing.listing_status === 'ACTIVE' && daysUntil(listing.expires_at) > 0;
  const listingSold = listing?.listing_status === 'SOLD';

  const doList = async () => {
    setBusy(true);
    setActionError('');
    try {
      await adminListBatch(Number(id), Number(days));
      setNotice('Batch listed on the marketplace.');
      await loadBatch();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true);
    setActionError('');
    try {
      await adminCancelListing(listing.id);
      setNotice('Listing cancelled.');
      setConfirmCancel(false);
      await loadBatch();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) {
    return <div className="flex items-center justify-center h-[60vh] text-slate-400 animate-pulse font-bold">Loading batch…</div>;
  }

  if (state.error || !product) {
    return (
      <div className="space-y-4">
        <Link to="/batches" className="text-sm font-bold text-emerald-700 hover:underline">← All batches</Link>
        <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">{state.error || 'Batch not found.'}</div>
      </div>
    );
  }

  const meta = freshnessMeta(product.freshness_status);
  const pictures = buildPictures(product, scans);
  const operator = product.profiles || {};
  const harvested = product.harvest_datetime || product.created_at;
  const canList = product.freshness_status !== 'RED' && !listingActive && !listingSold;

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <Link to="/batches" className="text-sm font-bold text-emerald-700 hover:underline">← All batches</Link>

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-3xl">{cropEmoji(product.crop_type)}</div>
          <div>
            <h1 className="text-3xl font-bold text-slate-800">{titleCase(product.crop_type)} · Batch #{product.id}</h1>
            <p className="text-slate-500 text-sm mt-1">
              {operator.full_name || 'Unknown operator'}{operator.stall_number ? ` · Stall ${operator.stall_number}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${meta.badge}`}>● {meta.label}{product.freshness_percent != null ? ` · ${product.freshness_percent}%` : ''}</span>
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${listingActive ? 'bg-blue-50 text-blue-700' : listingSold ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {listingActive ? 'On marketplace' : listingSold ? 'Sold' : 'Not listed'}
          </span>
        </div>
      </div>

      {notice && (
        <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm flex justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="font-bold">✕</button>
        </div>
      )}

      {/* Batch info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-base font-bold text-slate-800 mb-5">Batch information</h2>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-5">
            <Field label="Crop">{titleCase(product.crop_type)}</Field>
            <Field label="Quantity">{product.quantity_kg} kg</Field>
            <Field label="Harvested">{fmtDateTime(harvested)}</Field>
            <Field label="Base price">{peso(product.base_price_per_kg, 2)}/kg</Field>
            <Field label="Current price">{peso(product.current_price_per_kg, 2)}/kg</Field>
            <Field label="Discount">{Number(product.discount_percent) || 0}%{product.auto_discount_enabled ? ' (auto)' : ''}</Field>
            <Field label="Freshness">
              <span className={meta.text}>{meta.label}{product.freshness_percent != null ? ` · ${product.freshness_percent}%` : ''}</span>
            </Field>
            <Field label="Predicted shelf life">
              <span className={meta.text}>{product.predicted_shelf_life != null ? `${product.predicted_shelf_life} days left` : '—'}</span>
            </Field>
            <Field label="Camera confidence (combined)">{pctText(product.ml_confidence) || '—'}</Field>
            <Field label="Operator">{operator.full_name || '—'}</Field>
            <Field label="Stall">{operator.stall_number ? `Stall ${operator.stall_number}` : '—'}</Field>
            <Field label="Pickup location">{product.pickup_location || '—'}</Field>
            <Field label="Registered">{fmtDate(product.created_at)}</Field>
            <Field label="Sensor node">{product.iot_node_id ? `Node ${product.iot_node_id}` : 'None'}</Field>
          </dl>
          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Notes</p>
            <p className="text-sm text-slate-700 whitespace-pre-line">{product.notes || 'No notes.'}</p>
          </div>
        </div>

        {/* Marketplace actions */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-fit">
          <h2 className="text-base font-bold text-slate-800 mb-1">Marketplace</h2>
          {listingActive ? (
            <>
              <p className="text-sm text-slate-500 mb-4">Listed for {peso(listing.listed_price, 2)}
                {listing.original_price ? ` (was ${peso(listing.original_price, 2)})` : ''}. Ends {fmtDateTime(listing.expires_at)}.</p>
              <button type="button" onClick={() => { setActionError(''); setConfirmCancel(true); }} disabled={busy}
                      className="w-full py-2.5 bg-white border border-rose-200 rounded-lg text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                Cancel listing
              </button>
            </>
          ) : listingSold ? (
            <p className="text-sm text-slate-500">This batch was sold through the rescue marketplace. See the Marketplace page for the buyer and seller.</p>
          ) : canList ? (
            <>
              <p className="text-sm text-slate-500 mb-4">Not on the marketplace. List it for rescue buyers on behalf of {operator.full_name || 'its operator'}.</p>
              <div className="flex items-center gap-2 mb-3">
                <label htmlFor="list-days" className="text-sm text-slate-600">Listed for</label>
                <select id="list-days" value={days} onChange={(e) => setDays(e.target.value)} className={selectCls}>
                  {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>)}
                </select>
              </div>
              <button type="button" onClick={doList} disabled={busy} className="w-full py-2.5 bg-[#2A6B48] text-white rounded-lg text-sm font-bold hover:bg-[#1f5035] disabled:opacity-50">
                {busy ? 'Listing…' : 'List on marketplace'}
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-500">{product.freshness_status === 'RED' ? 'This batch is rotten and cannot be listed.' : 'This batch cannot be listed.'}</p>
          )}
          {actionError && !confirmCancel && <p role="alert" className="text-sm text-rose-600 mt-3">{actionError}</p>}
        </div>
      </div>

      <FreshnessAnalysisCard productId={id} />

      <SensorHistoryCard log={sensorLog} />

      {/* Photo gallery */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2 className="text-base font-bold text-slate-800">Pictures</h2>
          <span className="text-xs text-slate-400">{pictures.length} picture{pictures.length === 1 ? '' : 's'} · newest camera picture first</span>
        </div>
        <p className="text-xs text-slate-500 mb-5">Listing photo and every picture the ESP32-CAM took of this batch. Click a picture to enlarge it.</p>

        {photosState.loading && <p className="text-sm text-slate-400 animate-pulse py-8 text-center">Loading camera pictures…</p>}
        {photosState.error && (
          <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
            Camera pictures are unavailable: {photosState.error}
          </p>
        )}
        {!photosState.loading && !photosState.error && scans.length === 0 && (
          <p className="text-sm text-slate-400 py-4 text-center">No camera pictures for this batch yet.</p>
        )}

        {pictures.length > 0 && (
          <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {pictures.map((pic, i) => (
              <li key={pic.key} className="border border-slate-100 rounded-xl overflow-hidden bg-slate-50">
                <button type="button" onClick={() => setLightbox(i)} aria-label={`Enlarge picture ${i + 1}`} className="block w-full aspect-[4/3] bg-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <img src={pic.src} alt={pic.kind === 'listing' ? 'Batch listing photo' : `Camera picture taken ${fmtDateTime(pic.time)}`} loading="lazy" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
                </button>
                <div className="p-3"><PictureDetails pic={pic} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Freshness history */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Freshness history</h2>
          <p className="text-xs text-slate-500 mt-0.5">Every freshness prediction recorded for this batch</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-400 text-xs font-bold uppercase tracking-wider border-b border-slate-100 bg-slate-50/50">
                <th className="p-4 pl-6">Time</th>
                <th className="p-4">Status</th>
                <th className="p-4">Freshness</th>
                <th className="p-4 pr-6">Days to spoil</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.length === 0 && <tr><td colSpan="4" className="p-6 text-center text-slate-400">No freshness history recorded yet.</td></tr>}
              {history.map((h) => {
                const m = freshnessMeta(h.predicted_status);
                return (
                  <tr key={h.id}>
                    <td className="p-4 pl-6 text-slate-700">{fmtDateTime(h.created_at)}</td>
                    <td className="p-4"><span className={`px-2.5 py-1 text-xs font-bold rounded-full ${m.badge}`}>{m.label}</span></td>
                    <td className="p-4 text-slate-700">{h.freshness_percent != null ? `${h.freshness_percent}%` : '—'}</td>
                    <td className="p-4 pr-6 font-bold text-slate-800">{Number(h.days_to_spoil).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {lightbox != null && pictures[lightbox] && (
        <Lightbox pictures={pictures} index={lightbox} onClose={() => setLightbox(null)} onIndex={setLightbox} />
      )}

      {confirmCancel && (
        <Modal
          title="Cancel this listing?"
          onClose={busy ? undefined : () => setConfirmCancel(false)}
          footer={(
            <>
              <button type="button" onClick={() => setConfirmCancel(false)} disabled={busy} className="px-5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Keep listing</button>
              <button type="button" onClick={doCancel} disabled={busy} className="px-5 py-2.5 bg-rose-600 text-white rounded-lg text-sm font-bold hover:bg-rose-700 disabled:opacity-50">{busy ? 'Cancelling…' : 'Cancel listing'}</button>
            </>
          )}
        >
          <p className="text-sm text-slate-600">Batch #{product.id} will be removed from the marketplace. Buyers will no longer see it.</p>
          {actionError && <p role="alert" className="text-sm text-rose-600 mt-3">{actionError}</p>}
        </Modal>
      )}
    </div>
  );
}
