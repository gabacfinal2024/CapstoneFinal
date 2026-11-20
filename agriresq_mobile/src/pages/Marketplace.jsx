import PageTitle from '../components/PageTitle'
import { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import useEntryState from '../hooks/useEntryState'
import usePolling from '../hooks/usePolling'
import { api } from '../api/supabaseApi'
import { useBackNavigation } from '../context/BackNavigationContext'
import { CROP_LABELS } from '../utils/helpers'
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
  const [savedSearch, setSearch] = useEntryState('search', '')
  const [legacyVendor, setLegacyVendor] = useEntryState('producer', '')
  const [sort, setSort] = useEntryState('sort', 'newest')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [sortPhase, setSortPhase] = useState('closed')
  const searchInput = useRef(null)
  const sortTrigger = useRef(null)
  const sortDialog = useRef(null)
  const outsidePointerDown = useRef(false)
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
    setSortPhase('closing')
  }, [])

  useLayoutEffect(() => {
    if (sortPhase === 'closed') return undefined
    return registerGuard(() => { closeSort(); return true })
  }, [closeSort, registerGuard, sortPhase])

  const openSort = () => {
    outsidePointerDown.current = false
    sortDialog.current.showModal()
    setSortPhase('open')
  }

  const finishClosingSort = (event) => {
    if (event.target !== event.currentTarget || sortPhase !== 'closing') return
    sortDialog.current.close()
    setSortPhase('closed')
    sortTrigger.current?.focus({ preventScroll: true })
  }

  // Bring searches saved in earlier navigation entries into the unified field.
  const search = legacyVendor ? [savedSearch.trim(), legacyVendor.trim()].filter(Boolean).join(' ') : savedSearch
  const updateSearch = (value) => {
    setSearch(value)
    if (legacyVendor) setLegacyVendor('')
  }

  const keywords = search.toLowerCase().match(/\S+/g) || []
  const hasFilters = tab !== 'all' || keywords.length > 0
  const filtered = listings.filter((listing) => {
    const product = listing.products
    const crop = product?.crop_type || ''
    if (tab !== 'all' && crop !== tab) return false
    if (!keywords.length) return true

    const searchableFields = [
      CROP_LABELS[crop] || crop,
      listing.profiles?.full_name,
      product?.profiles?.full_name,
      product?.notes,
      product?.description,
      listing.notes,
      listing.description,
    ].map((value) => (value || '').toLowerCase())
    return keywords.every((keyword) => searchableFields.some((field) => field.includes(keyword)))
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
        <header className="page-title-header">
          <PageTitle>Rescue Listings</PageTitle>
        </header>

        <div className="market-search" role="search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            aria-label="Search produce, vendor, or notes"
            placeholder="Search produce, vendor, or notes..."
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
          />
          {search && (
            <button type="button" className="market-icon-button" aria-label="Clear search" onClick={() => {
              updateSearch('')
              searchInput.current?.focus()
            }}>
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="category-tabs" role="group" aria-label="Crop type">
          {TABS.map((t) => (
            <button type="button" key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="market-sort">
          <button type="button" ref={sortTrigger} className="market-sort__trigger"
            aria-haspopup="dialog" aria-expanded={sortPhase !== 'closed'} aria-controls="market-sort-dialog" onClick={openSort}>
            <span>Sort by</span>
            <strong>{selectedSort.label}</strong>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
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
            <p role="status">{keywords.length ? 'No matching listings found. Try another search.'
              : hasFilters ? 'No listings match these filters.' : 'No active listings right now.'}</p>
            {hasFilters && <button type="button" className="btn btn-ghost" onClick={() => {
              setTab('all')
              updateSearch('')
            }}>Clear filters</button>}
          </div>
        )}
      </div>
      <BottomNav />
      <dialog
        ref={sortDialog}
        id="market-sort-dialog"
        className="market-sort-dialog"
        aria-labelledby="market-sort-title"
        data-phase={sortPhase}
        onCancel={(event) => { event.preventDefault(); closeSort() }}
        onPointerDown={(event) => { outsidePointerDown.current = event.target === event.currentTarget }}
        onClick={(event) => {
          if (outsidePointerDown.current && event.target === event.currentTarget) closeSort()
        }}
        onAnimationEnd={finishClosingSort}
      >
        <div className="market-sort-panel">
          <header className="market-sort-panel__header">
            <h2 id="market-sort-title">Sort Listings</h2>
            <button type="button" className="market-icon-button" aria-label="Close sort panel" onClick={closeSort}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <div className="market-sort-panel__options" role="group" aria-label="Sorting options">
            {SORT_OPTIONS.map((option) => (
              <button type="button" key={option.id} aria-pressed={selectedSort.id === option.id} onClick={() => {
                if (sortPhase !== 'open') return
                setSort(option.id)
                closeSort()
              }}>
                {option.label}
                {selectedSort.id === option.id && <Check size={18} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      </dialog>
    </div>
  )
}
