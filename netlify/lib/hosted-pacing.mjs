import {
  calculateRemainingTimePercent,
  calculateUsageRate,
  getLatestMonotonicSegment,
  isUsageRateAvailable,
  reconcilePaceSamples,
} from '../../pace-window.mjs'

const HOUR_MS = 60 * 60 * 1000
const WEEK_HOURS = 7 * 24
const RECENT_WEEK_HOURS = 3
const RECENT_SHORT_HOURS = 1
const MINIMUM_SAMPLE_HOURS = 5 / 60
const FAST_MULTIPLIER = 1.25
const SLOW_MULTIPLIER = 0.75
const MINIMUM_SAMPLE_INTERVAL_MS = 5 * 60 * 1000

function usageWindow(account, type) {
  return (account?.usage?.windows || []).find(window => type === 'weekly'
    ? window?.label === 'Week'
    : /^\d+(?:\.\d+)?h$/i.test(String(window?.label || '')))
}

function cycleStart(window, now, fallbackHours) {
  const resetAt = Number(window?.resetAt || 0)
  return resetAt > 0 ? resetAt - fallbackHours * HOUR_MS : now - fallbackHours * HOUR_MS
}

function reconcileAccountSeries({ previousAccount, refreshedAccount, series, history, slot, now }) {
  const currentWindow = usageWindow(refreshedAccount, series)
  const currentPercent = Number(currentWindow?.usedPercent)
  const stored = Array.isArray(previousAccount?.paceSamples?.[series])
    ? previousAccount.paceSamples[series]
    : []
  if (!Number.isFinite(currentPercent)) return stored.slice(-1000)

  const previousWindow = usageWindow(previousAccount, series)
  const previousPercent = Number(previousWindow?.usedPercent)
  const previousAt = Number(previousAccount?.lastCheckedAt)
  const durationHours = series === 'weekly'
    ? WEEK_HOURS
    : Number.parseFloat(String(currentWindow.label))
  const previousResetAt = Number(previousWindow?.resetAt || 0)
  const currentResetAt = Number(currentWindow?.resetAt || 0)
  const currentCycleStart = cycleStart(currentWindow, now, durationHours)
  const previousSample = stored.length === 0
    && Number.isFinite(previousPercent)
    && Number.isFinite(previousAt)
    && previousAt <= now
    ? [{ at: previousAt, weekPercent: previousPercent }]
    : []
  const historySamples = stored.length === 0
    ? [
        ...historySamplesFor(history, slot, currentWindow.label, currentCycleStart, now),
        ...previousSample,
      ]
    : []

  return reconcilePaceSamples({
    storedSamples: stored,
    historySamples,
    now,
    cycleStart: currentCycleStart,
    currentPercent,
    previousRawPercent: previousPercent,
    currentRawPercent: currentPercent,
    resetConfirmed: previousResetAt > 0 && currentResetAt > previousResetAt,
    minimumIntervalMs: MINIMUM_SAMPLE_INTERVAL_MS,
  })
}

/** Adds bounded reset-aware pace state to the account written by the refresh CAS. */
export function withUpdatedHostedPaceSamples(previousAccount, refreshedAccount, now, {
  history = [],
  slot = null,
} = {}) {
  return {
    ...refreshedAccount,
    paceSamples: {
      weekly: reconcileAccountSeries({ previousAccount, refreshedAccount, series: 'weekly', history, slot, now }),
      short: reconcileAccountSeries({ previousAccount, refreshedAccount, series: 'short', history, slot, now }),
    },
  }
}

function historySamplesFor(history, slot, label, since, now) {
  const samples = (history || [])
    .filter(snapshot => Number(snapshot?.timestamp) >= since && Number(snapshot?.timestamp) <= now)
    .map(snapshot => {
      const window = snapshot.accounts?.[slot]?.windows?.find(candidate => candidate?.label === label)
      return Number.isFinite(Number(window?.usedPercent))
        ? { at: Number(snapshot.timestamp), weekPercent: Number(window.usedPercent) }
        : null
    })
    .filter(Boolean)
  return getLatestMonotonicSegment(samples)
}

export function hasPersistedPaceSamples(account) {
  return Array.isArray(account?.paceSamples?.weekly)
    && Array.isArray(account?.paceSamples?.short)
}

function samplesFor({ account, history, slot, series, label, since, now }) {
  const samples = Array.isArray(account?.paceSamples?.[series])
    ? account.paceSamples[series]
    : historySamplesFor(history, slot, label, since, now)
  return getLatestMonotonicSegment((samples || []).filter(sample =>
    Number(sample?.at) >= since && Number(sample?.at) <= now))
}

function pace(samples, now, currentPercent, targetHours) {
  const withCurrent = [...samples]
  if (!withCurrent.length || withCurrent.at(-1).at < now) {
    withCurrent.push({ at: now, weekPercent: currentPercent })
  }
  const measured = calculateUsageRate({
    samples: withCurrent,
    now,
    currentWeekPercent: currentPercent,
    targetHours,
    elapsedHours: (from, to) => Math.max(0, Number(to) - Number(from)) / HOUR_MS,
  })
  const available = isUsageRateAvailable(measured.elapsedHours, MINIMUM_SAMPLE_HOURS)
  return {
    ...measured,
    available,
    rate: available ? measured.ratePercentPerHour : null,
  }
}

