import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, CircleSlash, ExternalLink, ImageOff, Loader2, RefreshCw, X } from 'lucide-react'
import {
  absoluteMedia, cropLabel, deviceApi, feedbackText, formatDateTime, isDetected, isSensor, scanBadgeStatus, scanImageSrc,
} from '../api/deviceApi'
import { usePolling } from '../hooks/usePolling'
import ProbabilityBars from '../components/ProbabilityBars'
import StatusBadge from '../components/StatusBadge'
import { CopyButton } from '../components/DeviceBits'

const PAGE_SIZE = 40
const REFRESH_MS = 15000
const MAX_SKIP_PAGES = 8 // pages to scan past when a "to" date hides the newest ones

const EMPTY_FILTERS = { device: '', detected: '', state: '', from: '', to: '' }
const STATES = [['fresh', 'Fresh'], ['at-risk', 'At-Risk'], ['rotten', 'Rotten'], ['none', 'Nothing detected']]

const selectCls = 'px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:border-[#2A6B48] focus:ring-2 focus:ring-emerald-100 outline-none'

/** yyyy-mm-dd (from <input type="date">) → local Date at 00:00 / 23:59:59.999 */
const startOfDay = (v) => (v ? new Date(`${v}T00:00:00`) : null)
const endOfDay = (v) => (v ? new Date(`${v}T23:59:59.999`) : null)

const pct = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100))

function queryFor(filters, extra = {}) {
  const from = startOfDay(filters.from)
  return {
    device: filters.device || undefined,
    detected: filters.detected === '1' ? true : filters.detected === '0' ? false : undefined,
    state: filters.state || undefined,
    since: from && !Number.isNaN(from.getTime()) ? from.toISOString() : undefined,
    limit: PAGE_SIZE,
    ...extra,
  }
}

function ScanDetails({ scan }) {
  const detected = isDetected(scan)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {detected ? (
        <>
          <span className="text-xs font-bold text-slate-700">{cropLabel(scan.detected_crop || scan.crop_type)}</span>
          <StatusBadge status={scanBadgeStatus(scan)} />
        </>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><CircleSlash size={12} /> Nothing detected</span>
      )}
    </div>
  )
}

function GalleryCard({ scan, onOpen }) {
  const img = scanImageSrc(scan)
  const detected = isDetected(scan)
  const conf = pct(scan.ml_confidence)
  return (
    <li className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      <button type="button" onClick={onOpen} aria-label={`Open picture from ${scan.device_name || 'camera'} taken ${formatDateTime(scan.created_at)}`}
              className="relative block aspect-video bg-slate-900 focus-visible:outline-2 focus-visible:outline-[#2A6B48]">
        {img ? (
          <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs gap-1">
            <ImageOff size={22} /> No picture stored
          </span>
        )}
        {scan.crop_mismatch && detected && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
            <AlertTriangle size={10} /> mismatch
          </span>
        )}
      </button>
      <div className="p-3 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <time dateTime={scan.created_at} className="font-bold text-slate-700">{formatDateTime(scan.created_at)}</time>
          {scan.source && <span className="text-[10px] font-bold text-slate-400 uppercase">{scan.source}</span>}
        </div>
        <p className="text-slate-500 truncate">
          <span className="font-semibold text-slate-700">{scan.device_name || 'Camera'}</span>
          {' • '}{scan.device_ip ? <span className="font-mono">{scan.device_ip}</span> : <span className="italic">IP unknown</span>}
        </p>
        <ScanDetails scan={scan} />
        {detected && (
          <p className="text-slate-500">
            {conf != null ? `${conf}% confidence` : ''}
            {scan.freshness_percent != null ? ` • ${Math.round(scan.freshness_percent)}% fresh` : ''}
            {scan.days_to_spoil != null ? ` • ${scan.days_to_spoil} day${Number(scan.days_to_spoil) === 1 ? '' : 's'} to spoil` : ''}
            {scan.low_confidence ? ' • low confidence' : ''}
          </p>
        )}
        {scan.feedback_label && <p className="text-[11px] text-slate-400">{scan.feedback_label === 'correct' ? '✔' : '✖'} {feedbackText(scan.feedback_label)}</p>}
      </div>
    </li>
  )
}

