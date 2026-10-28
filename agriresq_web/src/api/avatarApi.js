import { supabase } from '../lib/supabase'

// Profile picture helpers. The picture lives in profiles.avatar_url (column added by
// supabase/009_deals_avatars_admin_listings.sql). Until that SQL has been run, the picture is
// kept in this browser (localStorage) so it still shows in the sidebar and survives a reload.

export const PROFILE_EVENT = 'agriresq:profile-updated'
const cacheKey = (userId) => `agriresq_avatar_${userId}`

export function cachedAvatar(userId) {
  try { return localStorage.getItem(cacheKey(userId)) || null } catch { return null }
}

function cacheAvatar(userId, url) {
  try {
    if (url) localStorage.setItem(cacheKey(userId), url)
    else localStorage.removeItem(cacheKey(userId))
  } catch { /* storage full or blocked: the picture just will not be remembered offline */ }
}

/** Tell the rest of the app (Sidebar) that the signed-in user's name / picture changed. */
export function announceProfile(patch) {
  try {
    const stored = JSON.parse(localStorage.getItem('agriresq_current_user') || '{}')
    localStorage.setItem('agriresq_current_user', JSON.stringify({ ...stored, ...patch }))
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: patch }))
}

/** Center-crop to a square and shrink to ~400px JPEG. */
async function compressAvatar(file, size = 400, quality = 0.8) {
  try {
    const bitmap = await createImageBitmap(file)
    const side = Math.min(bitmap.width, bitmap.height)
    const out = Math.min(size, side)
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob || file
  } catch {
    return file
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Storage public URL when the `avatars` bucket exists, otherwise the picture embedded as a data URL. */
async function publishAvatar(file, userId) {
  const blob = await compressAvatar(file)
  try {
    const path = `${userId}/avatar-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
    if (!error) return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
    console.warn('Avatar upload failed, embedding the picture instead:', error.message)
  } catch (err) {
    console.warn('Avatar upload failed, embedding the picture instead:', err)
  }
  return blobToDataUrl(blob)
}

/**
 * Compress + upload + save a new profile picture.
 * Resolves { url, saved, warning }: `saved` is false when profiles.avatar_url could not be written
 * (SQL 009 not run yet); the picture is then only remembered in this browser.
 */
export async function uploadAvatar(file) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('Choose an image file (JPG or PNG).')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in. Please log in again.')
  const userId = session.user.id

  const url = await publishAvatar(file, userId)
  cacheAvatar(userId, url)
  announceProfile({ avatar_url: url })

  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
  if (error) {
    const missing = /avatar_url|schema cache|column/i.test(error.message || '')
    return {
      url,
      saved: false,
      warning: missing
        ? 'Picture shown on this browser only. Ask the developer to run supabase/009_deals_avatars_admin_listings.sql so it is saved to your account.'
        : `Picture shown on this browser only; saving to your account failed: ${error.message}`,
    }
  }
  return { url, saved: true, warning: '' }
}
