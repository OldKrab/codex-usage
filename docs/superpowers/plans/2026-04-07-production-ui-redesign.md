# Production UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla JS frontend with a polished React dashboard for monitoring ChatGPT/Codex account quotas at a glance.

**Architecture:** Vite builds React+TypeScript source into `dist/`, served by the existing `server.mjs`. Backend is extended with settings, history, and configurable auto-refresh endpoints. Frontend polls cached data every 5s; the server's own timer calls the OpenAI API at a user-configurable interval.

**Tech Stack:** React 19, TypeScript, Vite 6, Tailwind CSS 4, TanStack Query v5, Radix UI, Lucide React, Sonner, Recharts

**Project root:** `/path/to/codex-usage-dashboard`

---

### Task 1: Project Scaffolding

**Files:**
- Modify: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html` (project root — Vite entry)
- Modify: `server.mjs` (change PUBLIC_DIR)
- Remove: `public/index.html`, `public/styles.css`, `public/app.js`

- [ ] **Step 1: Back up old frontend and update server.mjs**

Move old vanilla files out of the way and point the server at `dist/`:

```bash
cd /path/to/codex-usage-dashboard
mkdir -p public-old
mv public/index.html public/styles.css public/app.js public-old/
```

In `server.mjs`, change line 10:

```js
// Before
const PUBLIC_DIR = path.join(__dirname, 'public');
// After
const PUBLIC_DIR = path.join(__dirname, 'dist');
```

- [ ] **Step 2: Install dependencies**

```bash
cd /path/to/codex-usage-dashboard
npm install react@^19 react-dom@^19 @tanstack/react-query@^5 @radix-ui/react-dropdown-menu lucide-react sonner recharts
npm install -D vite@^6 @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Create vite.config.ts**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:1455',
      '/auth': 'http://localhost:1455',
    },
  },
})
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create root index.html (Vite entry)**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Usage Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: Create minimal src/ to verify build**

Create `src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg: #0a0e17;
  --color-surface: #141922;
  --color-surface-hover: #1a2130;
  --color-border: #1e2a3a;
  --color-text: #e8ecf2;
  --color-text-muted: #6b7a8d;
  --color-good: #22c55e;
  --color-warn: #eab308;
  --color-bad: #ef4444;
  --color-accent: #3b82f6;
}

body {
  @apply bg-bg text-text;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  margin: 0;
}
```

Create `src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <div className="p-6">
    <h1 className="text-xl font-semibold">Codex Usage Dashboard</h1>
    <p className="text-text-muted mt-2">Scaffolding works.</p>
  </div>
)
```

- [ ] **Step 7: Add build scripts to package.json**

Update `package.json` scripts:

```json
{
  "scripts": {
    "start": "node server.mjs",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 8: Add dist/ and public-old/ to .gitignore**

Append to `.gitignore`:

```
dist/
public-old/
```

- [ ] **Step 9: Verify build**

```bash
cd /path/to/codex-usage-dashboard
npx vite build
ls dist/
```

Expected: `dist/index.html` and `dist/assets/` with hashed JS/CSS files.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + Tailwind project"
```

---

### Task 2: Backend — Settings, History, Configurable Refresh

**Files:**
- Modify: `server.mjs`

- [ ] **Step 1: Add settings management**

Add after the `STORE_PATH` constant (line 12):

```js
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const DEFAULT_SETTINGS = { refreshInterval: 300 };
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
```

Add after `saveStore` function:

```js
function loadSettings() {
  ensureStore();
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  ensureStore();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}
```

- [ ] **Step 2: Add history management**

Add after `saveSettings`:

```js
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch {}
  return { snapshots: [] };
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history) + '\n', 'utf8');
}

function appendSnapshot() {
  const history = loadHistory();
  const now = Date.now();

  // Don't store more than one snapshot per 5 minutes
  const lastTs = history.snapshots.length > 0
    ? history.snapshots[history.snapshots.length - 1].timestamp
    : 0;
  if (now - lastTs < 5 * 60 * 1000) return;

  const store = loadStore();
  const accounts = {};
  for (const [slot, account] of Object.entries(store.accounts)) {
    if (!account || !account.usage) continue;
    accounts[slot] = {
      email: account.email || null,
      windows: (account.usage.windows || []).map(w => ({
        label: w.label,
        usedPercent: w.usedPercent,
      })),
    };
  }

  if (Object.keys(accounts).length > 0) {
    history.snapshots.push({ timestamp: now, accounts });
  }

  // Prune entries older than 30 days
  const cutoff = now - MAX_HISTORY_AGE_MS;
  history.snapshots = history.snapshots.filter(s => s.timestamp > cutoff);

  saveHistory(history);
}
```

