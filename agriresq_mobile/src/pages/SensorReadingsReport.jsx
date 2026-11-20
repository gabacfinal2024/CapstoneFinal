import PageTitle from '../components/PageTitle'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { ArrowLeft, Download } from 'lucide-react'
import { BackLink } from '../context/BackNavigationContext'
import { useAuth } from '../context/AuthContext'
import { canOperate, deviceApi, deviceFallbackName, isSensor } from '../api/deviceApi'
import { api } from '../api/supabaseApi'
import useEntryState from '../hooks/useEntryState'
import usePolling from '../hooks/usePolling'
import ErrorNotice from '../components/ErrorNotice'
import { SkeletonCard } from '../components/Skeleton'
import StallClimateCard from '../components/StallClimateCard'
import '../styles/devices.css'
import './SensorReadingsReport.css'

const CsvExport = registerPlugin('CsvExport')
const READING_PAGE_SIZE = 24

const fmt = (n, digits = 1) => (Number.isFinite(Number(n)) && n != null ? Number(n).toFixed(digits) : '—')

function manilaDateInputValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function average(readings, key) {
  const values = readings.map((reading) => reading[key])
    .filter((value) => value != null && value !== '').map(Number).filter(Number.isFinite)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

async function downloadDailyReport({ date, report, device, stallNumber }) {
  const name = device.name || deviceFallbackName(device)
  const { readings, high_heat_index_hours: highHours, heat_index_threshold_c: threshold } = report
  const rows = [
    ['DAILY DHT22 REPORT', 'Asia/Manila'],
    ['report_date', date],
    ['stall_number', 'stall_location', 'device', 'readings_count', 'average_temperature_c', 'average_humidity_rh', 'average_vpd_kpa',
      `hours_with_heat_index_at_or_above_${threshold}_c`],
    [stallNumber, device.stall_location || '', name, readings.length,
      average(readings, 'temperature_c'), average(readings, 'humidity_rh'), average(readings, 'vpd_kpa'),
      highHours.join(', ') || 'None recorded'],
    [],
    ['READINGS'],
    ['time', 'temperature_c', 'humidity_rh', 'vpd_kpa'],
    ...readings.map((reading) => [reading.time, reading.temperature_c, reading.humidity_rh, reading.vpd_kpa]),
  ]
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const filename = `agriresq-dht22-${stallNumber || 'stall'}-${date}.csv`
  if (Capacitor.getPlatform() === 'android') {
    return CsvExport.save({ filename, content })
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function SensorReadingsReport() {
  const { id } = useParams()
  return <ReportPage key={id} id={id} />
}

function ReportPage({ id }) {
  const { user } = useAuth()
  const [device, setDevice] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [crops, setCrops] = useState([])
  const [reportDate, setReportDate] = useEntryState('reportDate', manilaDateInputValue())
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportVersion, setReportVersion] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [ownerStallDetails, setOwnerStallDetails] = useState(null)
  const [readingLimit, setReadingLimit] = useState(READING_PAGE_SIZE)
  const sensor = isSensor(device) && canOperate(device)

  const loadDevice = async () => {
    try {
      const data = await deviceApi.device(id)
      setDevice(data)
      setLoadError(isSensor(data) && canOperate(data) ? '' : 'A sensor node is needed to view this report.')
    } catch (err) {
      setLoadError(err.message || 'Could not load the sensor.')
      if (err.status === 403 || err.status === 404) setDevice(null)
    }
  }
  usePolling(loadDevice, 5000)

  useEffect(() => {
    if (!device?.operator_id || device.operator_id !== user?.id) return undefined
    let cancelled = false
    api.batches().then((batches) => {
      if (!cancelled) setCrops((batches || []).map((batch) => batch.crop_type))
    }).catch(() => { if (!cancelled) setCrops([]) })
    return () => { cancelled = true }
  }, [device?.operator_id, user?.id])

  const latestReadingId = reportDate === manilaDateInputValue() ? device?.latest_reading?.id : null
  const dailyReport = report?.date === reportDate ? report.data : null
  const dailyReadings = dailyReport?.readings || []

  useEffect(() => {
    if (!sensor || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return undefined
    let cancelled = false
    setReportLoading(true)
    setReportError('')
    deviceApi.dailyReport(id, reportDate, { details: true })
      .then((data) => { if (!cancelled) setReport({ date: reportDate, data }) })
      .catch((err) => { if (!cancelled) setReportError(err.message || 'Could not load the daily report.') })
      .finally(() => { if (!cancelled) setReportLoading(false) })
    return () => { cancelled = true }
  }, [id, reportDate, sensor, latestReadingId, reportVersion])

  useEffect(() => {
    if (!device?.operator_id) return undefined
    let cancelled = false
    api.operatorStallDetails(device.operator_id)
      .then((details) => { if (!cancelled) setOwnerStallDetails(details) })
      .catch(() => { if (!cancelled) setOwnerStallDetails(null) })
    return () => { cancelled = true }
  }, [device?.operator_id])

  const stallNumber = ownerStallDetails?.stall_number || (device?.operator_id === user?.id ? user?.stall_number : '') || ''
  const stallLabel = stallNumber ? `Stall ${stallNumber}` : (device?.stall_location || 'Stall number unavailable')
  const avgTemperature = average(dailyReadings, 'temperature_c')
  const avgHumidity = average(dailyReadings, 'humidity_rh')
  const avgVpd = average(dailyReadings, 'vpd_kpa')

  const exportReport = async () => {
    setExporting(true)
    setExportError('')
    try {
      const report = await deviceApi.dailyReport(id, reportDate, { details: true })
      if (!report.readings.length) throw new Error('No saved readings for this date.')
      await downloadDailyReport({ date: reportDate, report, device, stallNumber })
    } catch (err) {
      setExportError(err.message || 'Could not save the sensor report.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app-shell">
      <main className="page page-no-nav sensor-report">
        <BackLink to={`/devices/${id}`} className="dev-back"><ArrowLeft size={16} /> Back</BackLink>
        <header className="page-title-header">
          <PageTitle>Sensor Readings Report</PageTitle>
          {device && <p className="dev-subtitle">{device.name || deviceFallbackName(device)}</p>}
        </header>

        <ErrorNotice message={loadError} onRetry={loadDevice} />
        {!device && !loadError && <SkeletonCard lines={5} />}
        {sensor && (
          <>
            <StallClimateCard crops={crops} operatorId={device.operator_id} />
            <section className="card daily-report">
              <div className="daily-report__head">
                <div>
                  <h2>Daily summary</h2>
                  <p>{stallLabel} · averages and saved readings</p>
                </div>
                <label htmlFor="sensor-report-date">Report date</label>
              </div>
              <div className="daily-report__controls">
                <input id="sensor-report-date" type="date" value={reportDate} max={manilaDateInputValue()}
                  disabled={exporting} onChange={(event) => {
                    setReportDate(event.target.value)
                    setReadingLimit(READING_PAGE_SIZE)
                    setExportError('')
                    setReportError('')
                  }} />
                <button type="button" className="btn btn-green" onClick={exportReport}
                  disabled={exporting || reportLoading || !!reportError || !dailyReadings.length}>
                  <Download size={16} /> {exporting ? 'Saving…' : 'Download CSV'}
                </button>
              </div>
              {exportError && <p className="daily-report__message" role="alert">{exportError}</p>}
              {reportError ? (
                <ErrorNotice message={reportError} onRetry={() => setReportVersion((version) => version + 1)} />
              ) : (
                <div className="daily-report__averages" aria-live="polite">
                  <div><span>Temperature avg</span><strong>{reportLoading ? 'Loading…' : `${fmt(avgTemperature)}${avgTemperature != null ? '°C' : ''}`}</strong></div>
                  <div><span>Average humidity</span><strong>{reportLoading ? 'Loading…' : avgHumidity == null ? '—' : `${fmt(avgHumidity)}% RH`}</strong></div>
                  <div><span>Average VPD</span><strong>{reportLoading ? 'Loading…' : avgVpd == null ? '—' : `${fmt(avgVpd, 2)} kPa`}</strong></div>
                  <div><span>High heat index hours</span><strong>{reportLoading ? 'Loading…' : dailyReport?.high_heat_index_hours.length ?? '—'}</strong></div>
                  {!reportLoading && dailyReadings.length > 0 && (
                    <p>Hours with a reading at or above {dailyReport.heat_index_threshold_c}°C heat index: {dailyReport.high_heat_index_hours.join(', ') || 'None recorded'}</p>
                  )}
                  <p>{reportLoading ? 'Loading readings…' : dailyReadings.length
                    ? `${dailyReadings.length} saved reading${dailyReadings.length === 1 ? '' : 's'} for this day`
                    : 'No saved readings for this date.'}</p>
                </div>
              )}
              {dailyReadings.length > 0 && (
                <details className="report-readings">
                  <summary>View saved readings</summary>
                  <table>
                    <thead><tr><th scope="col">Time</th><th scope="col">Temp.</th><th scope="col">Humidity</th><th scope="col">VPD</th></tr></thead>
                    <tbody>
                      {dailyReadings.slice(-readingLimit).reverse().map((reading, index) => (
                        <tr key={`${reading.time}-${index}`}>
                          <td>{reading.time}</td>
                          <td>{fmt(reading.temperature_c)}°C</td>
                          <td>{reading.humidity_rh == null ? '—' : `${fmt(reading.humidity_rh, 0)}%`}</td>
                          <td>{reading.vpd_kpa == null ? '—' : `${fmt(reading.vpd_kpa, 2)} kPa`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {readingLimit < dailyReadings.length && (
                    <button type="button" className="btn btn-ghost"
                      onClick={() => setReadingLimit((limit) => limit + READING_PAGE_SIZE)}>Show more readings</button>
                  )}
                </details>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
