import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCursorPaceMetrics, buildCursorUsagePace, reconcileCursorPaceSamples } from '../cursor-pace.mjs'

const hour = 60 * 60 * 1000
const now = Date.parse('2026-08-14T12:00:00.000Z')

test('keeps Cursor usage samples bounded and avoids sampling every poll', () => {
  const first = reconcileCursorPaceSamples({
    current: { autoPercentUsed: 1, apiPercentUsed: 0 },
    now: now - hour,
  })
  const unchanged = reconcileCursorPaceSamples({
    storedSamples: first,
    current: { autoPercentUsed: 1, apiPercentUsed: 0 },
    now: now - hour + 30_000,
  })

  assert.deepEqual(unchanged, first)
})

test('resets pace history when a usage cycle resets', () => {
  const samples = reconcileCursorPaceSamples({
    storedSamples: [{ at: now - hour, autoPercentUsed: 80, apiPercentUsed: 2 }],
    current: { autoPercentUsed: 0.2, apiPercentUsed: 0 },
    now,
  })

  assert.deepEqual(samples, [{ at: now, autoPercentUsed: 0.2, apiPercentUsed: 0 }])
})

test('derives speed, schedule, forecast, and reset for a Cursor quota', () => {
  const metrics = buildCursorPaceMetrics({
    samples: [{ at: now - 2 * hour, autoPercentUsed: 1 }],
    currentPercent: 5,
    valueKey: 'autoPercentUsed',
    cycleStart: now - 10 * hour,
    resetAt: now + 20 * hour,
    now,
  })

  assert.equal(metrics.remainingPercent, 95)
  assert.ok(Math.abs(metrics.remainingTimePercent - 200 / 3) < 1e-12)
  assert.equal(metrics.actualRatePercentPerHour, 2)
  assert.equal(metrics.safeRatePercentPerHour, 4.75)
  assert.equal(metrics.rateMultiple, 8 / 19)
  assert.equal(metrics.projectedExhaustionHours, 47.5)
})

test('returns measuring state until enough recent history exists', () => {
  const usagePace = buildCursorUsagePace({
    usage: {
      billingCycleStart: now - hour,
      billingCycleEnd: now + 29 * hour,
      planUsage: { autoPercentUsed: 2, apiPercentUsed: 0 },
    },
    samples: [{ at: now - 30_000, autoPercentUsed: 1, apiPercentUsed: 0 }],
    now,
  })

  assert.equal(usagePace.cursorModels.actualRatePercentPerHour, null)
  assert.equal(usagePace.cursorModels.recentRateAvailable, false)
  assert.equal(usagePace.otherModels.actualRatePercentPerHour, null)
})

test('recommends spending the remaining quota evenly until reset', () => {
  const metrics = buildCursorPaceMetrics({
    samples: [],
    currentPercent: 40,
    valueKey: 'autoPercentUsed',
    cycleStart: now - 20 * hour,
    resetAt: now + 10 * hour,
    now,
  })

  assert.equal(metrics.safeRatePercentPerHour, 6)
})
