import { formatResetTime, formatTimeLeft } from '../lib/utils'

interface QuotaPaceBlockProps {
  label: string
  usedPercent?: number
  remainingPercent: number
  remainingTimePercent: number
  recentRate: number | null
  safeRate: number
  rateMultiple: number | null
  recentWindowLabel: string
  projectedExhaustionHours: number | null
  resetAt: number | null
}

function fmtRate(value: number) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function fmtMultiple(value: number) {
  return value > 0 && value < 0.1 ? '<0.1' : value.toFixed(1)
}

const TONES = {
  good: { text: 'text-good', dot: 'bg-good' },
  warn: { text: 'text-warn', dot: 'bg-warn' },
  bad: { text: 'text-bad', dot: 'bg-bad' },
  info: { text: 'text-accent', dot: 'bg-accent' },
} as const

export function QuotaPaceBlock({
  label,
  usedPercent,
  remainingPercent,
  remainingTimePercent,
  recentRate,
  safeRate,
  rateMultiple,
  recentWindowLabel,
  projectedExhaustionHours,
  resetAt,
}: QuotaPaceBlockProps) {
  const headroom = remainingPercent - remainingTimePercent
  const alignment = headroom >= 3
    ? { label: 'Ahead of schedule', tone: 'good' as const }
    : headroom <= -10
      ? { label: 'Behind schedule', tone: 'bad' as const }
      : headroom <= -3
        ? { label: 'Slightly behind schedule', tone: 'warn' as const }
        : { label: 'On track', tone: 'info' as const }
  const tone = TONES[alignment.tone]
  const quotaBar = remainingPercent <= 20
    ? 'bg-bad'
    : remainingPercent <= 50
      ? 'bg-warn'
      : 'bg-good'
  const timeMarkerPosition = Math.max(0.5, Math.min(99.5, remainingTimePercent))
  const timeLabelPosition = remainingTimePercent <= 15
    ? 'translate-x-0'
    : remainingTimePercent >= 85
      ? '-translate-x-full'
      : '-translate-x-1/2'
  const forecastAvailable = projectedExhaustionHours !== null && projectedExhaustionHours > 0
  const forecastAt = forecastAvailable ? Date.now() + projectedExhaustionHours * 60 * 60 * 1000 : null
  const emptiesBeforeReset = forecastAt !== null && resetAt !== null && forecastAt < resetAt

  return (
    <section aria-label={`${label} quota status`}>
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
            <h3 className="truncate text-sm font-semibold">{label} limit</h3>
          </div>
          <div className={`mt-0.5 truncate pl-4 text-xs font-medium ${tone.text}`}>{alignment.label}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold leading-7 tracking-[-0.04em] tabular-nums">
            {remainingPercent.toFixed(0)}<span className="ml-0.5 text-xs font-normal tracking-normal text-text-muted">% quota left</span>
          </div>
          {typeof usedPercent === 'number' && Number.isFinite(usedPercent) && (
            <div className="mt-0.5 text-[11px] tabular-nums text-text-muted">
              {usedPercent.toFixed(2)}% used
            </div>
          )}
        </div>
      </div>

      <div
        className="relative h-2 rounded-full bg-border"
        role="img"
        aria-label={`${remainingPercent.toFixed(0)}% quota left; ${remainingTimePercent.toFixed(0)}% time left`}
      >
        <div className={`h-full rounded-full transition-[width] duration-300 ${quotaBar}`} style={{ width: `${remainingPercent}%` }} />
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text shadow-[0_0_0_2px_var(--color-surface)] transition-[left] duration-300"
          style={{ left: `${timeMarkerPosition}%` }}
        >
          <span className={`absolute left-1/2 top-full mt-1 whitespace-nowrap rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-muted shadow-sm ${timeLabelPosition}`}>
            {remainingTimePercent.toFixed(0)}% time left
          </span>
        </div>
      </div>

      <dl className="mt-8 divide-y divide-border/70 border-y border-border/70 min-[521px]:grid min-[521px]:grid-cols-3 min-[521px]:divide-y-0">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4 py-3 min-[521px]:block min-[521px]:px-4">
          <dt className="text-xs text-text-muted">Speed now</dt>
          <dd className="min-w-0 text-right min-[521px]:mt-1 min-[521px]:text-left">
            {recentRate === null ? (
              <>
                <div className="text-sm font-semibold text-accent">Measuring</div>
                <div className="text-[11px] text-text-muted">{recentWindowLabel}</div>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-end gap-2 min-[521px]:justify-start">
                  <span className="text-base font-semibold tabular-nums">{fmtRate(recentRate)}<span className="ml-0.5 text-[11px] font-normal text-text-muted">%/h</span></span>
                  {rateMultiple !== null && <span className={`text-[11px] font-semibold tabular-nums ${rateMultiple > 1 ? 'text-bad' : 'text-good'}`}>{fmtMultiple(rateMultiple)}× optimal</span>}
                </div>
                <div className="text-[11px] text-text-muted tabular-nums">Optimal speed {fmtRate(safeRate)}%/h</div>
              </>
            )}
          </dd>
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4 py-3 min-[521px]:block min-[521px]:border-l min-[521px]:border-border/70 min-[521px]:px-4">
          <dt className="text-xs text-text-muted">Runs out</dt>
          <dd className="min-w-0 text-right min-[521px]:mt-1 min-[521px]:text-left">
            {forecastAvailable && emptiesBeforeReset ? (
              <>
                <div className="text-sm font-semibold tabular-nums">~in {formatTimeLeft(forecastAt)}</div>
                <div className="text-[11px] text-text-muted tabular-nums">~{formatResetTime(forecastAt)}</div>
                <div className="text-[11px] font-medium text-bad">Before reset</div>
              </>
            ) : forecastAvailable ? (
              <>
                <div className="text-sm font-semibold text-good">Lasts until reset</div>
                <div className="text-[11px] text-text-muted">Quota resets first</div>
              </>
            ) : recentRate === 0 ? (
              <>
                <div className="text-sm font-semibold text-good">Not draining</div>
                <div className="text-[11px] text-text-muted">Quota should last</div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-accent">Measuring</div>
                <div className="text-[11px] text-text-muted">Forecast coming soon</div>
              </>
            )}
          </dd>
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4 py-3 min-[521px]:block min-[521px]:border-l min-[521px]:border-border/70 min-[521px]:px-4">
          <dt className="text-xs text-text-muted">Reset</dt>
          <dd className="text-right min-[521px]:mt-1 min-[521px]:text-left">
            <div className="text-sm font-semibold tabular-nums">in {formatTimeLeft(resetAt)}</div>
            <div className="text-[11px] text-text-muted">{formatResetTime(resetAt)}</div>
          </dd>
        </div>
      </dl>
    </section>
  )
}
