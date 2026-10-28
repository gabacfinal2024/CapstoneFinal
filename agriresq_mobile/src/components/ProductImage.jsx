import { useState } from 'react'
import { CROP_IMAGES, CROP_LABELS } from '../utils/helpers'

// The operator's real photo; the stock picture only when there is none or it fails to load.
export default function ProductImage({ src, crop, className, alt }) {
  const [failed, setFailed] = useState(false)
  const usable = src && !failed && !src.startsWith('/media/')   // old rows kept a backend-relative path
  return (
    <img
      className={className}
      src={usable ? src : CROP_IMAGES[crop]}
      alt={alt ?? CROP_LABELS[crop] ?? 'Produce'}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
