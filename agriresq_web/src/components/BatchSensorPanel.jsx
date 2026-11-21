import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deviceApi } from '../api/deviceApi'

function sensorName(sensor) {
  return [
    sensor.name || `DHT22 #${sensor.id}`,
    sensor.stall_location,
    sensor.shared && 'Shared',
    !sensor.online && 'Offline',
  ].filter(Boolean).join(' · ')
}

export default function BatchSensorPanel({ batchId, blocked, onSaved }) {
  const [config, setConfig] = useState(null)
  const [selection, setSelection] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (blocked) return undefined
    let active = true
    deviceApi.batchSensors(batchId).then((result) => {
      if (!active) return
      setConfig(result)
      setSelection(String(result.sensor_id ?? ''))
    }).catch((err) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [batchId, blocked, retry])

  const unchanged = selection === String(config?.sensor_id ?? '')
  const assigned = config?.sensors.find((sensor) => sensor.id === config.sensor_id)
  const save = async (event) => {
    event.preventDefault()
    if (!config || unchanged || saving || blocked) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { sensor_id } = await deviceApi.setBatchSensor(batchId, selection ? Number(selection) : null)
      setConfig((current) => ({ ...current, sensor_id }))
      setSelection(String(sensor_id ?? ''))
      setNotice(sensor_id === null ? 'Automatic monitoring restored.' : 'Sensor saved for this batch.')
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="batch-storage-sensor" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div>
        <h2 id="batch-storage-sensor" className="text-base font-bold text-slate-800">Storage sensor (DHT22)</h2>
        {blocked
          ? <p className="mt-1 text-sm text-slate-500">{blocked}</p>
          : <p className="mt-1 text-sm text-slate-500">Choose a sensor this batch’s stall owns or has access to.</p>}
      </div>
      {!blocked && (
        <>
          {!config && !error && <p role="status" className="text-sm text-slate-500">Loading sensors…</p>}
          {config && (config.sensors.length ? (
            <form onSubmit={save} className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1 text-sm font-semibold text-slate-700">
                Sensor for this batch
                <select value={selection} disabled={saving} onChange={(event) => {
                  setSelection(event.target.value)
                  setNotice('')
                  setError('')
                }} className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700">
                  <option value="">Automatic (stall’s own sensors)</option>
                  {config.sensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensorName(sensor)}</option>)}
                </select>
              </label>
              <button type="submit" disabled={saving || unchanged} className="min-h-11 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">
                {saving ? 'Saving…' : 'Save sensor'}
              </button>
            </form>
          ) : <p className="text-sm text-slate-500">This stall has no DHT22 sensors available.</p>)}
          {assigned && <Link to={`/devices/${assigned.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-700 hover:underline">Open linked sensor</Link>}
          {notice && <p role="status" className="text-sm font-medium text-emerald-700">{notice}</p>}
          {error && (
            <div role="alert" className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
              {error}
              {!config && <button type="button" className="ml-2 font-bold underline" onClick={() => { setError(''); setRetry((n) => n + 1) }}>Try again</button>}
            </div>
          )}
        </>
      )}
    </section>
  )
}
