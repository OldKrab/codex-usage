import test from 'node:test'
import assert from 'node:assert/strict'
import { isLikelyTransientUsageGlitch, preserveTransientWindowRegressions } from '../usage-guard.mjs'

const usage = (usedPercent, resetAt) => ({ windows: [{ label: '5h', usedPercent: 20 }, { label: 'Week', usedPercent, resetAt }] })
const hour = 60 * 60 * 1000
const now = Date.parse('2026-07-09T18:00:00Z')
const resetAt = now + 24 * hour

test('rejects a weekly decrease inside the same quota window', () => {
  assert.equal(isLikelyTransientUsageGlitch(usage(5, resetAt), usage(1, resetAt), now), true)
})

test('rejects the observed 92 to 1 transient response', () => {
  assert.equal(isLikelyTransientUsageGlitch(usage(92, resetAt), usage(1, resetAt), now), true)
})

test('accepts monotonic weekly growth', () => {
  assert.equal(isLikelyTransientUsageGlitch(usage(5, resetAt), usage(6, resetAt), now), false)
})

test('accepts a decrease when the previous weekly window is resetting', () => {
  assert.equal(isLikelyTransientUsageGlitch(usage(92, now + 5 * 60 * 1000), usage(0, now + 7 * 24 * hour), now), false)
})

test('accepts a substantive weekly correction while keeping five-hour growth', () => {
  const previous = usage(14, resetAt)
  previous.windows[0].usedPercent = 91
  const next = usage(3, resetAt + hour)
  next.windows[0].usedPercent = 92

  const stable = preserveTransientWindowRegressions(previous, next, now)

  assert.equal(stable.windows.find(window => window.label === '5h').usedPercent, 92)
  assert.equal(stable.windows.find(window => window.label === 'Week').usedPercent, 3)
  assert.equal(stable.windows.find(window => window.label === 'Week').resetAt, resetAt + hour)
})

test('rejects a five-hour regression before reset', () => {
  const previous = usage(14, resetAt)
  previous.windows[0] = { label: '5h', usedPercent: 23, resetAt }
  const next = usage(15, resetAt)
  next.windows[0] = { label: '5h', usedPercent: 1, resetAt: resetAt + hour }

  const stable = preserveTransientWindowRegressions(previous, next, now)

  assert.equal(stable.windows.find(window => window.label === '5h').usedPercent, 23)
  assert.equal(stable.windows.find(window => window.label === 'Week').usedPercent, 15)
})

test('rejects a nonzero five-hour regression before reset', () => {
  const previous = usage(23, resetAt)
  previous.windows[0] = { label: '5h', usedPercent: 26, resetAt }
  const next = usage(24, resetAt)
  next.windows[0] = { label: '5h', usedPercent: 3, resetAt }

  const stable = preserveTransientWindowRegressions(previous, next, now)

  assert.equal(stable.windows.find(window => window.label === '5h').usedPercent, 26)
  assert.equal(stable.windows.find(window => window.label === 'Week').usedPercent, 24)
})

test('accepts a five-hour decrease after its reset', () => {
  const previous = usage(14, resetAt)
  previous.windows[0] = { label: '5h', usedPercent: 91, resetAt: now + 5 * 60 * 1000 }
  const next = usage(15, resetAt)
  next.windows[0] = { label: '5h', usedPercent: 1, resetAt: now + 5 * hour }

  const stable = preserveTransientWindowRegressions(previous, next, now)

  assert.equal(stable.windows.find(window => window.label === '5h').usedPercent, 1)
})

test('accepts an early five-hour rollover when the API advances the reset by most of a cycle', () => {
  const previous = usage(25, resetAt)
  previous.windows[0] = { label: '5h', usedPercent: 9, resetAt: now + 15 * 60 * 1000 }
  const next = usage(26, resetAt)
  next.windows[0] = { label: '5h', usedPercent: 4, resetAt: now + 4.5 * hour }

  const stable = preserveTransientWindowRegressions(previous, next, now)

  assert.equal(stable.windows.find(window => window.label === '5h').usedPercent, 4)
  assert.equal(stable.windows.find(window => window.label === '5h').resetAt, now + 4.5 * hour)
})
