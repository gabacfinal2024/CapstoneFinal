import { supabase } from '../lib/supabase'
import { deviceApi, isDetected, isSensor } from './deviceApi'
import { dealHistory } from './dealsApi'

/** Everything the Analytics page shows, computed from the operator's own data (nothing is hard-coded). */
export async function loadAnalytics() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const uid = session.user.id
  const { data: me } = await supabase.from('profiles').select('role').eq('id', uid).single()
  const everyone = me?.role === 'ADMIN'      // administrators see all stalls, operators only their own

  let listingsQ = supabase.from('marketplace_listings')
    .select('id, listed_price, listing_status, created_at, products:product_id (crop_type, quantity_kg), profiles:operator_id (full_name, email, stall_number)')
  let productsQ = supabase.from('products').select('id, crop_type, freshness_status, quantity_kg')
  if (!everyone) {
    listingsQ = listingsQ.eq('operator_id', uid)
    productsQ = productsQ.eq('operator_id', uid)
  }
  const [listingsRes, productsRes, dealsRes] = await Promise.all([
    listingsQ, productsQ,
    dealHistory().then((deals) => ({ deals, error: '' }), (err) => ({ deals: [], error: err.message })),
  ])
  if (listingsRes.error) throw new Error(listingsRes.error.message)
  if (productsRes.error) throw new Error(productsRes.error.message)

  // The camera backend may be offline; the marketplace numbers still work without it.
  let devices = []
  let scans = []
  let deviceError = ''
  try {
    devices = await deviceApi.list()
    scans = (await Promise.all(devices.map((d) => deviceApi.scans(d.id, 200)))).flat()
  } catch (err) {
    deviceError = err.message
  }
  return {
    listings: listingsRes.data || [], products: productsRes.data || [], devices, scans, deviceError,
    deals: dealsRes.deals, dealsError: dealsRes.error,
  }
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(filename, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function scansCsv(scans, devices) {
  const names = Object.fromEntries(devices.map((d) => [d.id, d.name]))
  downloadCsv('agriresq_scans.csv',
    ['id', 'time', 'device', 'source', 'detected', 'detected_crop', 'registered_crop', 'state', 'status', 'freshness_percent',
      'days_to_spoil', 'confidence', 'none_prob', 'low_confidence', 'crop_mismatch', 'operator_feedback'],
    scans.map((s) => [s.id, s.created_at, names[s.device_id] || s.device_id, s.source, isDetected(s), s.detected_crop, s.crop_type,
      s.state, s.freshness_status, s.freshness_percent, s.days_to_spoil, s.ml_confidence, s.none_prob, s.low_confidence,
      s.crop_mismatch, s.feedback_label]))
}

const REPORT_TIME_ZONE = 'Asia/Manila'
const reportClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function readingTime(reading) {
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(reading.time)) return reading.time
  const recordedAt = new Date(reading.created_at ?? reading.time ?? NaN)
  return Number.isNaN(recordedAt.getTime()) ? '' : reportClock.format(recordedAt)
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : ''
}

function metricStats(readings, key) {
  const values = readings
    .map((reading) => reading[key])
    .filter((value) => value != null && value !== '')
    .map(Number)
    .filter(Number.isFinite)
  return values.length ? [Math.min(...values), average(values), Math.max(...values)] : ['', '', '']
}

export async function readingsCsv(devices, reportDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error('Choose a valid report date.')

  const [year, month, day] = reportDate.split('-').map(Number)
  const dateCheck = new Date(Date.UTC(year, month - 1, day))
  if (dateCheck.getUTCFullYear() !== year || dateCheck.getUTCMonth() !== month - 1 || dateCheck.getUTCDate() !== day) {
    throw new Error('Choose a valid report date.')
  }
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 8 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const reportStatus = new Date() >= end ? 'FINAL' : 'PRELIMINARY'
  const results = await Promise.all(devices.filter(isSensor).map(async (device) => ({
    device,
    ...await deviceApi.dailyReport(device.id, reportDate),
  })))
  if (!results.some(({ readings }) => readings.length)) throw new Error('No saved sensor readings for this date.')

  const summaryHeader = [
    'device', 'status', 'readings_count', `hours_with_heat_index_at_or_above_${results[0].heat_index_threshold_c}_c`,
    'temperature_min_c', 'temperature_avg_c', 'temperature_max_c',
    'humidity_min_rh', 'humidity_avg_rh', 'humidity_max_rh',
    'vpd_min_kpa', 'vpd_avg_kpa', 'vpd_max_kpa',
  ]
  const summaryRows = results.map(({ device, readings, high_heat_index_hours: highHours }) => [
    device.name || `Sensor #${device.id}`, readings.length ? reportStatus : 'NO_READINGS', readings.length,
    highHours.join(', ') || (readings.length ? 'None recorded' : ''),
    ...metricStats(readings, 'temperature_c'),
    ...metricStats(readings, 'humidity_rh'),
    ...metricStats(readings, 'vpd_kpa'),
  ])
  const readingRows = results.flatMap(({ device, readings }) => readings.map((reading) => [
    device.name || `Sensor #${device.id}`, readingTime(reading), reading.temperature_c, reading.humidity_rh, reading.vpd_kpa,
  ]))

  downloadCsv(`agriresq_daily_sensor_report_${reportDate}.csv`, [`DAILY SENSOR SUMMARY (${REPORT_TIME_ZONE})`], [
    ['report_date', reportDate],
    summaryHeader,
    ...summaryRows,
    [],
    ['DETAILED READINGS'],
    ['device', 'time', 'temperature_c', 'humidity_rh', 'vpd_kpa'],
    ...readingRows,
  ])
}

/**
 * Rescue transactions with their actors. One row per completed deal (operator who sold + buyer who bought);
 * listings that have no completed deal (active, expired, cancelled) still appear with the operator and no buyer.
 */
export function rescuesCsv(listings, deals = []) {
  const header = ['listing_id', 'listing_status', 'listed_at', 'deal_date', 'crop', 'kg', 'total_php', 'price_per_kg_php',
    'operator_name', 'stall', 'operator_email', 'buyer_name', 'buyer_type', 'buyer_email']
  const dealsByListing = new Map()
  for (const d of deals) dealsByListing.set(d.listing_id, [...(dealsByListing.get(d.listing_id) || []), d])
  const known = new Set(listings.map((l) => l.id))

  const rows = []
  for (const l of listings) {
    const kg = Number(l.products?.quantity_kg) || 0
    const own = dealsByListing.get(l.id)
    if (own) {
      for (const d of own) {
        rows.push([l.id, l.listing_status, l.created_at, d.completed_at, d.crop_type, d.quantity_kg, d.total, d.price_per_kg,
          d.operator_name, d.stall_number, d.operator_email, d.buyer_name, d.buyer_type, d.buyer_email])
      }
    } else {
      const total = Number(l.listed_price) || 0
      rows.push([l.id, l.listing_status, l.created_at, '', l.products?.crop_type, kg, total, kg > 0 ? Math.round((total / kg) * 100) / 100 : '',
        l.profiles?.full_name, l.profiles?.stall_number, l.profiles?.email, '', '', ''])
    }
  }
  for (const d of deals) {
    if (known.has(d.listing_id)) continue
    rows.push([d.listing_id, d.listing_status, '', d.completed_at, d.crop_type, d.quantity_kg, d.total, d.price_per_kg,
      d.operator_name, d.stall_number, d.operator_email, d.buyer_name, d.buyer_type, d.buyer_email])
  }
  downloadCsv('agriresq_rescue_transactions.csv', header, rows)
}
