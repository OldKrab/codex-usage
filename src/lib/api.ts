import type {
  AccountsResponse,
  CursorMutationResponse,
  CursorSubscriptionConfig,
  CursorSubscriptionResponse,
  Settings,
  HistoryResponse,
} from '../types/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = `Request failed: ${res.status}`
    try { msg = JSON.parse(text).error || msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export const fetchAccounts = () => request<AccountsResponse>('/api/accounts')

export const fetchCursorSubscription = () =>
  request<CursorSubscriptionResponse>('/api/cursor')

export const saveCursorSubscription = (config: CursorSubscriptionConfig) =>
  request<CursorMutationResponse>('/api/cursor/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })

export const refreshCursorSubscription = () =>
  request<CursorMutationResponse>('/api/cursor/refresh', { method: 'POST' })

export const deleteCursorSubscription = () =>
  request<CursorMutationResponse>('/api/cursor/delete', { method: 'POST' })

export const refreshAll = () => request<{ ok: boolean; results: { ok: boolean }[]; accounts: AccountsResponse['accounts'] }>(
  '/api/refresh-all', { method: 'POST' }
)

export const refreshSlot = (slot: string) => request<{ ok: boolean }>(
  `/api/accounts/${slot}/refresh`, { method: 'POST' }
)

export const createSlot = () => request<{ ok: boolean }>(
  '/api/accounts/create', { method: 'POST' }
)

export const connectOpenCodeGo = (credentials: { apiKey?: string; workspaceId?: string; authToken?: string }) => request<AccountsResponse>(
  '/api/opencode-go/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  }
)

export const loginSlot = (slot: string) => request<{ ok: boolean; authUrl: string }>(
  `/api/accounts/${slot}/login`, { method: 'POST' }
)

export const logoutSlot = (slot: string) => request<{ ok: boolean }>(
  `/api/accounts/${slot}/logout`, { method: 'POST' }
)

export const deleteSlot = (slot: string) => request<{ ok: boolean }>(
  `/api/accounts/${slot}/delete`, { method: 'POST' }
)

export const exchangeCallback = (slot: string, url: string) => request<{ ok: boolean }>(
  `/api/accounts/${slot}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }
)

export const fetchSettings = () => request<Settings>('/api/settings')

export const updateSettings = (settings: Partial<Settings>) => request<Settings>(
  '/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }
)

export const fetchHistory = (range: '24h' | '7d' | '30d') =>
  request<HistoryResponse>(`/api/history?range=${range}`)
