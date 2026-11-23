import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImageOff, X, ExternalLink, Loader2 } from 'lucide-react'
import { deviceApi, backendAsset } from '../api/deviceApi'
import { useBackNavigation } from '../context/BackNavigationContext'
import usePolling from '../hooks/usePolling'
import { CROP_LABELS, formatDateTime, formatDays } from '../utils/helpers'
import { scanWindowOpen } from '../utils/scanListing'
import { ScanChip, isNoVegetable, confidencePct } from './ScanResultCard'
import ErrorNotice from './ErrorNotice'
import Skeleton from './Skeleton'
import '../styles/devices.css'
import './ScanGallery.css'

const SOURCES = { AUTO: 'Stall camera', MANUAL: 'Stall camera', UPLOAD: 'Photo upload', PHONE: 'Phone camera' }
const POLL_MS = 20000

const STATE_LABELS = { fresh: 'Fresh', 'at-risk': 'At-Risk', rotten: 'Rotten' }
const LISTING_FILTERS = [['all', 'All'], ['listed', 'Listed'], ['not_listed', 'Not Listed']]

function ListingStatus({ scan }) {
  if (scan.is_listed == null) return <span className="gal-listing">Status unavailable</span>
  if (scan.is_listed) return <span className="gal-listing gal-listing--active">Listed</span>
  return <span className="gal-listing">Not Listed{scanWindowOpen(scan) ? '' : ' · Past deadline'}</span>
}

/** New first page merged into what is already on screen (keeps pages loaded with "Load more"). */
function mergeNewest(prev, fresh) {
  const byId = new Map(prev.map((s) => [s.id, s]))
  fresh.forEach((s) => byId.set(s.id, s))
  return [...byId.values()].sort((a, b) => b.id - a.id)
}

function cropOf(scan) {
  const key = scan.detected_crop || scan.crop_type
  return CROP_LABELS[key] || key || ''
}

