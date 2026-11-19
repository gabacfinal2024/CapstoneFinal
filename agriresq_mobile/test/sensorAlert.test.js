import assert from 'node:assert/strict'
import test from 'node:test'
import { alertDeviceId, findAlertSensor } from '../src/utils/sensorAlert.js'

const front = { id: 12, name: 'Front sensor', product_id: 4 }
const back = { id: 13, name: 'Back sensor', product_id: 5 }

test('accepts saved sensor IDs from Supabase as numbers or strings', () => {
  assert.equal(alertDeviceId({ device_id: 12 }), '12')
  assert.equal(alertDeviceId({ device_id: '12' }), '12')
  assert.equal(alertDeviceId({ device_id: 'undefined' }), null)
})

test('resolves a legacy alert by its exact device name or linked batch', () => {
  assert.equal(findAlertSensor({ message: 'Back sensor: humidity is rising' }, [front, back]), back)
  assert.equal(findAlertSensor({ product_id: '4' }, [front, back]), front)
})

test('recovers stale IDs without selecting the unavailable sensor again', () => {
  const alert = { device_id: 12, message: 'Front sensor: temperature is high' }
  const replacement = { ...front, id: 14 }
  assert.equal(findAlertSensor(alert, [front, back]), null)
  assert.equal(findAlertSensor(alert, [front, back, replacement]), replacement)
})

test('uses a single sensor for an unnamed legacy alert and leaves ambiguous alerts to the device list', () => {
  assert.equal(findAlertSensor({ message: 'High temperature' }, [front]), front)
  assert.equal(findAlertSensor({ message: 'Removed sensor: temperature is high' }, [front]), null)
  assert.equal(findAlertSensor({ message: 'High temperature' }, [front, back]), null)
  assert.equal(findAlertSensor({ message: 'Front sensor: temperature is high' }, [front, { ...front, id: 14 }]), null)
})
