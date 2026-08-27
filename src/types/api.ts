export interface QuotaWindow {
  label: string
  usedPercent: number
  resetAt: number | null
  resetText?: string
  usedValue?: number
  limitValue?: number
  estimated?: boolean
  source?: string
}

export interface UsageData {
  plan: string | null
  windows: QuotaWindow[]
  summary?: {
    eventCount?: number
    billableEventCount?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    totalTokens?: number
    totalCost?: number
  }
}

export interface CursorPlanUsage {
  totalSpendCents: number | null
  includedSpendCents: number | null
  remainingCents: number | null
  limitCents: number | null
  autoPercentUsed: number | null
  apiPercentUsed: number | null
  totalPercentUsed: number | null
}

export interface CursorPaceMetrics {
  usedPercent: number
  remainingPercent: number
  resetAt: number | null
  remainingTimePercent: number
  recentWindowTargetHours: number
  recentWindowHours: number
  recentWarmingUp: boolean
  recentRateAvailable: boolean
  actualRatePercentPerHour: number | null
  safeRatePercentPerHour: number
  rateMultiple: number | null
  projectedExhaustionHours: number | null
}

export interface CursorUsagePace {
  cursorModels: CursorPaceMetrics | null
  otherModels: CursorPaceMetrics | null
}

export interface CursorUsage {
  billingCycleStart: number | null
  billingCycleEnd: number | null
  planUsage: CursorPlanUsage | null
  pace: CursorUsagePace | null
  spendLimitUsage: {
    limitType: string | null
    pooledLimitCents: number | null
  } | null
  displayMessage: string | null
  autoModelSelectedDisplayMessage: string | null
  namedModelSelectedDisplayMessage: string | null
  updatedAt: number
}

export interface CursorSubscription {
  configured: true
  plan: string
  monthlyCost: number | null
  currency: string
  renewalDate: string | null
  usage: CursorUsage | null
  lastCheckedAt: number | null
  lastError: string | null
}

export interface CursorSubscriptionConfig {
  plan: string
  monthlyCost: number | null
  currency: string
  renewalDate: string | null
}

export interface CursorSubscriptionResponse {
  cursor: CursorSubscription | null
}

export interface CursorMutationResponse {
  ok: boolean
  refreshOk?: boolean
  cursor: CursorSubscription | null
  error?: string
}

export interface AlertMetrics {
  resetAt: number | null
  currentWeekPercent: number
  rawWeekPercent: number
  rawShortPercent: number | null
  empirical5hToWeekRatio: number | null
  estimated: boolean
  remainingWeekPercent: number
  remainingBudgetHours: number
  remainingTimePercent: number
  baselineAt: number
  baselineWeekPercent: number
  elapsedHours: number
  spentSinceBaselinePercent: number
  recentWindowTargetHours: number
  recentWindowHours: number
  recentWarmingUp: boolean
  recentRateAvailable: boolean
  todayRatePercentPerHour: number
  todayElapsedHours: number
  safeRatePercentPerHour: number
  actualRatePercentPerHour: number | null
  rateMultiple: number | null
  projectedExhaustionHours: number | null
  alertMultiplier: number
  slowMultiplier: number
  activeHours: string
  weekendWeight: number
  status: 'slow' | 'ok' | 'fast'
  shortWindow: ShortWindowMetrics | null
}

export interface ShortWindowMetrics {
  label: string
  resetAt: number | null
  usedPercent: number
  remainingPercent: number
  remainingHours: number
  remainingTimePercent: number
  recentWindowTargetHours: number
  recentWindowHours: number
  recentWarmingUp: boolean
  recentRateAvailable: boolean
  actualRatePercentPerHour: number | null
  safeRatePercentPerHour: number
  rateMultiple: number | null
  projectedExhaustionHours: number | null
  willExhaustBeforeReset: boolean
  status: 'good' | 'warn' | 'bad'
}

export interface Entitlement {
  active: boolean
  plan: string | null
  activeUntil: string | null
  since?: string | null
  rateLimitTier?: string | null
  autoRenew?: boolean
}

export interface Account {
  slot: string
  provider?: 'openai' | 'claude-code' | 'opencode-go'
  readOnly?: boolean
  connected: boolean
  email: string | null
  accountId: string | null
  orgName?: string | null
  planTypeFromJwt: string | null
  usage: UsageData | null
  alertMetrics?: AlertMetrics | null
  expires: number | null
  updatedAt: number | null
  lastCheckedAt: number | null
  lastError: string | null
  entitlement: Entitlement | null
}

export interface AccountsResponse {
  accounts: Account[]
}

export interface Settings {
  liveInterval: number
  backgroundInterval: number
}

export interface HistorySnapshot {
  timestamp: number
  accounts: Record<string, {
    email: string | null
    windows: { label: string; usedPercent: number }[]
  }>
}

export interface HistoryResponse {
  snapshots: HistorySnapshot[]
}