- [ ] **Step 3: Add /api/settings and /api/history endpoints**

In `handleApi`, add before the `slotMatch` regex (before line `const slotMatch = ...`):

```js
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      return json(res, 200, loadSettings());
    }
    if (req.method === 'PUT') {
      const body = await parseBody(req);
      const interval = Number(body.refreshInterval);
      if (isNaN(interval) || interval < 0) {
        return json(res, 400, { ok: false, error: 'Invalid refreshInterval' });
      }
      const settings = { refreshInterval: interval };
      saveSettings(settings);
      startAutoRefresh();
      return json(res, 200, { ok: true, ...settings });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    const range = url.searchParams.get('range') || '24h';
    const rangeMs = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 }[range] || 86400000;
    const cutoff = Date.now() - rangeMs;
    const history = loadHistory();
    const filtered = history.snapshots.filter(s => s.timestamp > cutoff);
    return json(res, 200, { snapshots: filtered });
  }
```

- [ ] **Step 4: Add snapshot after refresh-all**

In the `POST /api/refresh-all` handler, add `appendSnapshot()` before the return:

```js
  if (req.method === 'POST' && url.pathname === '/api/refresh-all') {
    const store = loadStore();
    const slots = Object.keys(store.accounts);
    const results = await Promise.all(slots.map((slot) => refreshUsageForSlot(slot)));
    appendSnapshot();
    return json(res, 200, { ok: true, results, accounts: getAccountsView() });
  }
```

- [ ] **Step 5: Replace hardcoded auto-refresh with configurable timer**

Replace the bottom of the file (the `AUTO_REFRESH_MS`, `autoRefreshAll`, `setInterval`, `setTimeout` block — lines 582-596) with:

```js
let autoRefreshTimer = null;

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  const settings = loadSettings();
  const interval = settings.refreshInterval * 1000;
  if (interval <= 0) {
    console.log('Auto-refresh: disabled');
    return;
  }
  console.log(`Auto-refresh: every ${settings.refreshInterval}s`);
  autoRefreshTimer = setInterval(async () => {
    await autoRefreshAll();
    appendSnapshot();
  }, interval);
}

// Initial refresh 10s after startup
setTimeout(async () => {
  await autoRefreshAll();
  appendSnapshot();
}, 10_000);

startAutoRefresh();
```

Keep the existing `autoRefreshAll` function as-is (just move it above `startAutoRefresh` if needed).

- [ ] **Step 6: Verify endpoints**

```bash
# With server running:
curl -s http://localhost:1455/api/settings | python3 -m json.tool
curl -s -X PUT -H 'Content-Type: application/json' -d '{"refreshInterval":60}' http://localhost:1455/api/settings | python3 -m json.tool
curl -s 'http://localhost:1455/api/history?range=24h' | python3 -m json.tool
```

Expected: settings returns `{"refreshInterval": 300}` (default), PUT updates it, history returns `{"snapshots": []}` (initially empty).

- [ ] **Step 7: Commit**

```bash
git add server.mjs
git commit -m "feat: add settings, history, configurable auto-refresh endpoints"
```

---

### Task 3: Frontend Library Layer

**Files:**
- Create: `src/types/api.ts`
- Create: `src/lib/api.ts`
- Create: `src/lib/utils.ts`
- Create: `src/lib/router.ts`
- Create: `src/lib/hooks.ts`

- [ ] **Step 1: Create TypeScript types**

Create `src/types/api.ts`:

```ts
export interface QuotaWindow {
  label: string
  usedPercent: number
  resetAt: number | null
}

export interface UsageData {
  plan: string | null
  windows: QuotaWindow[]
}

export interface Account {
  slot: string
  connected: boolean
  email: string | null
  accountId: string | null
  planTypeFromJwt: string | null
  usage: UsageData | null
  expires: number | null
  updatedAt: number | null
  lastCheckedAt: number | null
  lastError: string | null
}

export interface AccountsResponse {
  accounts: Account[]
}

export interface Settings {
  refreshInterval: number
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
```

