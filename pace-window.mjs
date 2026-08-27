export function calculateUsageRate({ samples, now, currentWeekPercent, targetHours, elapsedHours }) {
  const valid = (samples || [])
    .filter(sample => Number.isFinite(Number(sample?.at)) && Number.isFinite(Number(sample?.weekPercent)) && Number(sample.at) <= now)
    .sort((a, b) => Number(a.at) - Number(b.at))

  if (!valid.length || !Number.isFinite(Number(currentWeekPercent))) {
    return { ratePercentPerHour: 0, elapsedHours: 0, spentPercent: 0, warmingUp: true }
  }

  const measured = valid.map(sample => ({
    sample,
    hours: Math.max(0, Number(elapsedHours(Number(sample.at), now)) || 0),
  }))
  const reachedTarget = measured.filter(point => point.hours >= targetHours)
  const baseline = reachedTarget.length
    ? reachedTarget.reduce((best, point) => point.hours < best.hours ? point : best)
    : measured[0]
  const spentPercent = Math.max(0, Number(currentWeekPercent) - Number(baseline.sample.weekPercent))
  const windowHours = baseline.hours

  return {
    ratePercentPerHour: windowHours > 0 ? spentPercent / windowHours : 0,
    elapsedHours: windowHours,
    spentPercent,
    warmingUp: windowHours + 1e-9 < targetHours,
  }
}

export function getLatestMonotonicSegment(samples, valueKey = 'weekPercent') {
  const values = Array.isArray(samples) ? samples : []
  let segmentStart = 0
  for (let index = 1; index < values.length; index += 1) {
    const previous = Number(values[index - 1]?.[valueKey])
    const current = Number(values[index]?.[valueKey])
    if (Number.isFinite(previous) && Number.isFinite(current) && current < previous) {
      segmentStart = index
    }
  }
  return values.slice(segmentStart)
}

export function reconcilePaceSamples({
  storedSamples = [],
  historySamples = [],
  now,
  cycleStart = 0,
  currentPercent,
  previousRawPercent,
  currentRawPercent,
  resetConfirmed = false,
  minimumIntervalMs = 60_000,
  materialChangePercent = 0.01,
}) {
  if (shouldResetPaceSamples(storedSamples.at(-1)?.weekPercent, currentPercent, {
    previousRawPercent,
    currentRawPercent,
    resetConfirmed,
  })) {
    return [{ at: Number(now), weekPercent: Number(currentPercent) }]
  }

  const historyValid = (historySamples || [])
    .filter(sample => Number.isFinite(Number(sample?.at)) && Number.isFinite(Number(sample?.weekPercent)))
    .sort((a, b) => Number(a.at) - Number(b.at))
  const historySegment = getLatestMonotonicSegment(historyValid)
  const historyResetDetected = historySegment.length < historyValid.length
  const historySegmentStart = Number(historySegment[0]?.at || 0)
  const eligibleStoredSamples = historyResetDetected
    ? storedSamples.filter(sample => Number(sample?.at) >= historySegmentStart)
    : storedSamples
  const valid = [...historySegment, ...eligibleStoredSamples]
    .filter(sample => Number.isFinite(Number(sample?.at))
      && Number.isFinite(Number(sample?.weekPercent))
      && Number(sample.at) >= Number(cycleStart)
      && Number(sample.at) <= Number(now))
    .sort((a, b) => Number(a.at) - Number(b.at))
  const byTimestamp = new Map(valid.map(sample => [Number(sample.at), {
    at: Number(sample.at),
    weekPercent: Number(sample.weekPercent),
  }]))
  const samples = [...byTimestamp.values()].sort((a, b) => a.at - b.at)
  const last = samples.at(-1)
  const elapsedMs = Number(now) - Number(last?.at || 0)
  const changedBy = Math.abs(Number(currentPercent) - Number(last?.weekPercent))
  if (!last || (last.at < Number(now) && (
    elapsedMs >= Number(minimumIntervalMs)
    || changedBy >= Number(materialChangePercent)
  ))) {
    samples.push({ at: Number(now), weekPercent: Number(currentPercent) })
  }
  return samples.slice(-1000)
}

export function shouldResetPaceSamples(previousPercent, currentPercent, options = 1) {
  const previous = Number(previousPercent)
  const current = Number(currentPercent)
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return false

  if (options && typeof options === 'object') {
    if (options.resetConfirmed) return true
    const previousRaw = Number(options.previousRawPercent)
    const currentRaw = Number(options.currentRawPercent)
    if (Number.isFinite(previousRaw) && Number.isFinite(currentRaw)) {
      return currentRaw < previousRaw
    }
    return false
  }

  const minimumDropPercent = Number(options)
  return Number.isFinite(minimumDropPercent)
    && previous - current >= minimumDropPercent
}

export function calculateRemainingTimePercent(remainingHours, totalHours) {
  const remaining = Number(remainingHours)
  const total = Number(totalHours)
  if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, remaining / total * 100))
}

export function isUsageRateAvailable(elapsedHours, minimumHours = 1 / 12) {
  return Number.isFinite(Number(elapsedHours))
    && Number(elapsedHours) >= Number(minimumHours)
}

export function projectExhaustionHours({
  now,
  remainingPercent,
  ratePercentPerBudgetHour,
  budgetWeightAt,
  maxWallClockHours = 24 * 30,
  stepMinutes = 15,
}) {
  const start = Number(now)
  const remaining = Number(remainingPercent)
  const rate = Number(ratePercentPerBudgetHour)
  if (!Number.isFinite(start) || !Number.isFinite(remaining) || remaining <= 0 || !Number.isFinite(rate) || rate <= 0) return null

  const requiredBudgetHours = remaining / rate
  const stepMs = Math.max(1, Number(stepMinutes)) * 60 * 1000
  const maxEnd = start + maxWallClockHours * 60 * 60 * 1000
  let cursor = start
  let accumulatedBudgetHours = 0
  while (cursor < maxEnd) {
    const next = Math.min(maxEnd, cursor + stepMs)
    const intervalHours = (next - cursor) / (60 * 60 * 1000)
    const weight = Math.max(0, Number(budgetWeightAt(cursor + (next - cursor) / 2)) || 0)
    const intervalBudgetHours = intervalHours * weight
    if (intervalBudgetHours > 0 && accumulatedBudgetHours + intervalBudgetHours >= requiredBudgetHours) {
      const fraction = (requiredBudgetHours - accumulatedBudgetHours) / intervalBudgetHours
      return (cursor + (next - cursor) * fraction - start) / (60 * 60 * 1000)
    }
    accumulatedBudgetHours += intervalBudgetHours
    cursor = next
  }
  return null
}
