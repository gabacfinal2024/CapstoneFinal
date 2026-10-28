import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/supabaseApi';
import { adminCancelListing, adminListBatch, buyerCount, dealHistory, listableBatches } from '../api/dealsApi';
import Modal from '../components/Modal';
import PairedSensorRow from '../components/PairedSensorRow';
import { buyerTypeLabel, cropEmoji, daysUntil, fmtDate, fmtTime, freshnessMeta, isToday, peso, titleCase } from '../lib/format';

const selectCls = 'px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white font-medium text-slate-700 shadow-sm outline-none focus:border-emerald-500';
const inputCls = 'px-4 py-2.5 rounded-xl border border-slate-200 text-sm shadow-sm focus:outline-none focus:border-emerald-500 bg-white';

const CROP_OPTIONS = ['EGGPLANT', 'CUCUMBER', 'CARROT'];
const PERIODS = [
  ['ALL', 'All time'],
  ['TODAY', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
];
const LISTING_SORTS = [
  ['URGENCY', 'Sort: Urgency'],
  ['NEWEST', 'Sort: Newest'],
  ['PRICE_DESC', 'Sort: Price (high to low)'],
  ['QTY_DESC', 'Sort: Quantity'],
];
const DEALS_PAGE = 10;
const withinDays = (iso, days) => Date.now() - new Date(iso).getTime() <= days * 86400000;

const mapListing = (item) => {
  const product = item.products || {};
  const seller = product.profiles || item.profiles || {};
  const qty = Number(product.quantity_kg) || 0;
  const total = Number(item.listed_price) || 0;
  const isAtRisk = product.freshness_status === 'AMBER' || product.freshness_status === 'RED';
  return {
    listingId: item.id,
    productId: item.product_id || product.id,
    crop: product.crop_type || 'Unknown',
    qty,
    total,
    perKg: qty > 0 ? total / qty : null,
    discount: Number(item.discount_percent) || 0,
    days: product.predicted_shelf_life != null ? Number(product.predicted_shelf_life) : null,
    expiresIn: daysUntil(item.expires_at),
    createdAt: item.created_at,
    operator: seller.full_name || 'Unknown operator',
    stall: seller.stall_number || '',
    freshness: product.freshness_status,
    isAtRisk,
    product,
  };
};

function Stat({ label, value, note, valueClass }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <h2 className={`text-4xl font-bold mb-1 ${valueClass}`}>{value}</h2>
      <p className="text-xs text-slate-500 font-medium">{note}</p>
    </div>
  );
}

