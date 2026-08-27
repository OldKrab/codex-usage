# Subscription Entitlement Display & Label Polish

**Date:** 2026-04-08
**Scope:** Backend + Frontend changes to codex-usage-dashboard

---

## Overview

Two related improvements to the dashboard:

1. **Subscription entitlement display** — Show when each account's subscription renews or expires, fetched from ChatGPT's accounts/check API.
2. **Label & chart polish** — Fix "168h" → "Weekly", make history chart X axis span the full selected range, remove card min-height.

---

## 1. Subscription Entitlement

### Data Source

`GET https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27`

Headers: same as usage endpoint (`Authorization: Bearer <token>`, `ChatGPT-Account-Id: <id>`).

Response includes per-account:
```json
{
  "entitlement": {
    "has_active_subscription": true,
    "subscription_plan": "chatgptplusplan",
    "expires_at": "2026-04-18T05:36:39+00:00",
    "renews_at": "2026-04-17T04:36:39+00:00",
    "cancels_at": null,
    "is_delinquent": false
  },
  "last_active_subscription": {
    "will_renew": true
  }
}
```

FREE accounts: `has_active_subscription: false`, all dates `null`.

### Backend

**New function `fetchEntitlement(account)`:**
- Calls the accounts/check endpoint with the account's OAuth token
- Extracts the relevant account entry from the response `accounts` map (keyed by accountId)
- Returns normalized entitlement object:
  ```js
  {
    active: boolean,
    plan: string | null,       // "chatgptplusplan", "chatgptfreeplan", etc.
    expiresAt: string | null,  // ISO 8601
    renewsAt: string | null,   // ISO 8601
    cancelsAt: string | null,  // ISO 8601
    willRenew: boolean,
    delinquent: boolean,
  }
  ```

**Integration into refresh cycle:**
- Called during `refreshUsageForSlot()` alongside `fetchUsage()`
- Stored on the account object as `account.entitlement`
- Both calls can run in parallel (`Promise.all`)
- If entitlement fetch fails, log warning but don't fail the refresh — usage data is more important

**Exposed in GET /api/accounts:**
- Each account includes an `entitlement` field (or `null` if never fetched)

### Frontend

**TypeScript type (`types/api.ts`):**
```ts
interface Entitlement {
  active: boolean
  plan: string | null
  expiresAt: string | null
  renewsAt: string | null
  cancelsAt: string | null
  willRenew: boolean
  delinquent: boolean
}
```

**AccountCard display — inline on plan badge line:**

Format: `PLAN · subscription status`

| State | Condition | Text | Color |
|---|---|---|---|
| Auto-renewing | `active && willRenew` | `PLUS · renews in 9d` | muted (text-text-muted) |
| Cancelled, >3d left | `active && !willRenew && daysLeft > 3` | `PLUS · expires in 9d` | muted |
| Cancelled, ≤3d left | `active && !willRenew && daysLeft <= 3` | `PLUS · expires in 2d` | warning (text-warn) |
| Payment overdue | `delinquent` | `PLUS · payment overdue` | bad (text-bad) |
| Expired | `!active && expiresAt && expiresAt < now` | `PLUS · expired` | bad (text-bad) |
| Free account | `!active && plan is free` | `FREE` | muted (no suffix) |
| No data yet | `entitlement is null` | `PLUS` | muted (no suffix) |

**Date format (smart):**
- < 30 days from now → relative: "in 9d", "in 23h"
- ≥ 30 days from now → absolute: "Apr 17"

**Warning color:** Need to add `--color-warn` to the Tailwind @theme in `index.css` (e.g., amber/orange `#f59e0b`).

---

## 2. Label & Chart Polish

### 2a. Normalize Window Labels (Backend)

In `server.mjs`, the primary window label is always `${windowHours}h`. This means FREE accounts with 168h primary window show "168h Quota" instead of "Weekly Quota".

**Fix:** Apply `normalizeWindowLabel(windowHours)` to primary windows too:
- `>= 168` → `'Week'`
- `>= 24` → `'Day'`
- `< 24` → `'${windowHours}h'`

The secondary window already uses `resolveSecondaryWindowLabel()` which returns 'Week'/'Day'. Both share the same normalization.

### 2b. Frontend Window Matching

Replace brittle `windows.find(w => w.label === '5h')` with semantic matching:
- `wShort` = window matching `/^\d+h$/` (hour-based: 3h, 5h, etc.)
- `wLong` = first window that isn't `wShort` (Week, Day)

Display labels: `'Week'` → "Weekly Quota", `'Day'` → "Daily Quota", `'Xh'` → "Xh Quota"

Applies to both `AccountCard.tsx` and `History.tsx`.

### 2c. History X Axis Full Range

Currently `timeDomain` is computed from data timestamps only. With limited data, all ranges look identical.

**Fix:** Compute domain from the selected range:
```
rangeStart = now - rangeDuration
timeDomain = [Math.min(rangeStart, dataMin), Math.max(now, dataMax)]
```

Range durations: 24h = 86,400,000ms, 7d = 604,800,000ms, 30d = 2,592,000,000ms.

### 2d. Remove Card min-height

Remove `min-h-[340px]` from `AccountCard.tsx`. The existing `flex flex-col` + `flex-1` on the quota section handles footer pinning within CSS grid's equal-height rows.

---

## Files Changed

| File | Changes |
|---|---|
| `server.mjs` | `normalizeWindowLabel()`, `fetchEntitlement()`, parallel fetch in refresh, entitlement in API response |
| `src/types/api.ts` | `Entitlement` interface, add to `Account` type |
| `src/components/AccountCard.tsx` | Subscription text inline, window matching fix, remove min-height |
| `src/pages/History.tsx` | Window matching fix, full-range X axis domain |
| `src/lib/utils.ts` | `formatSubscriptionStatus()` helper |
| `src/index.css` | Add `--color-warn` to @theme |