/** Derives hosted pace from account-local samples, with immutable history as a legacy fallback. */
export function calculateHostedAlertMetrics({ slot, account, history, now }) {
  const week = account?.usage?.windows?.find(window => window?.label === 'Week')
  const currentWeekPercent = Number(week?.usedPercent)
  if (!week || !Number.isFinite(currentWeekPercent)) return null

  const resetAt = Number(week.resetAt || 0) || null
  const cycleStart = resetAt ? resetAt - WEEK_HOURS * HOUR_MS : now - WEEK_HOURS * HOUR_MS
  const weeklySamples = samplesFor({
    account, history, slot, series: 'weekly', label: 'Week', since: cycleStart, now,
  })
  const weekPace = pace(weeklySamples, now, currentWeekPercent, RECENT_WEEK_HOURS)
  const remainingWeekPercent = Math.max(0, 100 - currentWeekPercent)
  const remainingBudgetHours = resetAt ? Math.max(0, (resetAt - now) / HOUR_MS) : 0
  const totalHours = resetAt ? WEEK_HOURS : 0
  const safeRatePercentPerHour = remainingBudgetHours > 0 ? remainingWeekPercent / remainingBudgetHours : 0
  const rateMultiple = weekPace.rate !== null && safeRatePercentPerHour > 0
    ? weekPace.rate / safeRatePercentPerHour
    : null
  const projectedExhaustionHours = weekPace.rate !== null && weekPace.rate > 0
    ? remainingWeekPercent / weekPace.rate
    : null
  const fast = weekPace.rate !== null
    && weekPace.rate >= safeRatePercentPerHour * FAST_MULTIPLIER
    && weekPace.rate - safeRatePercentPerHour >= 0.1
  const slow = weekPace.rate !== null && weekPace.rate < safeRatePercentPerHour * SLOW_MULTIPLIER

  const short = account.usage.windows.find(window => /^\d+(?:\.\d+)?h$/i.test(String(window?.label || '')))
  let shortWindow = null
  const rawShortPercent = Number(short?.usedPercent)
  if (short && Number.isFinite(rawShortPercent)) {
    const durationHours = Number.parseFloat(short.label)
    const shortResetAt = Number(short.resetAt || 0) || null
    const shortCycleStart = shortResetAt ? shortResetAt - durationHours * HOUR_MS : now - durationHours * HOUR_MS
    const shortPace = pace(samplesFor({
      account, history, slot, series: 'short', label: short.label, since: shortCycleStart, now,
    }), now, rawShortPercent, RECENT_SHORT_HOURS)
    const remainingPercent = Math.max(0, 100 - rawShortPercent)
    const remainingHours = shortResetAt ? Math.max(0, (shortResetAt - now) / HOUR_MS) : 0
    const safeRate = remainingHours > 0 ? remainingPercent / remainingHours : 0
    const shortMultiple = shortPace.rate !== null && safeRate > 0 ? shortPace.rate / safeRate : null
    const exhaustion = shortPace.rate !== null && shortPace.rate > 0 ? remainingPercent / shortPace.rate : null
    const willExhaust = exhaustion !== null && remainingHours > 0 && exhaustion < remainingHours
    shortWindow = {
      label: short.label,
      resetAt: shortResetAt,
      usedPercent: rawShortPercent,
      remainingPercent,
      remainingHours,
      remainingTimePercent: calculateRemainingTimePercent(remainingHours, durationHours),
      recentWindowTargetHours: RECENT_SHORT_HOURS,
      recentWindowHours: shortPace.elapsedHours,
      recentWarmingUp: shortPace.warmingUp,
      recentRateAvailable: shortPace.available,
      actualRatePercentPerHour: shortPace.rate,
      safeRatePercentPerHour: safeRate,
      rateMultiple: shortMultiple,
      projectedExhaustionHours: exhaustion,
      willExhaustBeforeReset: willExhaust,
      status: willExhaust ? 'bad' : rawShortPercent >= 80 || (shortMultiple !== null && shortMultiple >= 0.8) ? 'warn' : 'good',
    }
  }

  const baseline = weeklySamples[0]
  return {
    resetAt,
    currentWeekPercent,
    rawWeekPercent: currentWeekPercent,
    rawShortPercent: Number.isFinite(rawShortPercent) ? rawShortPercent : null,
    empirical5hToWeekRatio: null,
    estimated: false,
    remainingWeekPercent,
    remainingBudgetHours,
    remainingTimePercent: calculateRemainingTimePercent(remainingBudgetHours, totalHours),
    baselineAt: baseline?.at ?? now,
    baselineWeekPercent: baseline?.weekPercent ?? currentWeekPercent,
    elapsedHours: weekPace.elapsedHours,
    spentSinceBaselinePercent: weekPace.spentPercent,
    recentWindowTargetHours: RECENT_WEEK_HOURS,
    recentWindowHours: weekPace.elapsedHours,
    recentWarmingUp: weekPace.warmingUp,
    recentRateAvailable: weekPace.available,
    todayRatePercentPerHour: weekPace.rate ?? 0,
    todayElapsedHours: weekPace.elapsedHours,
    safeRatePercentPerHour,
    actualRatePercentPerHour: weekPace.rate,
    rateMultiple,
    projectedExhaustionHours,
    alertMultiplier: FAST_MULTIPLIER,
    slowMultiplier: SLOW_MULTIPLIER,
    activeHours: '00:00-24:00',
    weekendWeight: 1,
    status: fast ? 'fast' : slow ? 'slow' : 'ok',
    shortWindow,
  }
}
