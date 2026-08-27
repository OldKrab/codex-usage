# Codex Usage Dashboard

A self-hosted dashboard for tracking ChatGPT / Codex subscription limits. It shows how much quota is left, whether current usage is sustainable, and when each limit resets.

Claude Code, Cursor, and OpenCode Go can be shown as secondary integrations, but Codex is the main focus.

## Codex monitoring

- Connect one or more ChatGPT accounts through OAuth.
- Track the 5-hour and weekly Codex quota windows independently.
- See quota remaining, time remaining, reset countdowns, and exact reset times.
- Compare current usage speed with the safe rate needed to last until reset.
- Estimate when quota will run out at the current rate.
- Keep 24-hour, 7-day, and 30-day usage history.
- Refresh usage in the browser or from the server while the dashboard is closed.
- Refresh expired OAuth tokens automatically.
- Send an optional Telegram warning when weekly Codex usage becomes unsustainable.

The ingestion layer guards against transient provider regressions, such as a quota counter briefly dropping before returning to its previous value. Each quota window is stabilized separately so a bad weekly response does not freeze the 5-hour counter.

## Optional integrations

- **Claude Code:** reads the local Claude login and shows the available quota windows. Disabled by default.
- **Cursor:** reads the local Cursor Agent session when available and combines live usage with manually entered subscription details.
- **OpenCode Go:** reads local OpenCode state or configured credentials. Disabled by default.

## Setup

Requirements: Node.js 22.19 or newer.

```bash
npm install
npm run build
npm start
```

The server listens on `127.0.0.1:1455` by default.

```bash
HOST=0.0.0.0 PORT=1455 npm start
```

## Codex OAuth

Add a ChatGPT account from the dashboard. The OAuth redirect URI is fixed to:

```text
http://localhost:$PORT/auth/callback
```

If the dashboard runs on another machine or behind a domain, the localhost redirect cannot reach it directly. After authorization, copy the callback URL from the browser address bar and paste it into the dashboard's manual callback field.

OAuth access and refresh tokens are stored locally in `data/accounts.json`. The entire `data/` directory is excluded from Git.

## Configuration

### Core settings

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `1455` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `OPENAI_PROXY` | unset | Proxy for Codex and other provider requests |
| `CODEX_USAGE_RECENT_PACE_HOURS` | `3` | Rolling window used for weekly current speed |
| `CODEX_USAGE_SHORT_WINDOW_PACE_HOURS` | `1` | Rolling window used for the 5-hour limit |
| `CODEX_USAGE_ALERT_ACTIVE_HOURS` | `09:00-23:00` | Planned active-hours range for sustainable weekly usage |
| `CODEX_USAGE_ALERT_TIMEZONE` | `Europe/Moscow` | Timezone used for schedule-aware calculations |

Proxy priority is `OPENAI_PROXY`, then `https_proxy`, then `http_proxy`.

### Telegram alerts

Set both variables to receive a warning when Codex usage crosses the configured burn-rate threshold:

| Variable | Description |
|---|---|
| `CODEX_USAGE_TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `CODEX_USAGE_TELEGRAM_CHAT_ID` | Destination chat ID |
| `CODEX_USAGE_ALERT_BURN_RATE_MULTIPLIER` | Warning threshold relative to the safe rate; default `1.25` |

### Optional provider cards

| Variable | Description |
|---|---|
| `CODEX_USAGE_SHOW_CLAUDE=true` | Show the Claude Code card |
| `CLAUDE_CREDENTIALS_PATH` | Claude credential file; defaults to `~/.claude/.credentials.json` |
| `CODEX_USAGE_SHOW_OPENCODE_GO=true` | Show the OpenCode Go card |
| `CURSOR_AUTH_PATH` | Cursor Agent auth file |
| `CURSOR_ACCESS_TOKEN` | Optional Cursor access-token override |

## Local data

| File | Contents |
|---|---|
| `data/accounts.json` | Codex OAuth tokens and account state |
| `data/history.json` | Codex usage snapshots for charts and pace calculations |
| `data/alerts.json` | Alert state and bounded pace samples |
| `data/settings.json` | Live and background refresh intervals |
| `data/claude-code.json` | Cached Claude Code status |
| `data/cursor.json` | Cursor subscription details and cached usage |

These files are runtime state and are not committed.

## Development

```bash
npm test
npm run build
npm run dev
```

Stack:

- Node.js HTTP server using ESM and `undici`
- React 19, TypeScript, Vite 6, and Tailwind CSS 4
- TanStack Query, Radix UI, and Recharts
- JSON persistence; no database required

## Project structure

```text
server.mjs          Backend, OAuth, provider refresh, history, and alerts
pace-window.mjs     Reset-aware rolling pace calculations
usage-guard.mjs     Quota regression and reset handling
cursor-*.mjs        Cursor usage normalization and pacing
src/                React frontend
  components/       Quota and provider UI
  pages/            Dashboard and history
  lib/              API client, hooks, routing, and utilities
test/               Node test suite
data/               Local runtime state; gitignored
dist/               Production frontend build; gitignored
```
