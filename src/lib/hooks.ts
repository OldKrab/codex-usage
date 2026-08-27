import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import * as api from './api'
import type {
  Account,
  AccountsResponse,
  CursorSubscriptionConfig,
  CursorSubscriptionResponse,
  Settings,
  HistoryResponse,
} from '../types/api'
import { shouldNotifyBurnRateTransition, type BurnRateStatus } from './burn-rate-notification'

export function useAccounts() {
  return useQuery<AccountsResponse>({
    queryKey: ['accounts'],
    queryFn: api.fetchAccounts,
    refetchInterval: 5000,
  })
}

export function useCursorSubscription() {
  return useQuery<CursorSubscriptionResponse>({
    queryKey: ['cursor'],
    queryFn: api.fetchCursorSubscription,
    refetchInterval: 5000,
  })
}

export function useSettings() {
  return useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: api.fetchSettings,
  })
}

export function useHistory(range: '24h' | '7d' | '30d') {
  return useQuery<HistoryResponse>({
    queryKey: ['history', range],
    queryFn: () => api.fetchHistory(range),
  })
}

export function useRefreshAll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.refreshAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['cursor'] })
    },
  })
}

export function useSaveCursorSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: CursorSubscriptionConfig) => api.saveCursorSubscription(config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cursor'] }),
  })
}

export function useRefreshCursorSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.refreshCursorSubscription,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cursor'] }),
  })
}

export function useDeleteCursorSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteCursorSubscription,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cursor'] }),
  })
}

export function useRefreshSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: string) => api.refreshSlot(slot),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useCreateSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createSlot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useConnectOpenCodeGo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (credentials: { apiKey?: string; workspaceId?: string; authToken?: string }) =>
      api.connectOpenCodeGo(credentials),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useLoginSlot() {
  return useMutation({
    mutationFn: (slot: string) => api.loginSlot(slot),
  })
}

export function useLogoutSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: string) => api.logoutSlot(slot),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useDeleteSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: string) => api.deleteSlot(slot),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useExchangeCallback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slot, url }: { slot: string; url: string }) =>
      api.exchangeCallback(slot, url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (partial: Partial<Settings>) => api.updateSettings(partial),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

/** Client-side live refresh: calls /api/refresh-all at liveInterval when page is open */
export function useLiveRefresh() {
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const intervalSec = settings?.liveInterval ?? 30

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null

    if (intervalSec <= 0) return

    timerRef.current = setInterval(async () => {
      try {
        await api.refreshAll()
        qc.invalidateQueries({ queryKey: ['accounts'] })
        qc.invalidateQueries({ queryKey: ['cursor'] })
        qc.invalidateQueries({ queryKey: ['history'] })
      } catch {}
    }, intervalSec * 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [intervalSec, qc])
}

function fmtRate(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%/h`
}

export const BROWSER_NOTIFICATIONS_KEY = 'codex-browser-notifications-enabled'

function burnRateMessage(account: Account) {
  const metrics = account.alertMetrics
  if (!metrics) return null
  const name = account.email || account.slot
  const ratio = metrics.rateMultiple === null ? '—' : `${metrics.rateMultiple.toFixed(1)}×`
  return `${name}: ${ratio} · current ${fmtRate(metrics.actualRatePercentPerHour)} / safe ${fmtRate(metrics.safeRatePercentPerHour)}`
}

function showBrowserNotification(title: string, body: string, tag: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) !== 'true') return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, tag, renotify: true })
  } catch {}
}

/** In-site burn-rate notifications: toast + optional browser OS notifications only on status transitions. */
export function useBurnRateNotifications(accounts: Account[]) {
  const seenThisMount = useRef(new Set<string>())

  useEffect(() => {
    for (const account of accounts) {
      const metrics = account.alertMetrics
      if (!metrics) continue

      const key = `codex-burn-rate-status:${account.slot}`
      const previous = localStorage.getItem(key)
      const current = metrics.status
      const message = burnRateMessage(account)
      if (!message) continue

      const firstSeenThisMount = !seenThisMount.current.has(account.slot)
      seenThisMount.current.add(account.slot)
      localStorage.setItem(key, current)

      if (!shouldNotifyBurnRateTransition(previous as BurnRateStatus | null, current, firstSeenThisMount)) continue

      toast.error('Codex burn rate is fast', { description: message, duration: 12_000 })
      showBrowserNotification('Codex burn rate is fast', message, `codex-burn-rate-${account.slot}`)
    }
  }, [accounts])
}
