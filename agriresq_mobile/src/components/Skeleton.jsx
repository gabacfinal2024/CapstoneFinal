import './Skeleton.css'

/** Grey shimmer placeholder shown while data loads. */
export default function Skeleton({ height = 16, width = '100%', radius = 8, className = '', style }) {
  return <span className={`skeleton ${className}`} style={{ height, width, borderRadius: radius, ...style }} aria-hidden="true" />
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card skeleton-card" role="status" aria-label="Loading">
      <div className="skeleton-card__top">
        <Skeleton width={44} height={44} radius={12} />
        <div className="skeleton-card__text">
          <Skeleton height={14} width="60%" />
          <Skeleton height={11} width="40%" />
        </div>
      </div>
      {Array.from({ length: lines - 1 }).map((_, i) => <Skeleton key={i} height={12} width={i % 2 ? '70%' : '95%'} />)}
    </div>
  )
}
