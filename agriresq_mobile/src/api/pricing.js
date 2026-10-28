/** Dynamic pricing & auto-discount rules (panel requirements) */
export const DISCOUNT_RULES = {
  GREEN: 0,
  AMBER: 30,
  RED: 100,
}

export function computeDynamicPrice(basePricePerKg, quantityKg, freshnessStatus, autoDiscountEnabled = true) {
  const base = Number(basePricePerKg) || 0
  const qty = Number(quantityKg) || 0
  let discount = 0
  if (autoDiscountEnabled) {
    discount = DISCOUNT_RULES[freshnessStatus] ?? 0
  }
  const currentPerKg = base * (1 - discount / 100)
  return {
    discount_percent: discount,
    current_price_per_kg: Math.round(currentPerKg * 100) / 100,
    total_price: Math.round(currentPerKg * qty * 100) / 100,
    listed_price: Math.round(currentPerKg * qty * 100) / 100,
  }
}

export function statusFromPercent(percent) {
  if (percent <= 0) return 'RED'
  if (percent < 60) return 'AMBER'
  return 'GREEN'
}

// Same numbers as the backend rule engine (agriresq_core/api/spoilage_engine.py)
const CROPS = {
  EGGPLANT: { base: 5, q10: 2.5, minRh: 85, chillingBelow: 10 },
  CUCUMBER: { base: 4, q10: 2.5, minRh: 85, chillingBelow: 10 },
  CARROT: { base: 7, q10: 2.2, minRh: 75, chillingBelow: -99 },
}
export const BASELINE_SHELF_DAYS = Object.fromEntries(Object.entries(CROPS).map(([k, v]) => [k, v.base]))
// Market conditions assumed when no sensor reading exists (backend: ASSUMED_STALL_TEMP_C / ASSUMED_STALL_RH)
export const ASSUMED_STALL = { temp: 29, rh: 80 }

/** Days of shelf life that one real day uses up at this temperature / humidity (1 = baseline at 25 C). */
const svp = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3))                  // kPa, Tetens
export const vpd = (t, rh) => Math.max(svp(t) * (1 - Math.min(Math.max(rh, 0), 100) / 100), 0)

export function agingRate(crop, temp = ASSUMED_STALL.temp, rh = ASSUMED_STALL.rh) {
  const c = CROPS[crop] ?? CROPS.EGGPLANT
  let rate = c.q10 ** ((temp - 25) / 10)
  if (temp < 25) rate = temp < c.chillingBelow ? 1 : Math.max(rate, 0.5)
  // water loss follows the vapour-pressure deficit above the crop's threshold (VPD at 25 C and its minimum RH)
  const excess = vpd(temp, rh) - vpd(25, c.minRh)
  if (excess > 0) rate += excess * 0.63
  rate = Math.min(rate, 5)
  const heat = Math.max(temp - 25, 0) * 0.00125 * 24          // small extra penalty for sustained heat (CHU, degree-hours)
  return rate + heat
}

/** Traffic light from the remaining days: 0 or less = Rotten, under 3 days = At-Risk, else Fresh. */
export function statusFromDays(days) {
  if (days <= 0) return 'RED'
  if (days < 3) return 'AMBER'
  return 'GREEN'
}

const SEVERITY = { GREEN: 0, AMBER: 1, RED: 2 }
export const worseStatus = (a, b) => (SEVERITY[a] >= SEVERITY[b] ? a : b)

/** Days left of a batch harvested at `harvest`, aged at the stall's conditions until now. An estimate. */
export function daysLeftSinceHarvest(crop, harvest, now = Date.now()) {
  const baseline = BASELINE_SHELF_DAYS[crop] ?? 5
  const ageDays = Math.max(0, (now - new Date(harvest).getTime()) / 86400000)
  const days = Math.max(0, Math.round((baseline - ageDays * agingRate(crop)) * 100) / 100)
  return { days, baseline, percent: Math.round((days / baseline) * 100) }
}
