import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateRemainingTimePercent, calculateUsageRate, getLatestMonotonicSegment, isUsageRateAvailable, projectExhaustionHours, reconcilePaceSamples, shouldResetPaceSamples } from '../pace-window.mjs'

const hour = 60 * 60 * 1000
const now = Date.parse('2026-07-09T18:00:00Z')
const elapsedHours = (from, to) => (to - from) / hour

test('calculates recent pace from the last three active hours', () => {
  const result = calculateUsageRate({
    samples: [
      { at: now - 4 * hour, weekPercent: 0 },
      { at: now - 3 * hour, weekPercent: 1 },
      { at: now - 2 * hour, weekPercent: 3 },
    ],
    now,
    currentWeekPercent: 7,
    targetHours: 3,
    elapsedHours,
  })

  assert.deepEqual(result, {
    ratePercentPerHour: 2,
    elapsedHours: 3,
    spentPercent: 6,
    warmingUp: false,
  })
})

test('marks the rate as warming up when less than three active hours are available', () => {
  const result = calculateUsageRate({
    samples: [{ at: now - 2 * hour, weekPercent: 2 }],
    now,
    currentWeekPercent: 5,
    targetHours: 3,
    elapsedHours,
  })

  assert.deepEqual(result, {
    ratePercentPerHour: 1.5,
    elapsedHours: 2,
    spentPercent: 3,
    warmingUp: true,
  })
})

test('calculates a one-hour pace for the five-hour quota window', () => {
  const result = calculateUsageRate({
    samples: [
      { at: now - 2 * hour, weekPercent: 40 },
      { at: now - 1 * hour, weekPercent: 55 },
    ],
    now,
    currentWeekPercent: 70,
    targetHours: 1,
    elapsedHours,
  })

  assert.deepEqual(result, {
    ratePercentPerHour: 15,
    elapsedHours: 1,
    spentPercent: 15,
    warmingUp: false,
  })
})

test('starts five-hour pace samples after the latest quota reset', () => {
  const samples = [
    { at: now - 2 * hour, weekPercent: 91 },
    { at: now - hour, weekPercent: 91 },
    { at: now, weekPercent: 22 },
  ]

  assert.deepEqual(getLatestMonotonicSegment(samples), [samples[2]])
})

test('hides a rate calculated from less than five minutes', () => {
  assert.equal(isUsageRateAvailable(0.05), false)
})

test('publishes a rate after five minutes', () => {
  assert.equal(isUsageRateAvailable(1 / 12), true)
})

test('recovers a truncated stored pace window from accepted history', () => {
  const result = reconcilePaceSamples({
    storedSamples: [
      { at: now - 10 * 60_000, weekPercent: 6 },
      { at: now - 9 * 60_000, weekPercent: 7 },
    ],
    historySamples: [
      { at: now - 3 * hour, weekPercent: 5 },
      { at: now - 2 * hour, weekPercent: 5 },
      { at: now - hour, weekPercent: 6 },
    ],
    now,
    cycleStart: now - 7 * 24 * hour,
    currentPercent: 7,
    previousRawPercent: 7,
    currentRawPercent: 7,
  })

  assert.equal(result[0].at, now - 3 * hour)
  assert.equal(result.at(-1).weekPercent, 7)
})

test('drops pre-reset history when the raw weekly counter decreases', () => {
  const result = reconcilePaceSamples({
    storedSamples: [
      { at: now - 2 * hour, weekPercent: 92 },
      { at: now - hour, weekPercent: 94 },
    ],
    historySamples: [
      { at: now - 3 * hour, weekPercent: 90 },
      { at: now - 5 * 60_000, weekPercent: 2 },
    ],
    now,
    cycleStart: now - 7 * 24 * hour,
    currentPercent: 2,
    previousRawPercent: 94,
    currentRawPercent: 2,
  })

  assert.deepEqual(result, [{ at: now, weekPercent: 2 }])
})

test('does not reintroduce stored samples from before the latest historical reset', () => {
  const result = reconcilePaceSamples({
    storedSamples: [{ at: now - 4 * hour, weekPercent: 95 }],
    historySamples: [
      { at: now - 3 * hour, weekPercent: 96 },
      { at: now - 2 * hour, weekPercent: 1 },
      { at: now - hour, weekPercent: 2 },
    ],
    now,
    currentPercent: 2,
  })

  assert.deepEqual(result.map(sample => sample.weekPercent), [1, 2, 2])
})

test('drops pace history when the reset boundary advances even before raw usage falls', () => {
  const result = reconcilePaceSamples({
    storedSamples: [{ at: now - hour, weekPercent: 99 }],
    historySamples: [{ at: now - 2 * hour, weekPercent: 98 }],
    now,
    currentPercent: 99,
    previousRawPercent: 99,
    currentRawPercent: 99,
    resetConfirmed: true,
  })

  assert.deepEqual(result, [{ at: now, weekPercent: 99 }])
})

