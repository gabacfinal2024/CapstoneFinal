import assert from 'node:assert/strict'
import test from 'node:test'
import { backFallback, EXIT_WINDOW_MS, getBackAction } from '../src/utils/backNavigation.js'

const action = (overrides = {}) => getBackAction({
  pathname: '/home', hasPrevious: false, authenticated: true, android: true,
  exitDeadline: null, now: 5000, ...overrides,
})

test('the previous entry wins even when the current route is Home', () => {
  assert.equal(action({ pathname: '/devices/12/report', hasPrevious: true }), 'previous')
  assert.equal(action({ hasPrevious: true, exitDeadline: 6000 }), 'previous')
})

test('Android Home requires two taps less than two seconds apart', () => {
  assert.equal(action(), 'confirm')
  const exitDeadline = 5000 + EXIT_WINDOW_MS
  assert.equal(action({ exitDeadline, now: 6999 }), 'exit')
  assert.equal(action({ exitDeadline, now: 7000 }), 'confirm')
})

test('other screens and the web never close the Android app', () => {
  assert.equal(action({ pathname: '/messages', exitDeadline: 6000 }), 'fallback')
  assert.equal(action({ pathname: '/', authenticated: false }), 'stay')
  assert.equal(action({ android: false, exitDeadline: 6000 }), 'stay')
})

test('deep links have a parent screen even with empty app history', () => {
  assert.equal(backFallback('/devices/12/report', true), '/devices/12')
  assert.equal(backFallback('/devices/12', true), '/devices')
  assert.equal(backFallback('/chat/7', true), '/messages')
  assert.equal(backFallback('/forgot-password', false), '/login')
})