function ScanModal({ scan, onClose }) {
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const none = isNoVegetable(scan)
  const src = scan.image_url && !imgFailed ? backendAsset(scan.image_url) : ''
  const raw = scan.raw_image_url ? backendAsset(scan.raw_image_url) : ''

  return (
    <div className="gal-modal" role="dialog" aria-modal="true" aria-label="Analysed picture" onClick={onClose}>
      <div className="gal-modal__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="gal-modal__close" aria-label="Close" onClick={onClose}><X size={20} /></button>
        <div className="gal-modal__imgwrap">
          {src ? (
            <img src={src} alt={none ? 'Camera frame' : 'Analysed produce'} onError={() => setImgFailed(true)} />
          ) : (
            <div className="gal-modal__noimg">
              <ImageOff size={32} />
              <p>{scan.image_url ? 'This picture could not be loaded.' : 'No picture was saved for this scan.'}</p>
            </div>
          )}
        </div>
        <div className="gal-modal__body">
          <div className="gal-modal__row"><strong>{formatDateTime(scan.created_at)}</strong><ScanChip scan={scan} /></div>
          <ListingStatus scan={scan} />
          {scan.message && none && <p className="gal-modal__msg">{scan.message}</p>}
          <div className="info-list">
            <div><span>Capture device</span><strong>{scan.device_name || (scan.source === 'PHONE' ? 'Phone camera' : scan.source === 'UPLOAD' ? 'Uploaded photo' : scan.device_id != null ? `Camera #${scan.device_id}` : '—')}</strong></div>
            {scan.device_ip && <div><span>Camera IP</span><strong>{scan.device_ip}</strong></div>}
            <div><span>Source</span><strong>{SOURCES[scan.source] || scan.source || '—'}</strong></div>
            {!none && (
              <>
                <div><span>Crop</span><strong>{cropOf(scan) || '—'}</strong></div>
                <div><span>State</span><strong>{STATE_LABELS[scan.state] || '—'}</strong></div>
                <div><span>Confidence</span><strong>{confidencePct(scan.ml_confidence)}</strong></div>
                <div><span>Days to spoil</span><strong>{formatDays(scan.days_to_spoil)}</strong></div>
              </>
            )}
          </div>
          {raw && (
            <a className="gal-modal__raw" href={raw} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} /> Open raw camera frame
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Tile({ scan, showCamera, onOpen }) {
  const [failed, setFailed] = useState(false)
  const none = isNoVegetable(scan)
  const hasImg = !!scan.image_url && !failed
  const detail = none
    ? 'Nothing in view'
    : [cropOf(scan), scan.ml_confidence != null ? confidencePct(scan.ml_confidence) : '', scan.days_to_spoil != null ? formatDays(scan.days_to_spoil) : '']
      .filter((x) => x && x !== '—').join(' · ')

  return (
    <button type="button" className={`gal-tile${none ? ' gal-tile--none' : ''}`} onClick={() => onOpen(scan)}>
      <span className="gal-tile__img">
        {hasImg ? (
          <img src={backendAsset(scan.image_url)} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <span className="gal-tile__ph"><ImageOff size={22} /><small>{scan.image_url ? 'Unavailable' : 'No picture'}</small></span>
        )}
      </span>
      <span className="gal-tile__meta">
        <strong>{formatDateTime(scan.created_at)}</strong>
        {showCamera && <span className="gal-tile__cam">{scan.device_name || SOURCES[scan.source] || `Camera #${scan.device_id ?? '?'}`}</span>}
        <span className="gal-tile__chip"><ScanChip scan={scan} /></span>
        <ListingStatus scan={scan} />
        <span className="gal-tile__detail">{detail}</span>
      </span>
    </button>
  )
}

/**
 * Grid of recent analysed pictures from GET /api/scans/ with source filtering, "Load more" and a full-size viewer.
 * `deviceId` fixes it to one camera; otherwise the source filter is shown.
 * Bump `refreshKey` to pull the newest scans right away (e.g. after "Scan now").
 */
export default function ScanGallery({ deviceId = null, pageSize = 12, refreshKey = 0 }) {
  const navigate = useNavigate()
  const [sourceFilter, setSourceFilter] = useState('ALL')
  const [listing, setListing] = useState('all')
  const [items, setItems] = useState([])
  const [next, setNext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [selected, setSelected] = useState(null)
  const { registerGuard } = useBackNavigation()
  useLayoutEffect(() => {
    if (!selected) return undefined
    return registerGuard(() => { setSelected(null); return true })
  }, [registerGuard, selected])

  const device = deviceId ?? undefined
  const source = sourceFilter === 'ALL' ? undefined : sourceFilter
  const key = `${device ?? ''}:${sourceFilter}:${listing}`
  const keyRef = useRef(key)
  keyRef.current = key
  const itemsRef = useRef([])
  useEffect(() => { itemsRef.current = items }, [items])

  const fetchFirst = async (reset) => {
    const myKey = keyRef.current
    try {
      const page = await deviceApi.gallery({ device, source, listing, limit: pageSize })
      if (keyRef.current !== myKey) return // filter changed while this request was in flight
      const prev = itemsRef.current
      const overlap = page.results.some((s) => prev.some((p) => p.id === s.id))
      if (reset || prev.length === 0 || page.next_before == null || (!overlap && page.results.length >= pageSize)) {
        setItems(page.results)
        setNext(page.next_before)
        setMoreError('')
      } else {
        setItems((current) => mergeNewest(current.filter((scan) => scan.id < page.next_before), page.results))
      }
      setError('')
    } catch (err) {
      if (keyRef.current === myKey) setError(err.message)
    } finally {
      if (keyRef.current === myKey) setLoading(false)
    }
  }

  useEffect(() => {
    setItems([])
    itemsRef.current = []
    setNext(null)
    setLoading(true)
    setError('')
    setMoreError('')
    fetchFirst(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageSize])

  const firstRefresh = useRef(true)
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return }
    fetchFirst(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  usePolling(() => fetchFirst(false), POLL_MS, { immediate: false })

  const loadMore = async () => {
    if (next == null || loadingMore) return
    const myKey = keyRef.current
    setLoadingMore(true)
    setMoreError('')
    try {
      const page = await deviceApi.gallery({ device, source, listing, before: next, limit: pageSize })
      if (keyRef.current !== myKey) return
      setItems((prev) => mergeNewest(prev, page.results))
      setNext(page.next_before)
    } catch (err) {
      if (keyRef.current === myKey) setMoreError(err.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const showSourceFilter = deviceId == null
  const showCamera = deviceId == null
  const visibleItems = items
  const emptyText = listing === 'listed' ? 'No listed scans found.' : listing === 'not_listed' ? 'No unlisted scans found.' : 'No scans found.'
  const useScanForBatch = (scan) => navigate('/batch/new', { state: { scan } })

  return (
    <div className="scan-gallery">
      <div className="gal-listing-filters" role="group" aria-label="Listing status">
        {LISTING_FILTERS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={listing === value} onClick={() => { setSelected(null); setListing(value) }}>
            {label}
          </button>
        ))}
      </div>
      <p className="gal-window-hint">Publish within five hours of scanning.</p>
      <div className="gal-filters">
        {showSourceFilter && (
          <select className="gal-camera" value={sourceFilter} onChange={(e) => { setSelected(null); setSourceFilter(e.target.value) }} aria-label="Photo source">
            <option value="ALL">All sources</option>
            <option value="CAMERA">Stall camera</option>
            <option value="PHOTO">Photo camera</option>
          </select>
        )}
      </div>

      <ErrorNotice
        message={error}
        onRetry={() => { setLoading(true); fetchFirst(true) }}
        retrying={loading}
      />

      {loading && items.length === 0 && !error && (
        <div className="gal-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={190} radius={12} />)}
        </div>
      )}

      {!loading && !error && visibleItems.length === 0 && <p className="muted gal-empty">{emptyText}</p>}

      {visibleItems.length > 0 && (
        <div className="gal-grid">
          {visibleItems.map((s) => {
            const canList = scanWindowOpen(s) && s.freshness_status !== 'RED'
            return (
              <div className="gal-entry" key={`${s.source}-${s.id}`}>
                <Tile scan={s} showCamera={showCamera} onOpen={setSelected} />
                {!s.used_for_batch && s.detected && !isNoVegetable(s) && !s.crop_mismatch && !s.low_confidence && (
                  <button type="button" className="btn btn-outline gal-list-batch" onClick={() => useScanForBatch(s)}>
                    {canList ? 'Create batch & list' : 'Save to inventory'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {moreError && <div className="notice error">{moreError}</div>}
      {next != null && items.length > 0 && (
        <button type="button" className="btn btn-ghost gal-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? <><Loader2 size={16} className="spin" /> Loading…</> : 'Load more'}
        </button>
      )}

      {selected && <ScanModal scan={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
