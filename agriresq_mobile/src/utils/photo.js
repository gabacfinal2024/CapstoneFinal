// Product photos: shrink the operator's picture and keep it where every buyer can reach it.
// A phone/camera JPEG is 1-5 MB; listings only need ~900 px, so we resize before uploading.

export async function compressImage(file, maxSide = 900, quality = 0.8) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob || file
  } catch {
    return file // an odd format the browser cannot decode: send it as it is
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Returns a URL that works on every buyer's phone: the Supabase Storage public URL when the
 * `product-images` bucket exists (supabase/003_storage_product_images.sql), otherwise the
 * photo itself embedded in the product row (~50-120 KB after compression).
 */
export async function publishProductPhoto(supabase, file, userId) {
  const blob = await compressImage(file)
  try {
    const path = `${userId || 'anon'}/${Date.now()}.jpg`
    const { error } = await supabase.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
    if (!error) return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
    console.warn('Storage upload failed, embedding the photo instead:', error.message)
  } catch (err) {
    console.warn('Storage upload failed, embedding the photo instead:', err)
  }
  return blobToDataUrl(blob)
}

/**
 * Profile picture: a small square-ish JPEG. Uses the `avatars` bucket when it exists
 * (supabase/006_profile_avatar_and_locked_role.sql), otherwise embeds the picture in the profile row.
 */
export async function publishAvatar(supabase, file, userId) {
  const blob = await compressImage(file, 400, 0.8)
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