test('does not append duplicate pace samples inside the sampling interval', () => {
  const lastAt = now - 30_000
  const result = reconcilePaceSamples({
    storedSamples: [{ at: lastAt, weekPercent: 7 }],
    now,
    currentPercent: 7,
    previousRawPercent: 7,
    currentRawPercent: 7,
  })

  assert.deepEqual(result, [{ at: lastAt, weekPercent: 7 }])
})

test('appends a material usage change even inside the sampling interval', () => {
  const lastAt = now - 30_000
  const result = reconcilePaceSamples({
    storedSamples: [{ at: lastAt, weekPercent: 6 }],
    now,
    currentPercent: 7,
    previousRawPercent: 7,
    currentRawPercent: 7,
  })

  assert.deepEqual(result, [
    { at: lastAt, weekPercent: 6 },
    { at: now, weekPercent: 7 },
  ])
})

test('appends an unchanged sample after the sampling interval', () => {
  const lastAt = now - 60_000
  const result = reconcilePaceSamples({
    storedSamples: [{ at: lastAt, weekPercent: 7 }],
    now,
    currentPercent: 7,
    previousRawPercent: 7,
    currentRawPercent: 7,
  })

  assert.equal(result.at(-1).at, now)
})

test('filters samples outside the current quota cycle and future samples', () => {
  const cycleStart = now - 7 * 24 * hour
  const result = reconcilePaceSamples({
    storedSamples: [
      { at: cycleStart - 1, weekPercent: 90 },
      { at: cycleStart, weekPercent: 1 },
      { at: now + 1, weekPercent: 99 },
    ],
    now,
    cycleStart,
    currentPercent: 2,
  })

  assert.deepEqual(result.map(sample => sample.weekPercent), [1, 2])
})

test('ignores malformed pace samples', () => {
  const result = reconcilePaceSamples({
    storedSamples: [
      { at: 'nope', weekPercent: 4 },
      { at: now - hour, weekPercent: 'nope' },
      null,
    ],
    now,
    currentPercent: 5,
  })

  assert.deepEqual(result, [{ at: now, weekPercent: 5 }])
})

test('prefers the stored estimate when history has the same timestamp', () => {
  const sampleAt = now - hour
  const result = reconcilePaceSamples({
    historySamples: [{ at: sampleAt, weekPercent: 6 }],
    storedSamples: [{ at: sampleAt, weekPercent: 6.4 }],
    now,
    currentPercent: 7,
  })

  assert.equal(result[0].weekPercent, 6.4)
})

test('bounds persisted pace history to one thousand samples', () => {
  const storedSamples = Array.from({ length: 1100 }, (_, index) => ({
    at: now - (1100 - index) * 60_000,
    weekPercent: index / 100,
  }))
  const result = reconcilePaceSamples({
    storedSamples,
    now,
    currentPercent: 11,
  })

  assert.equal(result.length, 1000)
  assert.equal(result.at(-1).at, now)
})

test('keeps the long baseline when an estimate falls but raw weekly usage does not', () => {
  const samples = reconcilePaceSamples({
    storedSamples: [
      { at: now - 3 * hour, weekPercent: 5 },
      { at: now - 10 * 60_000, weekPercent: 7 },
    ],
    now,
    currentPercent: 6,
    previousRawPercent: 6,
    currentRawPercent: 6,
  })
  const rate = calculateUsageRate({
    samples,
    now,
    currentWeekPercent: 6,
    targetHours: 3,
    elapsedHours,
  })

  assert.equal(rate.elapsedHours, 3)
  assert.equal(rate.ratePercentPerHour, 1 / 3)
})

test('uses raw usage evidence instead of a disappearing fractional estimate', () => {
  assert.equal(shouldResetPaceSamples(7, 6, {
    previousRawPercent: 6,
    currentRawPercent: 6,
  }), false)
  assert.equal(shouldResetPaceSamples(7, 6, {
    previousRawPercent: 7,
    currentRawPercent: 6,
  }), true)
})

test('keeps weekly pace samples through small estimated-value jitter', () => {
  assert.equal(shouldResetPaceSamples(19.95, 19), false)
})

test('restarts weekly pace after a substantive server correction', () => {
  assert.equal(shouldResetPaceSamples(14, 5), true)
})

test('calculates the percentage of quota-window time remaining', () => {
  assert.equal(calculateRemainingTimePercent(2.5, 5), 50)
  assert.equal(calculateRemainingTimePercent(6, 5), 100)
  assert.equal(calculateRemainingTimePercent(-1, 5), 0)
})

test('projects weekly exhaustion through the weighted active-hours schedule', () => {
  const result = projectExhaustionHours({
    now,
    remainingPercent: 40,
    ratePercentPerBudgetHour: 10,
    budgetWeightAt: () => 0.5,
  })

  assert.equal(result, 8)
})
