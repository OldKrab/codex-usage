import type { ShortWindowMetrics } from '../types/api'
import { QuotaPaceBlock } from './QuotaPaceBlock'

export function ShortWindowPaceBlock({ metrics }: { metrics: ShortWindowMetrics }) {
  const measuring = !metrics.recentRateAvailable
  const recentWindow = measuring
    ? `${Math.round(metrics.recentWindowHours * 60)}m collected`
    : metrics.recentWarmingUp
      ? `${metrics.recentWindowHours.toFixed(1)}h of ${metrics.recentWindowTargetHours}h`
      : `${metrics.recentWindowTargetHours}h rolling`

  return <QuotaPaceBlock
    label={metrics.label}
    remainingPercent={metrics.remainingPercent}
    remainingTimePercent={metrics.remainingTimePercent}
    recentRate={metrics.actualRatePercentPerHour}
    safeRate={metrics.safeRatePercentPerHour}
    rateMultiple={metrics.rateMultiple}
    recentWindowLabel={recentWindow}
    projectedExhaustionHours={metrics.projectedExhaustionHours}
    resetAt={metrics.resetAt}
  />
}