- [ ] **Step 2: Create API client**

Create `src/lib/api.ts`:

```ts
import type { AccountsResponse, Settings, HistoryResponse } from '../types/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed: ${res.status}`)
  }
  return res.json()
}

export const fetchAccounts = () => request<AccountsResponse>('/api/accounts')

export const refreshAll = () => request<{ ok: boolean; results: { ok: boolean }[]; accounts: AccountsResponse['accounts'] }>(
  '/api/refresh-all', { method: 'POST' }
)

export const refreshSlot = (slot: string) => request<{ ok: boolean }>(
  `/api/accounts/${slot}/refresh`, { method: 'POST' }
)

export const createSlot = () => request<{ ok: boolean }>(
  '/api/accounts/create', { method: 'POST' }
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

export const updateSettings = (settings: Settings) => request<Settings>(
  '/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }
)

export const fetchHistory = (range: '24h' | '7d' | '30d') =>
  request<HistoryResponse>(`/api/history?range=${range}`)
```

- [ ] **Step 3: Create utility functions**

Create `src/lib/utils.ts`:

```ts
export type QuotaStatus = 'good' | 'warn' | 'bad'

export function getQuotaStatus(usedPercent: number): QuotaStatus {
  if (usedPercent > 80) return 'bad'
  if (usedPercent >= 50) return 'warn'
  return 'good'
}

export function getRemainingPercent(usedPercent: number): number {
  return Math.max(0, 100 - usedPercent)
}

export function formatTimeLeft(resetAt: number | null): string {
  if (!resetAt) return ''
  const diff = resetAt - Date.now()
  if (diff <= 0) return 'now'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || parts.length === 0) parts.push(`${m}m`)
  return parts.join(' ')
}

export function formatRelativeTime(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function formatResetTime(ts: number | null): string {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return `Today, ${timeStr}`
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${timeStr}`
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${dateStr}, ${timeStr}`
}

export const STATUS_COLORS = {
  good: { text: 'text-good', bg: 'bg-good' },
  warn: { text: 'text-warn', bg: 'bg-warn' },
  bad: { text: 'text-bad', bg: 'bg-bad' },
} as const
```

- [ ] **Step 4: Create hash router**

Create `src/lib/router.ts`:

```ts
import { useSyncExternalStore } from 'react'

function getHash(): string {
  return window.location.hash.slice(1) || '/'
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, getHash)
}

export function navigate(path: string): void {
  window.location.hash = path
}
```

- [ ] **Step 5: Create TanStack Query hooks**

Create `src/lib/hooks.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { AccountsResponse, Settings, HistoryResponse } from '../types/api'

