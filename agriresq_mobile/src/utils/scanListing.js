const FIVE_HOURS = 5 * 60 * 60 * 1000

export function scanListingDeadline(scan) {
  if (!scan) return NaN
  return scan.listing_deadline ? Date.parse(scan.listing_deadline) : Date.parse(scan.created_at) + FIVE_HOURS
}

export function scanWindowOpen(scan, now = Date.now()) {
  return !!scan && !scan.listing_expired && now >= Date.parse(scan.created_at) && now < scanListingDeadline(scan)
}
