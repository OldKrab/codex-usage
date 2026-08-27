export type BurnRateStatus = 'slow' | 'ok' | 'fast'

export function shouldNotifyBurnRateTransition(
  previous: BurnRateStatus | null,
  current: BurnRateStatus,
  firstSeenThisMount: boolean,
): boolean {
  if (!previous && firstSeenThisMount) return false
  return previous !== current && current === 'fast'
}
