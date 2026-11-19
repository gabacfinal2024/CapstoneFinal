import { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import useEntryState from '../hooks/useEntryState'
import usePolling from '../hooks/usePolling'
import { api } from '../api/supabaseApi'
import { useBackNavigation } from '../context/BackNavigationContext'
import ProduceCard from '../components/ProduceCard'
import BottomNav from '../components/BottomNav'
import ErrorNotice from '../components/ErrorNotice'
import './Marketplace.css'

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'EGGPLANT', label: 'Eggplant' },
  { id: 'CUCUMBER', label: 'Cucumber' },
  { id: 'CARROT', label: 'Carrot' },
]

const CROP_LABELS = {
  EGGPLANT: 'Eggplant',
  CUCUMBER: 'Cucumber',
  CARROT: 'Carrot',
}

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'price_asc', label: 'Price, low to high' },
  { id: 'price_desc', label: 'Price, high to low' },
  { id: 'freshness', label: 'Freshness' },
]

export default function Marketplace() {
  const { registerGuard } = useBackNavigation()
  const [listings, setListings] = useState([])
  const [tab, setTab] = useEntryState('tab', 'all')
  const [search, setSearch] = useEntryState('search', '')
  const [producer, setProducer] = useEntryState('producer', '')
  const [sort, setSort] = useEntryState('sort', 'newest')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [sortOpen, setSortOpen] = useState(false)
  const sortTrigger = useRef(null)
  const request = useRef(0)
  const selectedSort = SORT_OPTIONS.find((option) => option.id === sort) || SORT_OPTIONS[0]

  const refresh = useCallback(async () => {
    const current = ++request.current
    try {
      const data = await api.marketplace()
      if (current !== request.current) return
      setListings(data)
      setLoadError('')
    } catch (err) {
      if (current === request.current) setLoadError(err.message || 'Could not load the listings.')
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [])

  usePolling(refresh, 30000)
  useEffect(() => {
    const unsubscribe = api.subscribeMarketplace(refresh)
    return () => { request.current += 1; unsubscribe() }
  }, [refresh])

  const closeSort = useCallback(() => {
    setSortOpen(false)
    sortTrigger.current?.focus()
  }, [])
  useLayoutEffect(() => {
    if (!sortOpen) return undefined
    return registerGuard(() => { closeSort(); return true })
  }, [closeSort, registerGuard, sortOpen])

  const query = search.trim().toLowerCase()
  const vendor = producer.trim().toLowerCase()
  const hasFilters = tab !== 'all' || Boolean(query || vendor)
  const filtered = listings.filter((l) => {
    const crop = l.products?.crop_type || ''
    const cropLabel = (CROP_LABELS[crop] || crop).toLowerCase()
    const matchesTab = tab === 'all' ? true : crop === tab
    const matchesSearch = !query || cropLabel.includes(query) || (l.products?.notes || '').toLowerCase().includes(query)
    const matchesProducer = !vendor || (l.profiles?.full_name || '').toLowerCase().includes(vendor)
    return matchesTab && matchesSearch && matchesProducer
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'newest') return new Date(b.created_at) - new Date(a.created_at)
    if (sort === 'price_asc') return (a.listed_price || a.products?.current_price_per_kg || 0) - (b.listed_price || b.products?.current_price_per_kg || 0)
    if (sort === 'price_desc') return (b.listed_price || b.products?.current_price_per_kg || 0) - (a.listed_price || a.products?.current_price_per_kg || 0)
    if (sort === 'freshness') return (b.products?.freshness_percent || 0) - (a.products?.freshness_percent || 0)
    return 0
  })

  return (
    <div className="app-shell">
      <div className="page marketplace">
        <header className="market-header">
          <h1>Rescue Listings</h1>
        </header>

        <div className="search-bar">
          <input type="search" aria-label="Search produce" placeholder="Search produce (crop or notes)" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input type="search" aria-label="Vendor name" placeholder="Filter by vendor name" value={producer} onChange={(e) => setProducer(e.target.value)} />
        </div>

        <div className="category-tabs" role="group" aria-label="Crop type">
          {TABS.map((t) => (
            <button type="button" key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="market-sort" onKeyDown={(event) => {
          if (sortOpen && event.key === 'Escape') { event.preventDefault(); closeSort() }
        }}>
          <button type="button" ref={sortTrigger} className="market-sort__trigger"
            aria-expanded={sortOpen} aria-controls="market-sort-options" onClick={() => setSortOpen(!sortOpen)}>
            <span>Sort by</span>
            <strong>{selectedSort.label}</strong>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div id="market-sort-options" role="group" aria-label="Sort options" hidden={!sortOpen} className="market-sort__options">
            {SORT_OPTIONS.map((option) => (
              <button type="button" key={option.id} aria-pressed={selectedSort.id === option.id}
                onClick={() => { setSort(option.id); closeSort() }}>
                {option.label}
                {selectedSort.id === option.id && <Check size={17} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>

        <ErrorNotice message={loadError} onRetry={refresh} />
        {loading ? (
          <p className="muted">Loading listings…</p>
        ) : sorted.length ? (
          <div className="listing-grid">
            {sorted.map((l) => <ProduceCard key={l.id} listing={l} />)}
          </div>
        ) : !loadError && (
          <div className="empty-state card">
            <p>{hasFilters ? 'No listings match these filters.' : 'No active listings right now.'}</p>
            {hasFilters && <button type="button" className="btn btn-ghost" onClick={() => {
              setTab('all')
              setSearch('')
              setProducer('')
            }}>Clear filters</button>}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
