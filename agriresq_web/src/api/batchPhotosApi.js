import { supabase } from '../lib/supabase'
import { BACKEND_URL } from './deviceApi'

/** Camera pictures taken of one batch, newest first. Throws a readable Error when the backend is offline. */
export async function batchPhotos(productId, timeoutMs = 60000) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in. Please log in again.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${BACKEND_URL}/api/batches/${encodeURIComponent(productId)}/photos/`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    })
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? 'The camera backend took too long to answer.'
      : `Cannot reach the camera backend at ${BACKEND_URL}. Is the Django server running?`, { cause: err })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let detail = ''
    try { const body = await res.json(); detail = body.detail || body.error || body.message || '' } catch { /* not JSON */ }
    if (res.status === 404) throw new Error(detail || 'The camera backend has no photo endpoint for this batch (update and restart the Django server).')
    if (res.status === 401 || res.status === 403) throw new Error(detail || 'The camera backend rejected this session.')
    throw new Error(detail || `Camera backend error ${res.status}`)
  }

  const body = await res.json()
  const list = Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : []
  return list.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

const absolute = (src) => (src && src.startsWith('/') ? `${BACKEND_URL}${src}` : src || null)

/** Picture to show for a scan (annotated image first, raw capture as a fallback). */
export const photoSrc = (scan) => absolute(scan?.image_url) || absolute(scan?.raw_image_url) || null
