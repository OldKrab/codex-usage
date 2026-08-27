# Codex Usage Dashboard — Production UI Redesign

## Goal

Replace the prototype vanilla JS frontend with a polished, production-ready React dashboard optimized for 2-3 second glanceable monitoring of ChatGPT/Codex account quotas.

## Core User Story

A user with 1–10 ChatGPT Plus accounts opens the dashboard, instantly sees how much quota remains on each account and when it resets, then closes the tab. Account management (add, login, logout, delete) happens rarely.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Build | Vite 6 | Dev server + production bundler |
| UI | React 19 + TypeScript | Component framework |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| Data | TanStack Query v5 | Server state, polling, cache |
| Primitives | Radix UI | Dropdown, popover, dialog |
| Icons | Lucide React | Consistent icon set |
| Toasts | Sonner | Non-blocking notifications |
| Charts | Recharts | History page line charts |

## Architecture

### Build Pipeline

```
src/                     → Vite build →  public/
  main.tsx                                 index.html
  App.tsx                                  assets/
  components/                              (replaces old vanilla files)
  pages/
  lib/
  types/
```

Vite builds into `public/`, replacing the old vanilla HTML/CSS/JS files. The existing `server.mjs` serves static files from `public/` — no changes needed to the static serving logic.

### Backend Changes

The existing `server.mjs` is extended with:

1. **`GET /api/settings`** — Returns current settings (auto-refresh interval).
2. **`PUT /api/settings`** — Updates settings. Persisted in `data/settings.json`.
3. **`GET /api/history?range=24h|7d|30d`** — Returns usage snapshots for the history page.
4. **Snapshot storage** — Every time `refreshUsageForSlot` succeeds, append a timestamped snapshot to `data/history.json`. Prune entries older than 30 days.
5. **Configurable auto-refresh** — Replace hardcoded `setInterval(autoRefreshAll, 4h)` with interval from settings. When the frontend sends `PUT /api/settings { refreshInterval: 60 }`, the server restarts its refresh timer.

### Data Flow

```
User opens dashboard
  → React mounts, TanStack Query fetches GET /api/accounts
  → Cards render with cached server data
  → TanStack Query polls GET /api/accounts every 5s to pick up fresh cached data
  → "Refresh All" button → POST /api/refresh-all → server calls OpenAI API → returns fresh data
  → Per-card refresh → POST /api/accounts/:slot/refresh → same flow
```

The auto-refresh dropdown controls the **server's** refresh timer interval via `PUT /api/settings`. The server runs the OpenAI API calls on its own timer — this works even when the browser is closed. The frontend polls `GET /api/accounts` every 5 seconds to pick up the latest cached data (cheap, reads local JSON). Manual "Refresh All" triggers an immediate `POST /api/refresh-all`.

## Pages

### 1. Dashboard (Main Page — `/`)

The primary view, optimized for instant comprehension.

**Top Bar:**
- Left: "Codex Usage" title (clean, no subtitle)
- Right: Auto-refresh dropdown `[Off | 10s | 30s | 1m | 5m]` + manual refresh icon button
- The dropdown shows the currently selected interval with a play/pause visual indicator
- Persisted in localStorage and synced to server settings

**Account Cards Grid:**
- Responsive grid: 3 columns on desktop (>1024px), 2 on tablet (641-1024px), 1 on mobile (≤640px)
- Minimum card width ~280px

**Each Account Card:**
```
┌─────────────────────────────────┐
│  user@gmail.com          Plus ⋮ │  ← Email (full), plan pill, kebab
│                                 │
│  5h Quota                       │
│  ████████████████  100%         │  ← Large %, colored bar
│  Resets in 4h 41m               │  ← Live countdown
│                                 │
│  Weekly Quota                   │
│  ██░░░░░░░░░░░░░░   18%        │  ← Red when low
│  Resets in 17h 1m               │  ← Live countdown
│                                 │
│              Checked 16m ago  ↻ │  ← Small timestamp + refresh icon
└─────────────────────────────────┘
```

- **Percentage numbers**: 24px+ font, bold, the most prominent element
- **Progress bars**: Horizontal, rounded, 6px height, smooth gradient transitions
- **Color scale**: Green (0-49% used) → Yellow (50-79%) → Red (80-100%)
- **Reset countdown**: Updates every minute via client-side timer (no API call)
- **Kebab menu**: Contains Logout (if connected) and Delete (if disconnected)
- **Card border**: Subtle, no special "best" highlighting — all accounts treated equally
- **Error state**: If `lastError` exists, show a red banner inside the card with the error text

**Disconnected Card:**
```
┌─────────────────────────────────┐
│  Empty slot                   ⋮ │
│                                 │
│         [ Login ]               │  ← Primary button, centered
│                                 │
│  After OAuth, paste callback:   │  ← Always visible for remote use
│  [_________________________] OK │
│                                 │
└─────────────────────────────────┘
```

**Add Card:**
- Dashed border card at the end of the grid
- "+" icon centered, muted text "Add Account"
- Clicking creates a slot (POST /api/accounts/create) and shows the login card

**Toast Notifications:**
- Bottom-right position
- Success: "3 accounts refreshed" (green)
- Error: "Failed to refresh user@gmail.com: ..." (red)
- Auto-dismiss after 4 seconds

### 2. History Page (`/history`)

Accessible via a small chart icon in the top bar, next to the auto-refresh controls.

