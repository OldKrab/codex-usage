import { useEffect, useState } from 'react'
import type { QuotaWindow } from '../types/api'
import { getQuotaStatus, getRemainingPercent, formatTimeLeft, formatResetTime, STATUS_COLORS } from '../lib/utils'

export function QuotaBlock({ window: w, label }: { window: QuotaWindow; label: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const remaining = getRemainingPercent(w.usedPercent)
  const status = getQuotaStatus(w.usedPercent)
  const colors = STATUS_COLORS[status]
  const hasValueLimit = typeof w.usedValue === 'number' && typeof w.limitValue === 'number'
  const shortLabel = /^\d+h$/i.test(w.label) ? w.label.toUpperCase() : w.label === 'Week' ? '7D' : w.label === 'Month' ? '30D' : w.label.slice(0, 3).toUpperCase()
  const reset = w.resetText ? `in ${w.resetText}` : `in ${formatTimeLeft(w.resetAt)}`
  const resetAt = w.resetText
    ? (w.source === 'console' ? 'Console usage' : 'Tracked usage')
    : formatResetTime(w.resetAt)

  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-hover text-[10px] font-bold tracking-wide text-text-muted">{shortLabel}</div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{label} quota</div>
            <div className="mt-0.5 truncate text-xs text-text-muted">Resets {reset}</div>
            <div className="truncate text-xs text-text-muted/85">{resetAt}</div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[22px] font-semibold leading-6 tabular-nums tracking-tight ${colors.text}`}>{remaining.toFixed(0)}%</div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-text-muted">left</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full transition-[width] duration-300 ease-out ${colors.bg}`} style={{ width: `${remaining}%` }} />
      </div>
      {hasValueLimit && (
        <div className="mt-1.5 text-right text-[10px] text-text-muted">${w.usedValue!.toFixed(2)} of ${w.limitValue!.toFixed(0)} used</div>
      )}
    </div>
  )
}
