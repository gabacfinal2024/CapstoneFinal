import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useAuth } from '../context/AuthContext'
import BottomNav from '../components/BottomNav'
import ProduceCard from '../components/ProduceCard'
import './Marketplace.css'
import './SavedListings.css'

export default function SavedListings() {
  const { isBuyer } = useAuth()
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setListings(await api.savedListings())
    } catch (err) {
      setError(err.message || 'Could not load saved listings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const removeListing = (listingId) => {
    setListings((current) => current.filter((listing) => listing.id !== listingId))
  }

  return (
    <div className="app-shell">
      <div className="page saved-listings">
        <header className="saved-listings__header">
          <h1 className="section-title">Saved Listings</h1>
          <p>Keep track of produce you are interested in. You’ll receive an in-app alert if a saved listing’s price drops.</p>
        </header>

        {!isBuyer ? (
          <div className="empty-state card">
            <p>Saved listings are available to rescue buyers.</p>
            <Link to="/marketplace" className="btn btn-outline">Browse listings</Link>
          </div>
        ) : loading ? (
          <p className="muted">Loading your saved listings…</p>
        ) : error ? (
          <div className="empty-state card" role="alert">
            <p>Could not load your saved listings.</p>
            <p className="muted">{error}</p>
            <p className="muted">Make sure the latest <code>supabase/005_notification_triggers.sql</code> migration has been run in Supabase.</p>
            <button type="button" className="btn btn-outline" onClick={load}>Try again</button>
          </div>
        ) : listings.length ? (
          <div className="listing-grid">
            {listings.map((listing) => (
              <ProduceCard
                key={listing.id}
                listing={listing}
                isSaved
                onUnsave={removeListing}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state card">
            <p>You haven’t saved any listings yet.</p>
            <p className="muted">Browse produce and tap <strong>Save</strong> on a listing to find it here.</p>
            <Link to="/marketplace" className="btn btn-green">Browse Listings</Link>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
