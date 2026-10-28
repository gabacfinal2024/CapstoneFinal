import { supabase } from '../lib/supabase'
import { cachedAvatar } from './avatarApi'

export const PRODUCT_SELECT = `
  *,
  profiles:operator_id (full_name, stall_number, market_location, is_verified)
`

const LISTING_SELECT = `
  *,
  products:product_id (${PRODUCT_SELECT}),
  profiles:operator_id (full_name, stall_number)
`

/**
 * Raw sensor data is private: the latest paired DHT22 reading lives in its own table, product_climate (one row per
 * product, readable by the admin and the batch's operator). It is fetched separately and attached as
 * `product_climate` (a row, or null) so that a missing table (supabase/010_sensor_columns.sql not run yet)
 * can never break the batch queries. Accepts products rows; mutates and returns them.
 */
async function attachClimate(products) {
  const rows = (products || []).filter(Boolean)
  const ids = [...new Set(rows.map((p) => p.id).filter((id) => id != null))]
  if (!ids.length) return products
  const byId = new Map()
  let loaded = false
  try {
    const { data, error } = await supabase.from('product_climate').select('*').in('product_id', ids)
    if (!error) {
      loaded = true
      for (const c of data || []) byId.set(c.product_id, c)
    }
  } catch { /* table missing or blocked: leave the key off so the UI says the data is not available yet */ }
  if (loaded) for (const p of rows) p.product_climate = byId.get(p.id) || null
  return products
}

async function getSessionUserId() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error('Not authenticated')
  return session.user.id
}

async function clearLocalSession() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw new Error(`Unable to clear the current session: ${error.message}`)
}

function getRegistrationErrorMessage(error) {
  const message = error.message || 'Unable to create your account.'
  if (/email.*rate limit|rate limit.*email|over_email_send_rate_limit/i.test(`${error.code || ''} ${message}`)) {
    return 'Supabase has temporarily limited confirmation emails. This does not mean your email is already registered. Wait before trying again, or configure custom SMTP for the Supabase project. If you receive a confirmation email, verify it before signing in.'
  }
  return message
}

export const api = {
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      if (error.code === 'email_not_confirmed') {
        throw new Error('Please verify your email address using the confirmation link before signing in.')
      }
      throw new Error(error.message)
    }
    if (!data.user.email_confirmed_at) {
      await clearLocalSession()
      throw new Error('Please verify your email address using the confirmation link before signing in.')
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()
    if (profileError || !profile?.role) {
      await clearLocalSession()
      throw new Error('Your account profile is incomplete. Please contact support.')
    }
    if (profile.role !== 'ADMIN') {
      await clearLocalSession()
      throw new Error('This dashboard is for administrators only. Stall operators and buyers use the AgriResQ mobile app.')
    }

    return data.user
  },

  // Every new account is a rescue buyer; the database ignores any role sent from the app.
  async register({ full_name, email, password, buyer_type, phone_number }) {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Enter a valid email address.')
    }
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          full_name,
          buyer_type,
          phone_number,
        },
      },
    })
    if (error) throw new Error(getRegistrationErrorMessage(error))
    if (data.session) await clearLocalSession()
    return data.user
  },

  // -- Administrator: account types --
  async adminUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, stall_number, created_at')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data || []
  },

  async adminRoleRequests() {
    const { data, error } = await supabase
      .from('role_requests')
      .select('id, user_id, requested_stall_number, note, status, created_at, profiles:user_id (full_name, email)')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
  },

  async adminSetRole(target, role, stall) {
    const { error } = await supabase.rpc('admin_set_role', { target, new_role: role, new_stall: stall || null })
    if (error) throw new Error(error.message)
  },

  async adminRejectRequest(requestId, reason) {
    const { error } = await supabase.rpc('admin_reject_role_request', { request_id: requestId, reason: reason || null })
    if (error) throw new Error(error.message)
  },

  async logout() {
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(error.message)
  },

  /** Logged-in user merged with their `profiles` row (full_name, role, stall_number, market_location...). */
  async me() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    return {
      id: session.user.id,
      email: session.user.email,
      ...profile,
      avatar_url: profile?.avatar_url || cachedAvatar(session.user.id),
      role: profile?.role,
    }
  },

  /** Edit the signed-in user's own profile (never the role: the database locks it). */
  async updateProfile({ full_name, market_location }) {
    const userId = await getSessionUserId()
    const fields = {}
    if (full_name !== undefined) fields.full_name = full_name
    if (market_location !== undefined) fields.market_location = market_location
    const { error } = await supabase.from('profiles').update(fields).eq('id', userId)
    if (error) throw new Error(error.message)
  },

  /** Re-checks the current password, then sets the new one. */
  async changePassword(currentPassword, newPassword) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not signed in. Please log in again.')
    const { error: checkError } = await supabase.auth.signInWithPassword({ email: session.user.email, password: currentPassword })
    if (checkError) throw new Error('Current password is incorrect.')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw new Error(error.message)
  },

  async sendPasswordResetEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) throw new Error(error.message)
  },

  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new Error(error.message)
  },

  async dashboard() {
    const userId = await getSessionUserId()
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()
    if (profileError) throw profileError

    const isOperator = profile?.role === 'STALL_OPERATOR'
    let query = supabase.from('products').select(PRODUCT_SELECT).order('created_at', { ascending: false })
    if (profile?.role === 'ADMIN') {
      query = query.neq('freshness_status', 'RED')       // administrators see every stall
    } else if (isOperator) {
      query = query.eq('operator_id', userId).neq('freshness_status', 'RED')
    } else {
      query = query.eq('is_listed', true).neq('freshness_status', 'RED').limit(10)
    }

    const { data: active_batches, error } = await query
    if (error) throw error

    return { active_batches: await attachClimate(active_batches || []) }
  },

  async batches() {
    const userId = await getSessionUserId()
    const { data: me } = await supabase.from('profiles').select('role').eq('id', userId).single()
    let query = supabase.from('products').select(PRODUCT_SELECT).order('created_at', { ascending: false })
    if (me?.role !== 'ADMIN') query = query.eq('operator_id', userId)    // administrators see every stall
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return attachClimate(data)
  },

  async marketplace(params = {}) {
    let query = supabase
      .from('marketplace_listings')
      .select(LISTING_SELECT)
      .eq('listing_status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (params.crop_type) {
      query = query.eq('products.crop_type', params.crop_type)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    await attachClimate((data || []).map((l) => l.products))
    return data
  },

  /** One batch with its operator, plus its marketplace listing (if any). */
  async batch(id) {
    const { data: product, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!product) return { product: null, listing: null }
    await attachClimate([product])
    const { data: listing } = await supabase.from('marketplace_listings').select('*').eq('product_id', id).maybeSingle()
    return { product, listing: listing || null }
  },

  /** Operators / stalls, for naming the per-stall climate (admins can read every profile). */
  async stallProfiles() {
    const { data, error } = await supabase.from('profiles').select('id, full_name, stall_number')
    if (error) throw new Error(error.message)
    return data || []
  },

  /** DHT22 readings logged for a batch (about one per 5 minutes), newest first. */
  async sensorHistory(productId, limit = 50) {
    const { data, error } = await supabase
      .from('sensor_logs')
      .select('temperature_c, humidity_rh, vpd_value, recorded_at')
      .eq('product_id', productId)
      .order('recorded_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return data || []
  },

  /** Freshness history of a batch, newest first. */
  async batchHistory(id, limit = 30) {
    const { data, error } = await supabase
      .from('spoilage_predictions')
      .select('id, predicted_status, days_to_spoil, freshness_percent, created_at')
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return data || []
  },
}
