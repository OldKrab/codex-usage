const HOUR_MS = 60 * 60 * 1000
const DEFAULT_RECENT_WINDOW_HOURS = 3
const DEFAULT_MINIMUM_RATE_HOURS = 1 / 12
const DEFAULT_SAMPLE_INTERVAL_MS = 60 * 1000
const DEFAULT_MATERIAL_CHANGE_PERCENT = 0.01
const MAX_SAMPLES = 1000

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampPercent(value) {
  const number = finiteNumber(value)
  return number === null ? null : Math.max(0, Math.min(100, number))
}

function normalizeSample(sample) {
  const at = finiteNumber(sample?.at)
  if (at === null) return null
  return {
    at,
    autoPercentUsed: clampPercent(sample?.autoPercentUsed),
    apiPercentUsed: clampPercent(sample?.apiPercentUsed),
  }
}

function usageChanged(current, previous, key, materialChangePercent) {
  const currentValue = finiteNumber(current?.[key])
  const previousValue = finiteNumber(previous?.[key])
  return currentValue !== null
    && previousValue !== null
    && Math.abs(currentValue - previousValue) >= materialChangePercent
}

function usageReset(current, previous, materialChangePercent) {
  return ['autoPercentUsed', 'apiPercentUsed'].some(key => {
    const currentValue = finiteNumber(current?.[key])
    const previousValue = finiteNumber(previous?.[key])
    return currentValue !== null
      && previousValue !== null
      && currentValue + materialChangePercent < previousValue
  })
}

/** Keep one bounded, monotonic usage history for both Cursor quota buckets. */
export function reconcileCursorPaceSamples({
  storedSamples = [],
  current,
  now = Date.now(),
  cycleStart = 0,
  minimumIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  materialChangePercent = DEFAULT_MATERIAL_CHANGE_PERCENT,
}) {
  const timestamp = finiteNumber(now)
  const currentSample = normalizeSample({ ...current, at: timestamp })
  if (timestamp === null || !currentSample) return []

  const valid = (Array.isArray(storedSamples) ? storedSamples : [])
    .map(normalizeSample)
    .filter(Boolean)
    .filter(sample => sample.at >= Number(cycleStart || 0) && sample.at <= timestamp)
    .sort((a, b) => a.at - b.at)

  const last = valid.at(-1)
  if (last && usageReset(currentSample, last, materialChangePercent)) {
    return [currentSample]
  }

  const byTimestamp = new Map(valid.map(sample => [sample.at, sample]))
  byTimestamp.set(timestamp, currentSample)
  const samples = [...byTimestamp.values()].sort((a, b) => a.at - b.at)
  const previous = samples.length > 1 ? samples.at(-2) : null
  const elapsedMs = timestamp - Number(previous?.at || 0)
  const changed = ['autoPercentUsed', 'apiPercentUsed']
    .some(key => usageChanged(currentSample, previous, key, materialChangePercent))

  if (!previous || elapsedMs >= Number(minimumIntervalMs) || changed) {
    return samples.slice(-MAX_SAMPLES)
  }

  // Replace a same-timestamp sample, but avoid writing every dashboard poll.
  return samples.slice(0, -1).slice(-MAX_SAMPLES)
}

function remainingTimePercent(cycleStart, resetAt, now) {
  const start = finiteNumber(cycleStart)
  const end = finiteNumber(resetAt)
  if (start === null || end === null || end <= start) return 0
  return Math.max(0, Math.min(100, (end - now) / (end - start) * 100))
}

/** Derive the same pace fields rendered by Codex's quota card. */
export function buildCursorPaceMetrics({
  samples = [],
  currentPercent,
  valueKey,
  cycleStart = 0,
  resetAt = null,
  now = Date.now(),
  recentWindowTargetHours = DEFAULT_RECENT_WINDOW_HOURS,
  minimumRateHours = DEFAULT_MINIMUM_RATE_HOURS,
}) {
  const usedPercent = clampPercent(currentPercent)
  if (usedPercent === null) return null

  const timestamp = finiteNumber(now) ?? Date.now()
  const start = finiteNumber(cycleStart)
  const end = finiteNumber(resetAt)
  const remainingPercent = Math.max(0, 100 - usedPercent)
  const remainingHours = end !== null
    ? Math.max(0, (end - timestamp) / HOUR_MS)
    : 0
  const safeRatePercentPerHour = remainingHours > 0
    ? remainingPercent / remainingHours
    : 0

  const validSamples = (Array.isArray(samples) ? samples : [])
    .map(normalizeSample)
    .filter(sample => sample
      && sample.at <= timestamp
      && (start === null || sample.at >= start)
      && finiteNumber(sample[valueKey]) !== null)
    .sort((a, b) => a.at - b.at)
  const targetWindowAt = timestamp - Number(recentWindowTargetHours) * HOUR_MS
  const baseline = validSamples.filter(sample => sample.at <= targetWindowAt).at(-1) || validSamples[0] || null
  const recentWindowHours = baseline
    ? Math.max(0, (timestamp - baseline.at) / HOUR_MS)
    : 0
  const spentSinceBaselinePercent = baseline
    ? Math.max(0, usedPercent - Number(baseline[valueKey]))
    : 0
  const recentRateAvailable = recentWindowHours >= Number(minimumRateHours)
  const actualRatePercentPerHour = recentRateAvailable
    ? spentSinceBaselinePercent / recentWindowHours
    : null
  const rateMultiple = actualRatePercentPerHour !== null && safeRatePercentPerHour > 0
    ? actualRatePercentPerHour / safeRatePercentPerHour
    : null
  const projectedExhaustionHours = actualRatePercentPerHour !== null && actualRatePercentPerHour > 0
    ? remainingPercent / actualRatePercentPerHour
    : null

  return {
    usedPercent,
    remainingPercent,
    resetAt: end !== null && end > 0 ? end : null,
    remainingTimePercent: remainingTimePercent(start, end, timestamp),
    recentWindowTargetHours: Number(recentWindowTargetHours),
    recentWindowHours,
    recentWarmingUp: recentWindowHours < Number(recentWindowTargetHours),
    recentRateAvailable,
    actualRatePercentPerHour,
    safeRatePercentPerHour,
    rateMultiple,
    projectedExhaustionHours,
  }
}

export function buildCursorUsagePace({ usage, samples = [], now = Date.now() }) {
  const planUsage = usage?.planUsage
  if (!planUsage) return null

  return {
    cursorModels: buildCursorPaceMetrics({
      samples,
      currentPercent: planUsage.autoPercentUsed,
      valueKey: 'autoPercentUsed',
      cycleStart: usage.billingCycleStart,
      resetAt: usage.billingCycleEnd,
      now,
    }),
    otherModels: buildCursorPaceMetrics({
      samples,
      currentPercent: planUsage.apiPercentUsed,
      valueKey: 'apiPercentUsed',
      cycleStart: usage.billingCycleStart,
      resetAt: usage.billingCycleEnd,
      now,
    }),
  }
}
