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

// In local development, a phone may open the Vite server through the laptop's LAN IP. Hosted builds and
// the APK use the configured backend URL, so sensors and apps use the same cloud API.
const pageHost = typeof window !== 'undefined' ? window.location.hostname : ''
const fromLaptop = import.meta.env.DEV && pageHost && !['localhost', '127.0.0.1', ''].includes(pageHost)
export const BACKEND_URL = fromLaptop
  ? `${window.location.protocol}//${pageHost}:8000`
  : import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'