**Layout:**
- Time range selector: `[24h] [7d] [30d]` toggle buttons
- One chart section per account
- Each section: account email as header, two line charts (5h usage % and weekly usage % over time)
- Charts use Recharts `<LineChart>` with time on X-axis, percentage on Y-axis
- Tooltip on hover showing exact values
- Responsive: charts stack vertically on mobile

**Data:**
- `GET /api/history?range=24h` returns snapshots within that range
- Each snapshot: `{ timestamp, slot, usage: { windows: [...] } }`
- Server stores max 30 days of data, auto-prunes on write

### Client-Side Routing

Use simple hash-based routing (`#/` and `#/history`) to avoid any server-side routing changes. No need for react-router — a small custom hook is sufficient for 2 pages.

## Design System

### Colors (Dark Theme)

```
--bg:           #0a0e17    (page background)
--surface:      #141922    (card background)
--surface-hover: #1a2130   (card hover)
--border:       #1e2a3a    (subtle borders)
--text:         #e8ecf2    (primary text)
--text-muted:   #6b7a8d    (secondary text)
--green:        #22c55e    (good — 0-49% used)
--yellow:       #eab308    (warning — 50-79% used)
--red:          #ef4444    (critical — 80-100% used)
--accent:       #3b82f6    (interactive elements, links)
```

### Typography

- Font: System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- Card title (email): 15px, semibold
- Quota percentage: 24px, bold
- Quota label: 12px, muted
- Reset time: 13px, normal
- Plan badge: 11px, uppercase

### Spacing

- Page padding: 24px (16px on mobile)
- Card padding: 16px
- Card gap: 16px (12px on mobile)
- Card border-radius: 12px

### Animations

- Card hover: subtle elevation increase (box-shadow transition, 150ms)
- Progress bar fill: width transition 300ms ease
- Page transitions: none (instant, it's a 2-page app)
- Toast enter/exit: slide + fade (handled by Sonner)

## File Structure

```
codex-usage-dashboard/
├── server.mjs                    ← Extended with /api/settings, /api/history, snapshot storage
├── package.json                  ← Add devDependencies for Vite/React/etc
├── vite.config.ts                ← Vite config, output to public/
├── tsconfig.json
├── tailwind.config.ts
├── index.html                    ← Vite entry point (root level)
├── src/
│   ├── main.tsx                  ← React entry point
│   ├── App.tsx                   ← Router + layout
│   ├── types/api.ts              ← TypeScript types for API responses
│   ├── lib/
│   │   ├── api.ts                ← API client (fetch wrappers)
│   │   ├── hooks.ts              ← TanStack Query hooks
│   │   ├── utils.ts              ← Formatting, color logic
│   │   └── router.ts             ← Simple hash router hook
│   ├── components/
│   │   ├── TopBar.tsx
│   │   ├── RefreshPicker.tsx     ← Grafana-style auto-refresh dropdown
│   │   ├── AccountCard.tsx       ← Connected account card
│   │   ├── EmptyCard.tsx         ← Disconnected slot / login form
│   │   ├── AddCard.tsx           ← "+ Add Account" placeholder
│   │   ├── QuotaBlock.tsx        ← Single quota bar (5h or weekly)
│   │   ├── KebabMenu.tsx         ← Per-card actions menu
│   │   └── StatusDot.tsx         ← Tiny colored circle indicator
│   └── pages/
│       ├── Dashboard.tsx
│       └── History.tsx
├── public/                       ← Vite build output (served by server.mjs)
│   ├── index.html
│   └── assets/
├── data/
│   ├── accounts.json             ← Existing account storage
│   ├── settings.json             ← New: { refreshInterval: 60 }
│   └── history.json              ← New: append-only usage snapshots
└── docs/
```

## Backend API Changes

### New Endpoints

**`GET /api/settings`**
```json
{ "refreshInterval": 60 }
```
`refreshInterval` is in seconds. `0` means auto-refresh is off. Default: `300` (5 minutes).

**`PUT /api/settings`**
```json
{ "refreshInterval": 60 }
```
Updates `data/settings.json` and restarts the server's auto-refresh timer.

**`GET /api/history?range=24h|7d|30d`**
```json
{
  "snapshots": [
    {
      "timestamp": 1712500000000,
      "accounts": {
        "slot1": {
          "email": "user@gmail.com",
          "windows": [
            { "label": "5h", "usedPercent": 45 },
            { "label": "Week", "usedPercent": 23 }
          ]
        }
      }
    }
  ]
}
```

### Modified Behavior

- `refreshUsageForSlot` — after successful refresh, append snapshot to `data/history.json`
- Server startup — read `data/settings.json`, start auto-refresh timer with configured interval
- History pruning — on each write, remove snapshots older than 30 days

## Verification Plan

1. Build succeeds (`npm run build` produces files in `public/`)
2. Server starts and serves the new UI
3. Dashboard renders account cards with correct data
4. Auto-refresh picker works (dropdown, interval changes, persists)
5. Manual refresh works (per-card and refresh-all)
6. Add/Login/Logout/Delete account flows work
7. History page shows charts with snapshot data
8. Mobile responsive layout (single column ≤640px)
9. **Visual verification via Playwright screenshots** — UI looks polished and professional
10. No regressions in OAuth flow or token management

## Scope Exclusions

- No authentication (already behind Authelia)
- No PWA / offline support
- No code review rate limit display
- No "best account" selection logic
- No push notifications
- No multi-user support
