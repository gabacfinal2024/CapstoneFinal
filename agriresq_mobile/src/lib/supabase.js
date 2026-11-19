import { createClient } from '@supabase/supabase-js'

// Project defaults (can be overridden via VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://yyrmuaocpnrlkeedwpzx.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vSgs7UPknvfBsjXvrEtk0Q_Nh7m7I1-'
// Supabase REST endpoint (useful for direct REST calls)
export const SUPABASE_REST_URL = import.meta.env.VITE_SUPABASE_REST_URL || 'https://yyrmuaocpnrlkeedwpzx.supabase.co/rest/v1/'

if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('Using default Supabase anon key from integration settings. Set VITE_SUPABASE_ANON_KEY in .env to override.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// In local development, a phone may open the Vite dev server through the laptop's LAN IP. For the APK and
// packaged builds, the backend should not silently fall back to localhost because the device will always
// resolve that to itself. Prefer the explicit Vite env, then the laptop's LAN IP in dev, and finally the
// hosted API used by the production app.
const pageHost = typeof window !== 'undefined' ? window.location.hostname : ''
const fromLaptop = import.meta.env.DEV && pageHost && !['localhost', '127.0.0.1', '0.0.0.0', ''].includes(pageHost)
export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || (fromLaptop ? `${window.location.protocol}//${pageHost}:8000` : 'https://agriresq.onrender.com')).replace(/\/$/, '')