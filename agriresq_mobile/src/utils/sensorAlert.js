export function alertDeviceId(alert) {
  const id = String(alert.device_id ?? '')
  return /^[1-9][0-9]*$/.test(id) ? id : null
}

// Older alerts only saved the device name in the message and sometimes a linked batch ID.
export function findAlertSensor(alert, sensors) {
  const unavailableId = alertDeviceId(alert)
  const candidates = sensors.filter((sensor) => String(sensor.id) !== unavailableId)
  const message = alert.message || ''
  const named = candidates.filter((sensor) => sensor.name && message.startsWith(`${sensor.name}: `))
  const matches = named.length ? named : candidates
  const linked = matches.filter((sensor) => (
    alert.product_id != null && String(sensor.product_id) === String(alert.product_id)
  ))
  if (linked.length === 1) return linked[0]
  if (named.length === 1) return named[0]
  // Without a saved device ID, an alert that names a removed sensor is ambiguous.
  if (!unavailableId && !message.includes(': ') && candidates.length === 1) return candidates[0]
  return null
}
