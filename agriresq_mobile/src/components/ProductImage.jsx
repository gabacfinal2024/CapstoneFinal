import { useState } from 'react'
import { Sprout } from 'lucide-react'
import { CROP_IMAGES, CROP_LABELS } from '../utils/helpers'
import './ProductImage.css'

// The operator's real photo; the stock picture only when there is none or it fails to load.
export default function ProductImage({ src, crop, className, alt }) {
  const [failedPhoto, setFailedPhoto] = useState(null)
  const [failedStockPhoto, setFailedStockPhoto] = useState(null)
  const stockPhoto = CROP_IMAGES[crop]
  // Old rows kept a backend-relative path.
  const photo = src && src !== failedPhoto && src !== stockPhoto && !src.startsWith('/media/') ? src : null
  const image = photo || (stockPhoto !== failedStockPhoto ? stockPhoto : null)
  const label = alt ?? CROP_LABELS[crop] ?? 'Produce'

  if (!image) {
    return (
      <span className={`product-image-placeholder ${className || ''}`} role={label ? 'img' : undefined}
        aria-label={label || undefined} aria-hidden={label ? undefined : true}>
        <Sprout size={32} aria-hidden="true" />
      </span>
    )
  }

  return (
    <img
      className={className}
      src={image}
      alt={label}
      loading="lazy"
      onError={() => photo ? setFailedPhoto(photo) : setFailedStockPhoto(stockPhoto)}
    />
  )
}
