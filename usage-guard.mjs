export function getWeekWindowFromUsage(usage) {
  return (usage?.windows || []).find(window => window?.label === 'Week')
}

export function isLikelyTransientUsageGlitch(previousUsage, nextUsage, now = Date.now()) {
  const previousWeek = getWeekWindowFromUsage(previousUsage)
  const nextWeek = getWeekWindowFromUsage(nextUsage)
  if (!previousWeek || !nextWeek) return false
  const previousUsed = Number(previousWeek.usedPercent)
  const nextUsed = Number(nextWeek.usedPercent)
  const previousResetAt = Number(previousWeek.resetAt || 0)
  const resetWindowReached = Number.isFinite(previousResetAt) && previousResetAt > 0
    ? now >= previousResetAt - 10 * 60 * 1000
    : false
  return Number.isFinite(previousUsed)
    && Number.isFinite(nextUsed)
    && nextUsed < previousUsed
    && nextUsed <= 1
    && !resetWindowReached
}

export function preserveTransientWindowRegressions(previousUsage, nextUsage, now = Date.now()) {
  if (!nextUsage?.windows) return nextUsage
  return {
    ...nextUsage,
    windows: nextUsage.windows.map(window => {
      const previous = (previousUsage?.windows || []).find(candidate => candidate?.label === window?.label)
      const previousUsed = Number(previous?.usedPercent)
      const nextUsed = Number(window?.usedPercent)
      const previousResetAt = Number(previous?.resetAt || 0)
      const nextResetAt = Number(window?.resetAt || 0)
      const resetWindowReached = previousResetAt > 0 && now >= previousResetAt - 10 * 60 * 1000
      const isShortWindow = /^\d+(?:\.\d+)?h$/i.test(String(window?.label || ''))
      const shortWindowHours = isShortWindow ? Number.parseFloat(String(window.label)) : 0
      const resetCycleAdvanced = isShortWindow
        && previousResetAt > 0
        && nextResetAt - previousResetAt >= shortWindowHours * 60 * 60 * 1000 / 2
      const transientRegression = nextUsed < previousUsed
        && !resetWindowReached
        && !resetCycleAdvanced
        && (isShortWindow || nextUsed <= 1)
      return previous
        && Number.isFinite(previousUsed)
        && Number.isFinite(nextUsed)
        && transientRegression
        ? { ...window, ...previous }
        : window
    }),
  }
}
