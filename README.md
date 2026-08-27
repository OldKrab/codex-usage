# Codex Usage Dashboard

Self-hosted web app for monitoring ChatGPT / Codex, Claude Code, and Cursor subscription usage.

## Features

- **Cursor subscription card** — manually track plan price and renewal date, plus live included, Cursor-model, and other-model usage when the local Cursor Agent session is available
- **Multi-account dashboard** — add/remove ChatGPT accounts via OAuth
- **Quota tracking** — 5h and weekly usage windows with progress bars and reset times
- **Subscription status** — plan type and expiry extracted from OAuth id_token (no Cloudflare issues)
- **Claude Code monitoring** — read-only card from the local `claude` login, with subscription tier and quota windows when Claude's usage API returns them
- **History charts** — 24h / 7d / 30d usage trends per account (Recharts)
- **Two-tier auto-refresh**:
  - **Live** (client-side) — polls when the page is open (Off / 10s / 30s / 1m / 5m)
  - **Background** (server-side) — refreshes when no browser is connected (1m / 5m / 15m / 30m)
- **Auto token refresh** — OAuth tokens are refreshed before expiry

## Tech Stack

- **Backend:** Node.js (plain HTTP server, ESM), `undici` for proxied fetch
- **Frontend:** React 19, Vite 6, Tailwind CSS 4, TypeScript, Radix UI, Recharts, TanStack Query
- **Data:** JSON files in `data/` (no database needed)

## Setup

```bash
npm install
npx vite build   # build frontend
npm start         # start server
```

With custom port:

```bash
PORT=1455 npm start
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `1455` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `OPENAI_PROXY` | _(unset)_ | HTTP proxy for OpenAI requests (takes priority) |
| `CLAUDE_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | Claude Code OAuth credential file |
| `https_proxy` / `http_proxy` | _(unset)_ | Standard env proxy (used when `OPENAI_PROXY` is not set) |

### Proxy

OpenAI and Claude API requests are routed through the proxy.
Priority: `OPENAI_PROXY` → `https_proxy` → `http_proxy`.

Uses `undici.fetch` with `ProxyAgent` (global `fetch` in Node 25 does not support
third-party dispatchers due to undici version mismatch).

## Cursor live usage

The Cursor card stores only the plan name, subscription price, renewal date, and the latest
usage snapshot in data/cursor.json. It reads the access token from the local Cursor Agent
session (or CURSOR_ACCESS_TOKEN) and does not persist that token.

Cursor's live usage endpoint is not a stable public API. If it changes or the local session
expires, the card keeps the manual subscription details and shows the refresh error.

## OAuth & Remote Access

OAuth redirect URI is bound to `http://localhost:$PORT/auth/callback` (Codex OAuth client restriction).

When the dashboard runs on a remote server behind a domain, the localhost redirect won't reach
the browser. Use the manual callback URL paste feature: after OAuth authorization, copy the URL
from the browser address bar and paste it into the input field on the dashboard page.

## Data Storage

- data/cursor.json — Cursor subscription details and cached live usage (gitignored)
- `data/accounts.json` — OAuth tokens and account state (gitignored)
- `data/claude-code.json` — cached Claude Code status and usage state (gitignored)
- `data/settings.json` — refresh intervals (`liveInterval`, `backgroundInterval`)
- `data/history.json` — usage snapshots for history charts

## Structure

```
server.mjs          — backend: HTTP server, OAuth, API, auto-refresh
src/                — React frontend source
  components/       — AccountCard, QuotaBlock, RefreshPicker, TopBar, etc.
  pages/            — Dashboard, History
  lib/              — API client, hooks, utils, router
  types/            — TypeScript interfaces
dist/               — built frontend (served by server.mjs)
data/               — local storage (gitignored)
```