/** Pick any batch that is not listed yet and put it on the marketplace on behalf of its operator. */
function NewListingModal({ onClose, onDone }) {
  const [batches, setBatches] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    listableBatches()
      .then((list) => { if (alive) setBatches(list); })
      .catch((err) => { if (alive) { setLoadError(err.message); setBatches([]); } });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (batches || []).filter((p) => !term
      || [p.id, p.crop_type, p.profiles?.full_name, p.profiles?.stall_number].some((v) => String(v ?? '').toLowerCase().includes(term)));
  }, [batches, q]);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await adminListBatch(selected, Number(days));
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New marketplace listing"
      onClose={busy ? undefined : onClose}
      wide
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className="px-5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={!selected || busy} className="px-5 py-2.5 bg-[#2A6B48] text-white rounded-lg text-sm font-bold hover:bg-[#1f5035] disabled:opacity-50">
            {busy ? 'Listing…' : 'List batch'}
          </button>
        </>
      )}
    >
      <p className="text-sm text-slate-500 mb-4">Choose a batch that is not on the marketplace yet. It is listed at its current price on behalf of its stall operator.</p>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search batch, crop, operator, stall…" aria-label="Search batches" className={`${inputCls} flex-1 min-w-[200px]`} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Listed for
          <select value={days} onChange={(e) => setDays(e.target.value)} className={selectCls} aria-label="Listing duration">
            {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>)}
          </select>
        </label>
      </div>

      {loadError && <p role="alert" className="text-sm text-rose-600 mb-3">Could not load batches: {loadError}</p>}
      {batches === null && <p className="text-sm text-slate-400 animate-pulse py-6 text-center">Loading batches…</p>}
      {batches && !loadError && shown.length === 0 && (
        <p className="text-sm text-slate-400 py-6 text-center">{batches.length === 0 ? 'Every eligible batch is already listed.' : 'No batch matches your search.'}</p>
      )}

      <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden" role="radiogroup" aria-label="Batches that can be listed">
        {shown.map((p) => {
          const meta = freshnessMeta(p.freshness_status);
          return (
            <li key={p.id}>
              <label className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50 ${selected === p.id ? 'bg-emerald-50' : ''}`}>
                <input type="radio" name="batch" checked={selected === p.id} onChange={() => setSelected(p.id)} className="accent-emerald-600" />
                <span className="text-2xl">{cropEmoji(p.crop_type)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-slate-800 text-sm">{titleCase(p.crop_type)} · Batch #{p.id}</span>
                  <span className="block text-xs text-slate-500 truncate">
                    {p.profiles?.full_name || 'Unknown operator'}{p.profiles?.stall_number ? ` · Stall ${p.profiles.stall_number}` : ''} · {p.quantity_kg} kg · {peso(p.current_price_per_kg, 2)}/kg
                  </span>
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${meta.badge}`}>{meta.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-rose-600 mt-3">{error}</p>}
    </Modal>
  );
}

const Marketplace = () => {
  const [listings, setListings] = useState([]);
  const [deals, setDeals] = useState([]);
  const [buyers, setBuyers] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dealsError, setDealsError] = useState('');

  const [q, setQ] = useState('');
  const [cropFilter, setCropFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sort, setSort] = useState('URGENCY');

  const [dealQ, setDealQ] = useState('');
  const [dealCrop, setDealCrop] = useState('ALL');
  const [dealOperator, setDealOperator] = useState('ALL');
  const [dealPeriod, setDealPeriod] = useState('ALL');
  const [dealLimit, setDealLimit] = useState(DEALS_PAGE);

  const [showNew, setShowNew] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [listRes, dealRes, buyerRes] = await Promise.allSettled([api.marketplace(), dealHistory(), buyerCount()]);
    if (listRes.status === 'fulfilled') {
      setListings((listRes.value || []).map(mapListing));
      setLoadError('');
    } else {
      console.error('Error fetching marketplace listings:', listRes.reason);
      setLoadError(listRes.reason?.message || 'Could not load listings.');
    }
    if (dealRes.status === 'fulfilled') {
      setDeals(dealRes.value);
      setDealsError('');
    } else {
      setDeals([]);
      setDealsError(dealRes.reason?.message || 'Could not load completed deals.');
    }
    setBuyers(buyerRes.status === 'fulfilled' ? buyerRes.value : null);
    setIsLoading(false);
  }, []);

  // refresh() only sets state after its awaited requests resolve.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  const visibleListings = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = listings.filter((l) => {
      if (cropFilter !== 'ALL' && l.crop !== cropFilter) return false;
      if (statusFilter === 'FRESH' && l.isAtRisk) return false;
      if (statusFilter === 'AT_RISK' && !l.isAtRisk) return false;
      if (!term) return true;
      return [l.crop, l.operator, l.stall, `batch ${l.productId}`, l.productId].some((v) => String(v ?? '').toLowerCase().includes(term));
    });
    const byDays = (a, b) => (a.days ?? 999) - (b.days ?? 999);
    const sorters = {
      URGENCY: byDays,
      NEWEST: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      PRICE_DESC: (a, b) => b.total - a.total,
      QTY_DESC: (a, b) => b.qty - a.qty,
    };
    return list.slice().sort(sorters[sort]);
  }, [listings, q, cropFilter, statusFilter, sort]);

  const operatorOptions = useMemo(() => {
    const seen = new Map();
    deals.forEach((d) => { if (d.operator_id && !seen.has(d.operator_id)) seen.set(d.operator_id, d.operator_name || d.operator_email || 'Unknown operator'); });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [deals]);

  const visibleDeals = useMemo(() => {
    const term = dealQ.trim().toLowerCase();
    return deals.filter((d) => {
      if (dealCrop !== 'ALL' && d.crop_type !== dealCrop) return false;
      if (dealOperator !== 'ALL' && d.operator_id !== dealOperator) return false;
      if (dealPeriod === 'TODAY' && !isToday(d.completed_at)) return false;
      if (dealPeriod !== 'ALL' && dealPeriod !== 'TODAY' && !withinDays(d.completed_at, Number(dealPeriod))) return false;
      if (!term) return true;
      return [d.operator_name, d.operator_email, d.stall_number, d.buyer_name, d.buyer_email, d.crop_type, d.product_id]
        .some((v) => String(v ?? '').toLowerCase().includes(term));
    });
  }, [deals, dealQ, dealCrop, dealOperator, dealPeriod]);

  const dealsTotal = visibleDeals.reduce((sum, d) => sum + d.total, 0);
  const dealsKg = visibleDeals.reduce((sum, d) => sum + d.quantity_kg, 0);
  const dealFiltersActive = dealQ || dealCrop !== 'ALL' || dealOperator !== 'ALL' || dealPeriod !== 'ALL';
  const resetDealFilters = () => { setDealQ(''); setDealCrop('ALL'); setDealOperator('ALL'); setDealPeriod('ALL'); setDealLimit(DEALS_PAGE); };

  const atRisk = listings.filter((l) => l.isAtRisk);
  const atRiskValue = atRisk.reduce((sum, l) => sum + l.total, 0);
  const dealsToday = deals.filter((d) => isToday(d.completed_at));
  const soldValue = deals.reduce((sum, d) => sum + d.total, 0);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setActionError('');
    try {
      await adminCancelListing(cancelTarget.listingId);
      setNotice(`Listing for ${titleCase(cancelTarget.crop)} batch #${cancelTarget.productId} was cancelled.`);
      setCancelTarget(null);
      await refresh();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setCancelBusy(false);
    }
  };

  const onListed = async () => {
    setShowNew(false);
    setNotice('Batch listed on the marketplace.');
    await refresh();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-slate-400 animate-pulse">
        <span className="text-4xl block mb-4">🛒</span>
        <h2 className="text-xl font-bold text-slate-600">Connecting to Marketplace...</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      {/* Header section */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Rescue Marketplace</h1>
          <p className="text-slate-500 text-sm mt-1">Freshness-verified surplus listings from every stall - Bulua WBIT - Live Data</p>
        </div>
        <button type="button" onClick={() => { setActionError(''); setShowNew(true); }} className="px-5 py-2.5 bg-[#2A6B48] text-white rounded-lg text-sm font-bold hover:bg-[#1f5035] shadow-sm transition-colors">
          + New listing
        </button>
      </div>

      {notice && (
        <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm flex justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="font-bold">✕</button>
        </div>
      )}
      {loadError && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">Could not load listings: {loadError}</div>}

      {/* Flash Deals Banner */}
      <div className="bg-[#2A6B48] rounded-2xl p-6 flex flex-col md:flex-row justify-between items-center text-white shadow-md gap-4">
        <div>
          <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
            🔥 {atRisk.length} Flash Rescue Deal{atRisk.length === 1 ? '' : 's'} Active
          </h2>
          <p className="text-sm text-emerald-100/90 max-w-lg">
            {atRisk.length === 0
              ? 'No at-risk produce is listed right now.'
              : `${atRisk.slice(0, 4).map((l) => `${titleCase(l.crop)} #${l.productId}`).join(', ')}${atRisk.length > 4 ? ` and ${atRisk.length - 4} more` : ''} ${atRisk.length === 1 ? 'is' : 'are'} At-Risk and listed for immediate rescue buyers.`}
          </p>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <div className="bg-white/10 rounded-xl px-5 py-3 text-center flex-1 md:flex-none">
            <span className="block text-2xl font-bold">{atRisk.length}</span>
            <span className="text-xs text-emerald-100">At-Risk listed</span>
          </div>
          <div className="bg-white/10 rounded-xl px-5 py-3 text-center flex-1 md:flex-none">
            <span className="block text-2xl font-bold">{peso(atRiskValue)}</span>
            <span className="text-xs text-emerald-100">Total rescue value</span>
          </div>
          <div className="bg-white/10 rounded-xl px-5 py-3 text-center flex-1 md:flex-none">
            <span className="block text-2xl font-bold">{dealsError ? '—' : dealsToday.length}</span>
            <span className="text-xs text-emerald-100">Rescued today</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid auto-rows-fr grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Total Listings" value={listings.length} note="Active in marketplace" valueClass="text-emerald-600" />
        <Stat label="At-Risk Listings" value={atRisk.length} note="Flash rescue deals" valueClass="text-amber-500" />
        <Stat label="Deals Completed" value={dealsError ? '—' : deals.length} valueClass="text-blue-600"
              note={dealsError ? 'Deal history unavailable' : <><span className="font-bold text-slate-700">{peso(soldValue)}</span> rescued value</>} />
        <Stat label="Registered Buyers" value={buyers ?? '—'} note="Rescue buyer accounts" valueClass="text-slate-800" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search crop, batch, operator or stall..." aria-label="Search listings" className={`${inputCls} flex-1 min-w-[200px]`} />
        <select value={cropFilter} onChange={(e) => setCropFilter(e.target.value)} aria-label="Filter by crop" className={selectCls}>
          <option value="ALL">All Crops</option>
          {CROP_OPTIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by freshness" className={selectCls}>
          <option value="ALL">All Status</option>
          <option value="FRESH">Fresh</option>
          <option value="AT_RISK">At-Risk</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort listings" className={selectCls}>
          {LISTING_SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>

      {/* Listings Grid */}
      {visibleListings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400 text-sm">
          {listings.length === 0 ? 'No active listings right now. Use “New listing” to put a batch on the marketplace.' : 'No listing matches your search or filters.'}
        </div>
      ) : (
        <div className="grid auto-rows-fr grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {visibleListings.map((item) => {
            const meta = freshnessMeta(item.freshness);
            return (
              <div key={item.listingId} className={`h-full bg-white rounded-2xl border-2 p-5 shadow-sm flex flex-col ${item.isAtRisk ? 'border-amber-200' : 'border-slate-100'}`}>
                <div className="flex justify-between items-start mb-5 gap-2">
                  <div className="flex gap-3 min-w-0">
                    <div className="w-12 h-12 shrink-0 bg-slate-50 rounded-full flex items-center justify-center text-2xl border border-slate-100 shadow-sm">
                      {cropEmoji(item.crop)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-800 text-lg leading-tight">{titleCase(item.crop)}</h3>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">Batch #{item.productId} · {item.stall ? `Stall ${item.stall}` : item.operator}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 shrink-0 ${item.isAtRisk ? 'bg-amber-100 text-amber-700' : meta.badge}`}>
                    <span className="text-[10px]">●</span> {item.isAtRisk ? 'At-Risk' : 'Fresh'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-4 mb-5 text-sm">
                  <div>
                    <p className="text-slate-500 mb-1 text-xs">Quantity</p>
                    <p className="font-bold text-slate-800">{item.qty ? `${item.qty} kg` : '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500 mb-1 text-xs">Days-to-Spoil</p>
                    <p className="font-bold text-slate-800">{item.days != null ? `${item.days} days` : '—'}</p>
                  </div>

                  <div className="col-span-2 border-t border-slate-100 my-1"></div>

                  <div>
                    <p className="text-slate-500 mb-1 text-xs">Operator</p>
                    <p className="font-bold text-slate-800 truncate">{item.operator}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500 mb-1 text-xs">{item.isAtRisk ? 'Rescue price' : 'Listed price'}</p>
                    <p className="font-bold text-[#2A6B48] text-lg leading-none">{peso(item.total, 2)}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{item.perKg != null ? `${peso(item.perKg, 2)}/kg` : ''}{item.discount ? ` · ${item.discount}% off` : ''}</p>
                  </div>

                  <div>
                    <p className="text-slate-500 text-xs">Listing ends</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-700 text-xs">
                      {item.expiresIn == null ? '—' : item.expiresIn < 1 ? 'in under a day' : `in ${Math.floor(item.expiresIn)} day${Math.floor(item.expiresIn) === 1 ? '' : 's'}`}
                    </p>
                  </div>
                </div>

                <PairedSensorRow row={item.product} className="mb-5" />

                <div className="mt-auto flex gap-3">
                  <Link to={`/batches/${item.productId}`} className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white text-center transition-colors bg-[#2A6B48] hover:bg-[#1f5035]">
                    View batch
                  </Link>
                  <button type="button" onClick={() => { setActionError(''); setCancelTarget(item); }} className="flex-1 py-2.5 bg-white border border-rose-200 rounded-lg text-sm font-bold text-rose-600 hover:bg-rose-50 transition-colors">
                    Cancel listing
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Completed deals */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">Completed Rescue Deals</h2>
          <p className="text-xs text-slate-500 mt-0.5">Sold produce with the stall operator who sold it and the rescue buyer who bought it</p>
        </div>

        {dealsError ? (
          <p role="alert" className="p-6 text-sm text-amber-800 bg-amber-50">{dealsError}</p>
        ) : (
          <>
            <div className="p-5 border-b border-slate-100 flex flex-wrap gap-3">
              <input type="search" value={dealQ} onChange={(e) => { setDealQ(e.target.value); setDealLimit(DEALS_PAGE); }} placeholder="Search operator, buyer, crop..." aria-label="Search deals" className={`${inputCls} flex-1 min-w-[200px]`} />
              <select value={dealCrop} onChange={(e) => { setDealCrop(e.target.value); setDealLimit(DEALS_PAGE); }} aria-label="Filter deals by crop" className={selectCls}>
                <option value="ALL">All Crops</option>
                {CROP_OPTIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
              </select>
              <select value={dealOperator} onChange={(e) => { setDealOperator(e.target.value); setDealLimit(DEALS_PAGE); }} aria-label="Filter deals by operator" className={selectCls}>
                <option value="ALL">All Operators</option>
                {operatorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select value={dealPeriod} onChange={(e) => { setDealPeriod(e.target.value); setDealLimit(DEALS_PAGE); }} aria-label="Filter deals by period" className={selectCls}>
                {PERIODS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              {dealFiltersActive && (
                <button type="button" onClick={resetDealFilters} className="px-4 py-2.5 text-sm font-bold text-[#2A6B48] hover:underline">Clear filters</button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs font-bold uppercase tracking-wider border-b border-slate-100">
                    <th className="p-5 pl-6 font-semibold">Date</th>
                    <th className="p-5 font-semibold">Crop / Batch</th>
                    <th className="p-5 font-semibold">Qty</th>
                    <th className="p-5 font-semibold">Total</th>
                    <th className="p-5 font-semibold">Stall operator (seller)</th>
                    <th className="p-5 pr-6 font-semibold">Rescue buyer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleDeals.length === 0 && (
                    <tr><td colSpan="6" className="p-8 text-center text-slate-400">
                      {deals.length === 0 ? 'No completed deals yet.' : 'No deal matches your search or filters.'}
                    </td></tr>
                  )}
                  {visibleDeals.slice(0, dealLimit).map((d) => (
                    <tr key={d.thread_id} className="hover:bg-slate-50/50 transition-colors align-top">
                      <td className="p-5 pl-6">
                        <p className="font-bold text-slate-800">{fmtDate(d.completed_at)}</p>
                        <p className="text-xs text-slate-500">{fmtTime(d.completed_at)}</p>
                      </td>
                      <td className="p-5">
                        <p className="font-bold text-slate-800">{cropEmoji(d.crop_type)} {titleCase(d.crop_type)}</p>
                        <Link to={`/batches/${d.product_id}`} className="text-xs text-[#2A6B48] hover:underline">Batch #{d.product_id}</Link>
                      </td>
                      <td className="p-5 font-semibold text-slate-700 whitespace-nowrap">{d.quantity_kg} kg</td>
                      <td className="p-5 whitespace-nowrap">
                        <p className="font-bold text-[#2A6B48]">{peso(d.total, 2)}</p>
                        <p className="text-xs text-slate-400">{peso(d.price_per_kg, 2)}/kg</p>
                      </td>
                      <td className="p-5">
                        <p className="font-bold text-slate-800">{d.operator_name || 'Unknown'}</p>
                        <p className="text-xs text-slate-500">{d.stall_number ? `Stall ${d.stall_number}` : 'No stall number'}</p>
                        <p className="text-xs text-slate-400 break-all">{d.operator_email || ''}</p>
                      </td>
                      <td className="p-5 pr-6">
                        <p className="font-bold text-slate-800">{d.buyer_name || 'Unknown'}</p>
                        <p className="text-xs text-slate-500">{buyerTypeLabel(d.buyer_type)}</p>
                        <p className="text-xs text-slate-400 break-all">{d.buyer_email || ''}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <span>
                {visibleDeals.length} deal{visibleDeals.length === 1 ? '' : 's'} · {dealsKg.toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg · <span className="font-bold text-slate-700">{peso(dealsTotal, 2)}</span>
              </span>
              {visibleDeals.length > dealLimit && (
                <button type="button" onClick={() => setDealLimit((n) => n + DEALS_PAGE)} className="text-[#2A6B48] text-sm font-bold hover:underline">
                  Show more ({visibleDeals.length - dealLimit} remaining)
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {showNew && <NewListingModal onClose={() => setShowNew(false)} onDone={onListed} />}

      {cancelTarget && (
        <Modal
          title="Cancel this listing?"
          onClose={cancelBusy ? undefined : () => setCancelTarget(null)}
          footer={(
            <>
              <button type="button" onClick={() => setCancelTarget(null)} disabled={cancelBusy} className="px-5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Keep listing</button>
              <button type="button" onClick={confirmCancel} disabled={cancelBusy} className="px-5 py-2.5 bg-rose-600 text-white rounded-lg text-sm font-bold hover:bg-rose-700 disabled:opacity-50">
                {cancelBusy ? 'Cancelling…' : 'Cancel listing'}
              </button>
            </>
          )}
        >
          <p className="text-sm text-slate-600">
            {titleCase(cancelTarget.crop)} batch #{cancelTarget.productId} ({cancelTarget.qty} kg, {cancelTarget.operator}) will be removed from the marketplace. Buyers will no longer see it.
          </p>
          {actionError && <p role="alert" className="text-sm text-rose-600 mt-3">{actionError}</p>}
        </Modal>
      )}
    </div>
  );
};

export default Marketplace;
