import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldNotifyBurnRateTransition } from '../src/lib/burn-rate-notification.ts'

test('notifies when usage transitions into fast', () => {
  assert.equal(shouldNotifyBurnRateTransition('ok', 'fast', false), true)
})

test('does not notify when usage returns to normal', () => {
  assert.equal(shouldNotifyBurnRateTransition('fast', 'ok', false), false)
})

test('does not notify when usage becomes slow', () => {
  assert.equal(shouldNotifyBurnRateTransition('ok', 'slow', false), false)
})

test('does not notify on the first dashboard load', () => {
  assert.equal(shouldNotifyBurnRateTransition(null, 'fast', true), false)
})

test('does not notify when status has not changed', () => {
  assert.equal(shouldNotifyBurnRateTransition('fast', 'fast', false), false)
})
