import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://yyrmuaocpnrlkeedwpzx.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vSgs7UPknvfBsjXvrEtk0Q_Nh7m7I1-'

if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('Using default Supabase ANON key. Set VITE_SUPABASE_ANON_KEY in .env to override.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
