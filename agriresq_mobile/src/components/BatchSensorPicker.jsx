import { useEffect, useState } from 'react'
import { deviceApi, deviceFallbackName } from '../api/deviceApi'
import ErrorNotice from './ErrorNotice'

export default function BatchSensorPicker({ batchId, onSaved }) {
  const [configuration, setConfiguration] = useState(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    deviceApi.batchSensors(batchId)
      .then((result) => {
        if (!active) return
        setConfiguration(result)
        setSelected(String(result.sensor_id ?? ''))
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load available sensors.') })
    return () => { active = false }
  }, [batchId, reload])

  const save = async (event) => {
    event.preventDefault()
    if (saving || !configuration || selected === String(configuration.sensor_id ?? '')) return
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const result = await deviceApi.setBatchSensor(batchId, selected ? Number(selected) : null)
      setConfiguration((current) => ({ ...current, sensor_id: result.sensor_id }))
      setSaved(result.sensor_id ? 'Sensor linked to this batch.' : 'Automatic sensor monitoring restored.')
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not save the batch sensor.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="detail-section card batch-sensor" aria-labelledby="batch-sensor-title">
      <h3 id="batch-sensor-title">Storage sensor (DHT22)</h3>
      <ErrorNotice message={error} onRetry={!configuration ? () => { setError(''); setReload((n) => n + 1) } : undefined} />
      {!configuration && !error && <p className="muted" role="status">Loading sensors…</p>}
      {configuration && (configuration.sensors.length ? (
        <form onSubmit={save}>
          <div className="input-group">
            <label htmlFor="batch-sensor-choice">Sensor for this batch</label>
            <select id="batch-sensor-choice" value={selected} disabled={saving} onChange={(e) => {
              setSelected(e.target.value)
              setSaved('')
              setError('')
            }}>
              <option value="">Automatic (your stall’s sensors)</option>
              {configuration.sensors.map((sensor) => (
                <option key={sensor.id} value={sensor.id}>
                  {sensor.name || deviceFallbackName({ ...sensor, kind: 'SENSOR' })}
                  {sensor.stall_location && ` · ${sensor.stall_location}`}
                  {sensor.shared && ' · Shared'}
                  {!sensor.online && ' · Offline'}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-outline" disabled={saving || selected === String(configuration.sensor_id ?? '')}>
            {saving ? 'Saving…' : 'Save sensor'}
          </button>
          {saved && <p className="success-text" role="status">{saved}</p>}
        </form>
      ) : <p className="muted">No DHT22 sensors are available to your stall.</p>)}
    </section>
  )
}
