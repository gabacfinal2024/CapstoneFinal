import { supabase } from '../lib/supabase'
import { PRODUCT_SELECT } from './supabaseApi'

// Admin marketplace operations. They rely on supabase/008 (admin read access) and
// supabase/009 (deal_history, admin_list_batch, admin_cancel_listing).

const MISSING_RPC = /could not find the function|PGRST202|42883|schema cache/i
const SQL_HINT = 'Run supabase/009_deals_avatars_admin_listings.sql in the Supabase SQL editor first.'

export function friendlyRpcError(err, what) {
  const message = err?.message || String(err || 'Unknown error')
  if (MISSING_RPC.test(`${err?.code || ''} ${message}`)) return `${what} is not available yet. ${SQL_HINT}`
  return message
}

/** Completed deals with both actors (stall operator + rescue buyer). */
export async function dealHistory() {
  const { data, error } = await supabase.rpc('deal_history')
  if (error) throw new Error(friendlyRpcError(error, 'Deal history'))
  return (data || []).map((d) => ({ ...d, quantity_kg: Number(d.quantity_kg) || 0, total: Number(d.total) || 0, price_per_kg: Number(d.price_per_kg) || 0 }))
}

export async function adminListBatch(productId, days = 3) {
  const { data, error } = await supabase.rpc('admin_list_batch', { p_product: productId, p_days: days })
  if (error) throw new Error(friendlyRpcError(error, 'Listing a batch'))
  return data
}

export async function adminCancelListing(listingId) {
  const { error } = await supabase.rpc('admin_cancel_listing', { p_listing: listingId })
  if (error) throw new Error(friendlyRpcError(error, 'Cancelling a listing'))
}

/** Batches the admin may put on the marketplace: not rotten, not already listed, not sold. */
export async function listableBatches() {
  const [productsRes, listingsRes] = await Promise.all([
    supabase.from('products').select(PRODUCT_SELECT).eq('is_listed', false).neq('freshness_status', 'RED').order('created_at', { ascending: false }),
    supabase.from('marketplace_listings').select('product_id, listing_status, expires_at').in('listing_status', ['ACTIVE', 'SOLD']),
  ])
  if (productsRes.error) throw new Error(productsRes.error.message)
  const blocked = new Set()
  for (const l of listingsRes.data || []) {
    if (l.listing_status === 'SOLD' || new Date(l.expires_at) > new Date()) blocked.add(l.product_id)
  }
  return (productsRes.data || []).filter((p) => !blocked.has(p.id))
}

/** Number of registered rescue buyers (null when it cannot be read). */
export async function buyerCount() {
  const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'RESCUE_BUYER')
  return error ? null : count
}
