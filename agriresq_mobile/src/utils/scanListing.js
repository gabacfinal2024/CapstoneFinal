const FIVE_HOURS = 5 * 60 * 60 * 1000
export const BATCH_DEADLINE_EXPIRED = 'This scan has expired. Run a new scan to add a batch.'

export function scanListingDeadline(scan) {
  if (!scan) return NaN
  return scan.listing_deadline ? Date.parse(scan.listing_deadline) : Date.parse(scan.created_at) + FIVE_HOURS
}

export function scanWindowOpen(scan, now = Date.now()) {
  return !!scan && !scan.listing_expired && now >= Date.parse(scan.created_at) && now < scanListingDeadline(scan)
}

export function scanCanStartBatch(scan, now = Date.now()) {
  return scanWindowOpen(scan, now) && !scan.used_for_batch && !scan.is_listed
    && scan.detected === true && Boolean(scan.detected_crop) && !scan.crop_mismatch && !scan.low_confidence
}