export function useAccounts() {
  return useQuery<AccountsResponse>({
    queryKey: ['accounts'],
    queryFn: api.fetchAccounts,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
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
    mutationFn: api.updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: add frontend library layer (types, api, hooks, utils, router)"
```

---

### Task 4: App Shell and Global CSS

**Files:**
- Modify: `src/main.tsx`
- Create: `src/App.tsx`

- [ ] **Step 1: Create App.tsx with router**

Create `src/App.tsx`:

```tsx
import { useRoute } from './lib/router'
import { Dashboard } from './pages/Dashboard'
import { History } from './pages/History'

export function App() {
  const route = useRoute()
  return route === '/history' ? <History /> : <Dashboard />
}
```

- [ ] **Step 2: Create placeholder pages**

Create `src/pages/Dashboard.tsx`:

```tsx
export function Dashboard() {
  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6">
      <h1 className="text-xl font-semibold">Dashboard placeholder</h1>
    </main>
  )
}
```

Create `src/pages/History.tsx`:

```tsx
export function History() {
  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6">
      <h1 className="text-xl font-semibold">History placeholder</h1>
    </main>
  )
}
```

- [ ] **Step 3: Update main.tsx with providers**

Replace `src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="bottom-right" theme="dark" richColors />
    </QueryClientProvider>
  </StrictMode>
)
```

- [ ] **Step 4: Verify dev server works**

```bash
npx vite build
```

Expected: Build succeeds. `dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add app shell with router, providers, placeholder pages"
```

---

### Task 5: Dashboard Components

**Files:**
- Create: `src/components/QuotaBlock.tsx`
- Create: `src/components/KebabMenu.tsx`
- Create: `src/components/AccountCard.tsx`
- Create: `src/components/EmptyCard.tsx`
- Create: `src/components/AddCard.tsx`

- [ ] **Step 1: Create QuotaBlock**

Create `src/components/QuotaBlock.tsx`:

```tsx
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

  return (
    <div className="rounded-lg bg-[#0d1117] p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-text-muted font-medium">{label}</span>
        <span className={`text-2xl font-bold tabular-nums ${colors.text}`}>
          {remaining.toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${colors.bg} transition-[width] duration-300 ease-out`}
          style={{ width: `${remaining}%` }}
        />
      </div>
      <div className="text-xs">
        <div className="text-text">Resets in {formatTimeLeft(w.resetAt)}</div>
        <div className="text-text-muted text-[11px] mt-0.5">{formatResetTime(w.resetAt)}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create KebabMenu**

Create `src/components/KebabMenu.tsx`:

```tsx
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreVertical, LogOut, Trash2 } from 'lucide-react'
import type { Account } from '../types/api'
import { useLogoutSlot, useDeleteSlot } from '../lib/hooks'
import { toast } from 'sonner'

export function KebabMenu({ account }: { account: Account }) {
  const logoutSlot = useLogoutSlot()
  const deleteSlot = useDeleteSlot()

  const handleLogout = async () => {
    try {
      await logoutSlot.mutateAsync(account.slot)
      toast.success('Logged out')
    } catch (err) {
      toast.error(`Logout failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteSlot.mutateAsync(account.slot)
      toast.success('Slot deleted')
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="p-1 rounded-md hover:bg-white/[0.06] transition-colors"
          aria-label="More actions"
        >
          <MoreVertical className="w-4 h-4 text-text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bg-surface-hover rounded-lg p-1 min-w-[140px] shadow-xl shadow-black/40 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
          sideOffset={4}
          align="end"
        >
          {account.connected && (
            <DropdownMenu.Item
              onSelect={handleLogout}
              className="flex items-center gap-2 px-3 py-2 text-sm text-bad rounded-md cursor-pointer outline-none hover:bg-white/[0.06] focus:bg-white/[0.06]"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </DropdownMenu.Item>
          )}
          {!account.connected && (
            <DropdownMenu.Item
              onSelect={handleDelete}
              className="flex items-center gap-2 px-3 py-2 text-sm text-bad rounded-md cursor-pointer outline-none hover:bg-white/[0.06] focus:bg-white/[0.06]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete slot
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
```

- [ ] **Step 3: Create AccountCard**

Create `src/components/AccountCard.tsx`:

```tsx
import { RefreshCw } from 'lucide-react'
import type { Account } from '../types/api'
import { QuotaBlock } from './QuotaBlock'
import { KebabMenu } from './KebabMenu'
import { formatRelativeTime } from '../lib/utils'
import { useRefreshSlot } from '../lib/hooks'
import { toast } from 'sonner'

export function AccountCard({ account }: { account: Account }) {
  const refreshSlot = useRefreshSlot()
  const windows = account.usage?.windows ?? []
  const w5h = windows.find(w => w.label?.includes('h'))
  const wWeek = windows.find(w =>
    w.label?.toLowerCase().includes('week') || w.label?.toLowerCase().includes('day')
  )
  const plan = account.usage?.plan ?? account.planTypeFromJwt

  const handleRefresh = async () => {
    try {
      await refreshSlot.mutateAsync(account.slot)
    } catch (err) {
      toast.error(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <article className="bg-surface rounded-xl p-4 hover:bg-surface-hover transition-colors duration-150">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold truncate">
            {account.email ?? 'Unknown'}
          </h2>
          {plan && (
            <span className="text-[11px] uppercase tracking-wide text-text-muted">
              {plan}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-2 h-2 rounded-full bg-good" />
          <KebabMenu account={account} />
        </div>
      </div>

      <div className="space-y-2.5 mb-3">
        {w5h && <QuotaBlock window={w5h} label="5h Quota" />}
        {wWeek && <QuotaBlock window={wWeek} label="Weekly Quota" />}
        {!windows.length && (
          <div className="text-sm text-text-muted py-2">No usage data yet</div>
        )}
      </div>

      {account.lastError && (
        <div className="text-xs text-bad bg-bad/10 rounded-lg px-3 py-2 mb-3 break-words">
          {account.lastError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
        <span>{formatRelativeTime(account.lastCheckedAt)}</span>
        <button
          onClick={handleRefresh}
          disabled={refreshSlot.isPending}
          className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${refreshSlot.isPending ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
    </article>
  )
}
```

- [ ] **Step 4: Create EmptyCard**

Create `src/components/EmptyCard.tsx`:

```tsx
import { useState } from 'react'
import { LogIn } from 'lucide-react'
import type { Account } from '../types/api'
import { KebabMenu } from './KebabMenu'
import { useLoginSlot, useExchangeCallback } from '../lib/hooks'
import { toast } from 'sonner'

export function EmptyCard({ account }: { account: Account }) {
  const loginSlot = useLoginSlot()
  const exchangeCallback = useExchangeCallback()
  const [callbackUrl, setCallbackUrl] = useState('')

  const handleLogin = async () => {
    try {
      const data = await loginSlot.mutateAsync(account.slot)
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      toast.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleExchange = async () => {
    if (!callbackUrl.trim()) return
    try {
      await exchangeCallback.mutateAsync({ slot: account.slot, url: callbackUrl.trim() })
      setCallbackUrl('')
      toast.success('Account connected')
    } catch (err) {
      toast.error(`Exchange failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <article className="bg-surface rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-4">
        <h2 className="text-[15px] font-semibold text-text-muted">Empty slot</h2>
        <KebabMenu account={account} />
      </div>

      <div className="flex flex-col items-center gap-3 py-4">
        <button
          onClick={handleLogin}
          disabled={loginSlot.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg font-medium text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          <LogIn className="w-4 h-4" />
          Login
        </button>
      </div>

      <div className="p-3 bg-[#0d1117] rounded-lg">
        <p className="text-xs text-text-muted mb-2">
          After authorization, paste the callback URL:
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={callbackUrl}
            onChange={e => setCallbackUrl(e.target.value)}
            placeholder="http://localhost:1455/auth/callback?code=…"
            className="flex-1 bg-bg text-text border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent"
            onKeyDown={e => e.key === 'Enter' && handleExchange()}
          />
          <button
            onClick={handleExchange}
            disabled={exchangeCallback.isPending}
            className="px-3 py-1.5 bg-surface-hover text-text rounded-md text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {exchangeCallback.isPending ? '⏳' : 'OK'}
          </button>
        </div>
      </div>
    </article>
  )
}
```

- [ ] **Step 5: Create AddCard**

Create `src/components/AddCard.tsx`:

```tsx
import { Plus } from 'lucide-react'
import { useCreateSlot } from '../lib/hooks'

export function AddCard() {
  const createSlot = useCreateSlot()

  return (
    <button
      onClick={() => createSlot.mutate()}
      disabled={createSlot.isPending}
      className="border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[200px] hover:border-text-muted hover:bg-surface/50 transition-colors cursor-pointer disabled:opacity-50"
    >
      <Plus className="w-8 h-8 text-text-muted" />
      <span className="text-sm text-text-muted font-medium">Add Account</span>
    </button>
  )
}
```

- [ ] **Step 6: Verify build compiles**

```bash
npx vite build
```

Expected: Build succeeds (components are not yet used in pages, but TypeScript should compile).

- [ ] **Step 7: Commit**

```bash
git add src/components/
git commit -m "feat: add dashboard components (QuotaBlock, AccountCard, EmptyCard, AddCard, KebabMenu)"
```

---

### Task 6: TopBar, RefreshPicker, and Dashboard Page

**Files:**
- Create: `src/components/RefreshPicker.tsx`
- Create: `src/components/TopBar.tsx`
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Create RefreshPicker**

Create `src/components/RefreshPicker.tsx`:

```tsx
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Timer, Check } from 'lucide-react'
import { useSettings, useUpdateSettings } from '../lib/hooks'

const INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
] as const

export function RefreshPicker() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const current = settings?.refreshInterval ?? 300
  const currentLabel = INTERVALS.find(i => i.value === current)?.label ?? `${current}s`

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-sm text-text-muted transition-colors">
          <Timer className="w-3.5 h-3.5" />
          <span>{currentLabel}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bg-surface-hover rounded-lg p-1 min-w-[120px] shadow-xl shadow-black/40 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
          sideOffset={4}
          align="end"
        >
          {INTERVALS.map(({ label, value }) => (
            <DropdownMenu.Item
              key={value}
              onSelect={() => updateSettings.mutate({ refreshInterval: value })}
              className="flex items-center justify-between px-3 py-2 text-sm rounded-md cursor-pointer outline-none hover:bg-white/[0.06] focus:bg-white/[0.06]"
            >
              <span>{label}</span>
              {current === value && <Check className="w-3.5 h-3.5 text-accent" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
```

- [ ] **Step 2: Create TopBar**

Create `src/components/TopBar.tsx`:

```tsx
import { RefreshCw, BarChart3 } from 'lucide-react'
import { RefreshPicker } from './RefreshPicker'
import { useRefreshAll } from '../lib/hooks'
import { navigate } from '../lib/router'
import { toast } from 'sonner'

export function TopBar() {
  const refreshAll = useRefreshAll()

  const handleRefreshAll = async () => {
    try {
      const data = await refreshAll.mutateAsync()
      const results = data.results ?? []
      const ok = results.filter(r => r.ok).length
      const fail = results.filter(r => !r.ok).length
      if (fail > 0) {
        toast.error(`Refreshed: ${ok} ok, ${fail} failed`)
      } else {
        toast.success(`${ok} account${ok !== 1 ? 's' : ''} refreshed`)
      }
    } catch {
      toast.error('Refresh failed')
    }
  }

  return (
    <header className="flex items-center justify-between gap-4 mb-6">
      <h1 className="text-xl font-semibold">Codex Usage</h1>
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/history')}
          className="p-2 rounded-lg hover:bg-surface transition-colors"
          title="Usage history"
        >
          <BarChart3 className="w-4 h-4 text-text-muted" />
        </button>
        <RefreshPicker />
        <button
          onClick={handleRefreshAll}
          disabled={refreshAll.isPending}
          className="p-2 rounded-lg bg-surface hover:bg-surface-hover transition-colors disabled:opacity-50"
          title="Refresh all"
        >
          <RefreshCw
            className={`w-4 h-4 text-text-muted ${refreshAll.isPending ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Implement Dashboard page**

Replace `src/pages/Dashboard.tsx`:

```tsx
import { useAccounts } from '../lib/hooks'
import { TopBar } from '../components/TopBar'
import { AccountCard } from '../components/AccountCard'
import { EmptyCard } from '../components/EmptyCard'
import { AddCard } from '../components/AddCard'

export function Dashboard() {
  const { data, isLoading } = useAccounts()
  const accounts = data?.accounts ?? []

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6 max-sm:px-4">
      <TopBar />
      {isLoading ? (
        <div className="text-text-muted text-center py-12">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map(account =>
            account.connected
              ? <AccountCard key={account.slot} account={account} />
              : <EmptyCard key={account.slot} account={account} />
          )}
          <AddCard />
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Build and verify**

```bash
npx vite build
```

Expected: Build succeeds. Dashboard is functional with real data.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: implement dashboard page with TopBar, RefreshPicker, card grid"
```

---

### Task 7: History Page

**Files:**
- Modify: `src/pages/History.tsx`

- [ ] **Step 1: Implement History page**

Replace `src/pages/History.tsx`:

```tsx
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useHistory, useAccounts } from '../lib/hooks'
import { navigate } from '../lib/router'

type Range = '24h' | '7d' | '30d'

export function History() {
  const [range, setRange] = useState<Range>('24h')
  const { data: historyData, isLoading } = useHistory(range)
  const { data: accountsData } = useAccounts()

  const accounts = accountsData?.accounts ?? []
  const snapshots = historyData?.snapshots ?? []

  const accountChartData = accounts
    .filter(a => a.connected)
    .map(account => {
      const points = snapshots
        .filter(s => s.accounts[account.slot])
        .map(s => {
          const acct = s.accounts[account.slot]
          const w5h = acct.windows.find(w => w.label?.includes('h'))
          const wWeek = acct.windows.find(w =>
            w.label?.toLowerCase().includes('week') ||
            w.label?.toLowerCase().includes('day')
          )
          return {
            time: s.timestamp,
            '5h': w5h ? Math.max(0, 100 - w5h.usedPercent) : null,
            Weekly: wWeek ? Math.max(0, 100 - wWeek.usedPercent) : null,
          }
        })
      return { email: account.email ?? account.slot, points }
    })

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    if (range === '24h') {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6 max-sm:px-4">
      <header className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-surface transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-text-muted" />
          </button>
          <h1 className="text-xl font-semibold">Usage History</h1>
        </div>
        <div className="flex gap-1 bg-surface rounded-lg p-1">
          {(['24h', '7d', '30d'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                range === r
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="text-text-muted text-center py-12">Loading…</div>
      ) : accountChartData.length === 0 ? (
        <div className="text-text-muted text-center py-12">No history data yet</div>
      ) : (
        <div className="space-y-6">
          {accountChartData.map(({ email, points }) => (
            <section key={email} className="bg-surface rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-4">{email}</h2>
              {points.length === 0 ? (
                <div className="text-text-muted text-sm py-4">
                  No data for this period
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatTime}
                      stroke="#6b7a8d"
                      fontSize={11}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="#6b7a8d"
                      fontSize={11}
                      tickFormatter={v => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#1a2130',
                        border: '1px solid #1e2a3a',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={formatTime}
                      formatter={(value: number) => [`${value.toFixed(0)}%`]}
                    />
                    <Line
                      type="monotone"
                      dataKey="5h"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="Weekly"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
npx vite build
```

Expected: Build succeeds. History page accessible via `#/history`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/History.tsx
git commit -m "feat: implement history page with Recharts line charts"
```

---

### Task 8: Production Build, Deploy, and Visual Verification

**Files:**
- Modify: `.gitignore`
- Modify: systemd service (restart)

- [ ] **Step 1: Production build**

```bash
cd /path/to/codex-usage-dashboard
npm run build
ls -la dist/
```

Expected: `dist/index.html` plus `dist/assets/` with hashed JS/CSS bundles.

- [ ] **Step 2: Restart service**

```bash
systemctl --user restart codex-usage-dashboard
sleep 2
systemctl --user status codex-usage-dashboard
```

Expected: Service is active and running.

- [ ] **Step 3: Verify API still works**

```bash
curl -s http://localhost:1455/api/accounts | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d[\"accounts\"])} accounts')"
curl -s http://localhost:1455/api/settings | python3 -m json.tool
```

Expected: Account count matches (3 accounts), settings return JSON.

- [ ] **Step 4: Visual verification with Playwright — Desktop**

Open the dashboard at `http://localhost:1455` in a 1280×800 viewport. Take a screenshot. Verify:
- Dark background, cards visible in a 3-column grid
- Each card shows email, plan, two quota bars with large percentages
- Progress bars are colored green/yellow/red appropriately
- Top bar shows "Codex Usage" title and refresh controls
- Clean, professional look — no layout breaks

- [ ] **Step 5: Visual verification with Playwright — Mobile**

Resize viewport to 480×900. Take a screenshot. Verify:
- Cards stack in a single column
- Text and bars are readable
- No horizontal overflow

- [ ] **Step 6: Test auto-refresh picker**

Click the refresh interval dropdown. Select "30s". Verify:
- Dropdown shows options (Off, 10s, 30s, 1m, 5m)
- Selected option shows a check mark
- Server receives `PUT /api/settings` with new interval

- [ ] **Step 7: Test history page**

Navigate to `#/history`. Take a screenshot. Verify:
- Back arrow and "Usage History" title visible
- Time range selector (24h/7d/30d) visible
- Charts render (may show "No history data yet" if no snapshots exist)

- [ ] **Step 8: Clean up and final commit**

```bash
rm -rf public-old/
git add -A
git commit -m "feat: production build of new React dashboard"
```

- [ ] **Step 9: Final visual review**

Take a final full-page screenshot at desktop resolution. Compare against the spec design goals:
- ✅ Polished, professional dark theme
- ✅ Large quota percentages are the most prominent element
- ✅ Color-coded progress bars (green → yellow → red)
- ✅ Live reset countdowns
- ✅ Grafana-style auto-refresh picker
- ✅ Responsive layout
- ✅ Toast notifications on actions