function Lightbox({ items, openId, onOpenId, onClose }) {
  const index = items.findIndex((s) => s.id === openId)
  const scan = items[index]
  const onIndex = useCallback((i) => onOpenId(items[i]?.id), [items, onOpenId])
  const [rawFor, setRawFor] = useState(null) // scan id currently showing its raw frame
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onIndex, onClose])

  if (!scan) return null
  const annotated = scanImageSrc(scan)
  const raw = absoluteMedia(scan.raw_image_url)
  const showRaw = rawFor === scan.id && !!raw
  const shown = showRaw ? raw : annotated
  const detected = isDetected(scan)

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Scan picture"
         onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-full overflow-hidden grid grid-cols-1 lg:grid-cols-3" onClick={(e) => e.stopPropagation()}>
        <div className="lg:col-span-2 bg-black flex items-center justify-center relative min-h-[240px]">
          {shown ? (
            <img src={shown} alt={detected ? 'Analysed produce' : 'Camera frame with no target vegetable'} className="max-w-full max-h-[50vh] lg:max-h-[85vh] object-contain" />
          ) : (
            <span className="text-slate-400 text-sm flex flex-col items-center gap-2"><ImageOff size={28} /> No picture stored for this scan</span>
          )}
          {index > 0 && (
            <button type="button" onClick={() => onIndex(index - 1)} aria-label="Newer picture"
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronLeft size={22} /></button>
          )}
          {index < items.length - 1 && (
            <button type="button" onClick={() => onIndex(index + 1)} aria-label="Older picture"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronRight size={22} /></button>
          )}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[40vh] lg:max-h-[85vh]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">{formatDateTime(scan.created_at)}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{scan.source ? `${scan.source.toLowerCase()} scan • ` : ''}scan #{scan.id}</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X size={18} /></button>
          </div>

          <div className="text-sm space-y-1">
            <p className="font-bold text-slate-800">{scan.device_name || 'Camera'}</p>
            <p className="text-slate-500 flex flex-wrap items-center gap-2">
              {scan.device_ip ? <><span className="font-mono">{scan.device_ip}</span><CopyButton text={scan.device_ip} label="Copy IP" /></> : <span className="italic">IP unknown</span>}
            </p>
            {scan.device_id && <Link to={`/devices/${scan.device_id}`} className="text-xs font-bold text-[#2A6B48] hover:underline">Open camera</Link>}
          </div>

          <ScanDetails scan={scan} />

          {detected ? (
            <>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-[10px] uppercase font-bold text-slate-400">Confidence</p><p className="font-bold text-[#2A6B48]">{pct(scan.ml_confidence) != null ? `${pct(scan.ml_confidence)}%` : '—'}</p></div>
                <div><p className="text-[10px] uppercase font-bold text-slate-400">Freshness</p><p className="font-bold text-slate-800">{scan.freshness_percent != null ? `${Math.round(scan.freshness_percent)}%` : '—'}</p></div>
                <div><p className="text-[10px] uppercase font-bold text-slate-400">Days to spoil</p><p className="font-bold text-slate-800">{scan.days_to_spoil ?? '—'}</p></div>
              </div>
              <ProbabilityBars probs={scan.probs} />
              {scan.crop_mismatch && (
                <p className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {scan.message || "Detected crop differs from the camera's registered crop."}</p>
              )}
              {scan.low_confidence && (
                <p className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-xs"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> Low confidence. A clearer re-scan is recommended.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">{scan.message || 'No eggplant, cucumber or carrot in view.'}</p>
          )}

          {scan.feedback_label && <p className="text-xs text-slate-500">{scan.feedback_label === 'correct' ? '✔' : '✖'} {feedbackText(scan.feedback_label)}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            {annotated && raw && (
              <button type="button" onClick={() => setRawFor(showRaw ? null : scan.id)} aria-pressed={showRaw}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50">
                {showRaw ? 'Show annotated' : 'Show raw frame'}
              </button>
            )}
            {raw && (
              <a href={raw} target="_blank" rel="noopener noreferrer"
                 className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1">
                <ExternalLink size={12} /> Open raw frame
              </a>
            )}
            {annotated && !annotated.startsWith('data:') && (
              <a href={annotated} target="_blank" rel="noopener noreferrer"
                 className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1">
                <ExternalLink size={12} /> Open annotated image
              </a>
            )}
          </div>
          {!raw && <p className="text-[11px] text-slate-400">No raw frame was kept for this scan.</p>}
        </div>
      </div>
    </div>
  )
}

export default function Gallery() {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [devices, setDevices] = useState([])
  const [items, setItems] = useState([])
  const [nextBefore, setNextBefore] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [openId, setOpenId] = useState(null) // by scan id so auto-refresh can't shift the picture
  const [updatedAt, setUpdatedAt] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const sentinelRef = useRef(null)
  const requestRef = useRef(0) // ignore responses that belong to an older filter set
  const filtersRef = useRef(filters)
  const filterKey = JSON.stringify(filters)
  const toDate = useMemo(() => endOfDay(filters.to), [filters.to])

  useEffect(() => {
    filtersRef.current = filters
  })

  const keepInRange = useCallback((rows) => (toDate ? rows.filter((s) => new Date(s.created_at) <= toDate) : rows), [toDate])

  // Camera names for the filter
  usePolling(async () => {
    try { setDevices((await deviceApi.list()).filter((d) => !isSensor(d))) } catch { /* the gallery still works without the filter list */ }
  }, 60000)

  // First page whenever the filters change (or Refresh is pressed).
  // The API has no "until" filter, so with a "To" date newer pictures are skipped client-side.
  useEffect(() => {
    const ticket = ++requestRef.current
    let alive = true
    const run = async () => {
      setLoading(true)
      setError('')
      setMoreError('')
      try {
        let before
        let collected = []
        let next = null
        for (let page = 0; page < MAX_SKIP_PAGES; page++) {
          const res = await deviceApi.gallery(queryFor(filtersRef.current, { before }))
          if (!alive || ticket !== requestRef.current) return
          collected = collected.concat(keepInRange(res.results || []))
          next = res.next_before
          if (collected.length >= PAGE_SIZE / 2 || !next) break
          before = next
        }
        setItems(collected)
        setNextBefore(next)
        setUpdatedAt(new Date())
      } catch (err) {
        if (!alive || ticket !== requestRef.current) return
        setItems([])
        setNextBefore(null)
        setError(err.message)
      } finally {
        if (alive && ticket === requestRef.current) setLoading(false)
      }
    }
    run()
    return () => { alive = false }
  }, [filterKey, reloadKey, keepInRange])

  const loadMore = useCallback(async () => {
    if (!nextBefore || loading || loadingMore) return
    const ticket = requestRef.current
    setLoadingMore(true)
    setMoreError('')
    try {
      let before = nextBefore
      let collected = []
      let next = nextBefore
      for (let page = 0; page < MAX_SKIP_PAGES && next; page++) {
        const res = await deviceApi.gallery(queryFor(filtersRef.current, { before }))
        if (ticket !== requestRef.current) return
        collected = collected.concat(keepInRange(res.results || []))
        next = res.next_before
        before = next
        if (collected.length >= PAGE_SIZE / 2) break
      }
      setItems((cur) => {
        const seen = new Set(cur.map((s) => s.id))
        return [...cur, ...collected.filter((s) => !seen.has(s.id))]
      })
      setNextBefore(next)
    } catch (err) {
      if (ticket === requestRef.current) setMoreError(err.message)
    } finally {
      if (ticket === requestRef.current) setLoadingMore(false)
    }
  }, [nextBefore, loading, loadingMore, keepInRange])

  // Gentle auto-refresh: prepend scans newer than what we show (paused while an end date is set)
  usePolling(async () => {
    const ticket = requestRef.current
    try {
      const res = await deviceApi.gallery(queryFor(filtersRef.current))
      if (ticket !== requestRef.current) return
      const fresh = keepInRange(res.results || [])
      setItems((cur) => {
        const byId = new Map(fresh.map((s) => [s.id, s]))
        const merged = cur.map((s) => byId.get(s.id) || s) // pick up feedback changes
        const known = new Set(cur.map((s) => s.id))
        const added = fresh.filter((s) => !known.has(s.id))
        return added.length ? [...added, ...merged].sort((a, b) => b.id - a.id) : merged
      })
      setUpdatedAt(new Date())
    } catch { /* keep what we have; the next tick retries */ }
  }, REFRESH_MS, `${filterKey}-${reloadKey}`, !loading && !error && !toDate)

  // Infinite scroll (the "Load more" button remains as a fallback)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !nextBefore || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !moreError) loadMore()
    }, { rootMargin: '400px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [nextBefore, loadMore, moreError, items.length])

  const setFilter = (key, value) => {
    setOpenId(null)
    setFilters((f) => ({ ...f, [key]: value }))
  }
  const hasFilters = filterKey !== JSON.stringify(EMPTY_FILTERS)
  const closeLightbox = useCallback(() => setOpenId(null), [])
  const rangeInvalid = filters.from && filters.to && filters.from > filters.to

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Scan Gallery</h1>
          <p className="text-slate-500 text-sm mt-1">Recent pictures analysed from every stall camera. New pictures appear automatically.</p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && <span className="text-xs text-slate-400">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}
                  className="px-4 py-2.5 rounded-xl font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 flex items-center gap-2">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <form className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 items-end" onSubmit={(e) => e.preventDefault()}>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Camera
          <select className={`${selectCls} mt-1 w-full font-normal normal-case`} value={filters.device} onChange={(e) => setFilter('device', e.target.value)}>
            <option value="">All cameras</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}{d.ip ? ` (${d.ip})` : ''}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Detection
          <select className={`${selectCls} mt-1 w-full font-normal normal-case`} value={filters.detected} onChange={(e) => setFilter('detected', e.target.value)}>
            <option value="">All pictures</option>
            <option value="1">Vegetable detected</option>
            <option value="0">Nothing detected</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">State
          <select className={`${selectCls} mt-1 w-full font-normal normal-case`} value={filters.state} onChange={(e) => setFilter('state', e.target.value)}>
            <option value="">Any state</option>
            {STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">From
          <input type="date" className={`${selectCls} mt-1 w-full font-normal`} value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">To
          <input type="date" className={`${selectCls} mt-1 w-full font-normal`} value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
        <button type="button" onClick={() => { setOpenId(null); setFilters(EMPTY_FILTERS) }} disabled={!hasFilters}
                className="px-4 py-2 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-sm">
          Clear filters
        </button>
      </form>
      {rangeInvalid && <p role="alert" className="text-sm text-amber-700">“From” is after “To”, so nothing can match.</p>}

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm flex flex-wrap items-center justify-between gap-3">
          <span>Couldn't load the gallery: {error}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 font-bold text-xs">Try again</button>
        </div>
      )}

      {loading && items.length === 0 && !error && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" aria-busy="true" aria-label="Loading pictures">
          {Array.from({ length: 8 }, (_, i) => <li key={i} className="aspect-[4/3] rounded-2xl bg-slate-100 animate-pulse" />)}
        </ul>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center">
          <Camera size={40} className="mx-auto text-slate-300" />
          <h2 className="mt-3 text-lg font-bold text-slate-700">{hasFilters ? 'No pictures match these filters' : 'No analysed pictures yet'}</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            {hasFilters ? 'Try a wider date range or clear the filters.' : 'Pictures appear here after a camera uploads and analyses a scan.'}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <>
          <p className="text-xs text-slate-400">{items.length} picture{items.length === 1 ? '' : 's'} shown{nextBefore ? ' • more available' : ' • end of history'}</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((s) => <GalleryCard key={s.id} scan={s} onOpen={() => setOpenId(s.id)} />)}
          </ul>
          <div ref={sentinelRef} className="flex flex-col items-center gap-2 py-4">
            {moreError && <p role="alert" className="text-sm text-rose-600">Couldn't load more: {moreError}</p>}
            {nextBefore && (
              <button type="button" onClick={loadMore} disabled={loadingMore}
                      className="px-5 py-2.5 rounded-xl font-bold text-[#2A6B48] border border-emerald-200 bg-white hover:bg-emerald-50 disabled:opacity-60 flex items-center gap-2">
                {loadingMore && <Loader2 size={16} className="animate-spin" />} {loadingMore ? 'Loading…' : moreError ? 'Try again' : 'Load more'}
              </button>
            )}
          </div>
        </>
      )}

      {openId != null && items.some((s) => s.id === openId) && (
        <Lightbox items={items} openId={openId} onOpenId={setOpenId} onClose={closeLightbox} />
      )}
    </div>
  )
}
