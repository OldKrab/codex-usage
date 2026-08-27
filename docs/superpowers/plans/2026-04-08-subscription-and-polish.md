# Subscription Entitlement & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display subscription renewal/expiry info on account cards, fix window labels, improve history chart axis scaling, and clean up card layout.

**Architecture:** Backend fetches entitlement from ChatGPT's accounts/check API alongside usage during refresh. Frontend shows subscription status inline on the plan badge. Label normalization and chart axis fixes are surgical edits to existing code.

**Tech Stack:** Node.js (server.mjs), React 19, TypeScript, Tailwind CSS 4, Recharts

---

### Task 1: Normalize window labels in backend

**Files:**
- Modify: `server.mjs:197-240` (resolveSecondaryWindowLabel, toUsageSnapshot)

- [ ] **Step 1: Add normalizeWindowLabel function**

In `server.mjs`, add a new function right before `resolveSecondaryWindowLabel` (before line 197):

```js
function normalizeWindowLabel(windowHours) {
  if (windowHours >= 168) return 'Week';
  if (windowHours >= 24) return 'Day';
  return `${windowHours}h`;
}
```

- [ ] **Step 2: Use normalizeWindowLabel in toUsageSnapshot for primary window**

In `toUsageSnapshot` (around line 217), change the primary window label from:

```js
    windows.push({
      label: `${windowHours}h`,
```

to:

```js
    windows.push({
      label: normalizeWindowLabel(windowHours),
```

- [ ] **Step 3: Simplify resolveSecondaryWindowLabel to use normalizeWindowLabel**

Replace the existing `resolveSecondaryWindowLabel` function (lines 197-209) with:

```js
function resolveSecondaryWindowLabel({ windowHours, secondaryResetAt, primaryResetAt }) {
  const WEEKLY_RESET_GAP_SECONDS = 3 * 24 * 60 * 60;
  if (
    typeof secondaryResetAt === 'number' &&
    typeof primaryResetAt === 'number' &&
    secondaryResetAt - primaryResetAt >= WEEKLY_RESET_GAP_SECONDS
  ) {
    return 'Week';
  }
  return normalizeWindowLabel(windowHours);
}
```

- [ ] **Step 4: Verify with curl**

```bash
curl -s --noproxy localhost http://localhost:1455/api/accounts | python3 -c "import sys,json; d=json.load(sys.stdin); [print(a['email'], [w['label'] for w in (a.get('usage') or {}).get('windows',[])]) for a in d['accounts']]"
```

Expected: FREE accounts show `['Week']` instead of `['168h']`. PLUS accounts show `['5h', 'Week']` or `['3h', 'Week']` as before.

- [ ] **Step 5: Commit**

```bash
git add server.mjs
git commit -m "fix: normalize primary window labels (168h → Week)"
```

---

### Task 2: Update frontend window matching & labels

**Files:**
- Modify: `src/components/AccountCard.tsx:11-13,44-45`
- Modify: `src/pages/History.tsx:33-34,37-38`

- [ ] **Step 1: Fix window matching in AccountCard.tsx**

In `AccountCard.tsx`, replace lines 11-13:

```tsx
  const windows = account.usage?.windows ?? []
  const wShort = windows.find(w => w.label === '5h')
  const wLong = windows.find(w => w !== wShort)
```

with:

```tsx
  const windows = account.usage?.windows ?? []
  const wShort = windows.find(w => /^\d+h$/.test(w.label))
  const wLong = windows.find(w => w !== wShort)
```

- [ ] **Step 2: Fix label display in AccountCard.tsx**

In `AccountCard.tsx`, replace lines 44-45:

```tsx
        {wShort && <QuotaBlock window={wShort} label={`${wShort.label} Quota`} />}
        {wLong && <QuotaBlock window={wLong} label={wLong.label === 'Week' ? 'Weekly Quota' : `${wLong.label} Quota`} />}
```

with:

```tsx
        {wShort && <QuotaBlock window={wShort} label={`${wShort.label} Quota`} />}
        {wLong && <QuotaBlock window={wLong} label={wLong.label === 'Week' ? 'Weekly Quota' : wLong.label === 'Day' ? 'Daily Quota' : `${wLong.label} Quota`} />}
```

- [ ] **Step 3: Fix window matching in History.tsx**

In `History.tsx`, replace lines 33-34:

```tsx
          const wShort = acct.windows.find(w => w.label === '5h')
          const wLong = acct.windows.find(w => w !== wShort)
```

with:

```tsx
          const wShort = acct.windows.find(w => /^\d+h$/.test(w.label))
          const wLong = acct.windows.find(w => w !== wShort)
```

- [ ] **Step 4: Build and verify**

```bash
cd /path/to/codex-usage-dashboard && npx vite build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/AccountCard.tsx src/pages/History.tsx
git commit -m "fix: semantic window matching with regex, add Daily Quota label"
```

---

### Task 3: History X axis spans full selected range

**Files:**
- Modify: `src/pages/History.tsx:20-24`

- [ ] **Step 1: Replace timeDomain computation**

In `History.tsx`, replace the timeDomain computation (lines 20-24):

```tsx
  const allTimestamps = snapshots.map(s => s.timestamp)
  const timeDomain: [number, number] | undefined =
    allTimestamps.length >= 2
      ? [Math.min(...allTimestamps), Math.max(...allTimestamps)]
      : undefined
```

with:

```tsx
  const rangeMsMap = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 } as const
  const now = Date.now()
  const rangeStart = now - rangeMsMap[range]
  const allTimestamps = snapshots.map(s => s.timestamp)
  const timeDomain: [number, number] = [
    allTimestamps.length ? Math.min(rangeStart, Math.min(...allTimestamps)) : rangeStart,
    allTimestamps.length ? Math.max(now, Math.max(...allTimestamps)) : now,
  ]
```

- [ ] **Step 2: Update dataSpanMs to use timeDomain**

The `dataSpanMs` variable (around line 44-46) already computes from `timeDomain`. After the change above, `timeDomain` is always defined (never undefined), so it will always compute correctly. Verify no change needed — the existing code:

```tsx
  const dataSpanMs = timeDomain
    ? timeDomain[1] - timeDomain[0]
    : 0
```

still works because `timeDomain` is always truthy now. But simplify it to:

```tsx
  const dataSpanMs = timeDomain[1] - timeDomain[0]
```

- [ ] **Step 3: Build and verify**

```bash
cd /path/to/codex-usage-dashboard && npx vite build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/History.tsx
git commit -m "fix: history X axis spans full selected time range"
```

---

### Task 4: Remove card min-height

**Files:**
- Modify: `src/components/AccountCard.tsx:25`

- [ ] **Step 1: Remove min-h-[340px] from article element**

In `AccountCard.tsx` line 25, change:

```tsx
    <article className="bg-surface rounded-xl p-4 hover:bg-surface-hover transition-colors duration-150 flex flex-col min-h-[340px]">
```

to:

```tsx
    <article className="bg-surface rounded-xl p-4 hover:bg-surface-hover transition-colors duration-150 flex flex-col">
```

- [ ] **Step 2: Build**

```bash
cd /path/to/codex-usage-dashboard && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/AccountCard.tsx
git commit -m "fix: remove fixed min-height from account cards"
```

---

### Task 5: Backend — fetch and store entitlement

**Files:**
- Modify: `server.mjs` (add fetchEntitlement, update refreshUsageForSlot, update sanitizeAccount)

- [ ] **Step 1: Add ACCOUNTS_CHECK_URL constant**

After the `USAGE_URL` constant (line 24), add:

```js
const ACCOUNTS_CHECK_URL = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27';
```

- [ ] **Step 2: Add fetchEntitlement function**

After the `fetchUsage` function (after line 330), add:

```js
async function fetchEntitlement(account) {
  const headers = {
    Authorization: `Bearer ${account.access}`,
    'User-Agent': 'CodexUsageDashboard',
    Accept: 'application/json',
  };
  if (account.accountId) headers['ChatGPT-Account-Id'] = account.accountId;

  const response = await fetchOpenAI(ACCOUNTS_CHECK_URL, { method: 'GET', headers });
  if (!response.ok) return null;

  const data = await response.json();
  const accountData = account.accountId
    ? data?.accounts?.[account.accountId]
    : Object.values(data?.accounts || {})[0];
  if (!accountData) return null;

  const ent = accountData.entitlement || {};
  const lastSub = accountData.last_active_subscription || {};
  return {
    active: !!ent.has_active_subscription,
    plan: ent.subscription_plan || null,
    expiresAt: ent.expires_at || null,
    renewsAt: ent.renews_at || null,
    cancelsAt: ent.cancels_at || null,
    willRenew: !!lastSub.will_renew,
    delinquent: !!ent.is_delinquent,
  };
}
```

- [ ] **Step 3: Integrate fetchEntitlement into refreshUsageForSlot**

In `refreshUsageForSlot` (around line 345-357), replace the try block's usage fetch section. The current code is:

```js
    let usage;
    try {
      usage = await fetchUsage(working);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        working = await refreshAccount(working);
        usage = await fetchUsage(working);
      } else {
        throw err;
      }
    }

    working.usage = usage;
```

Replace with:

```js
    let usage;
    try {
      usage = await fetchUsage(working);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        working = await refreshAccount(working);
        usage = await fetchUsage(working);
      } else {
        throw err;
      }
    }

    working.usage = usage;

    // Fetch entitlement in parallel-safe manner (non-blocking)
    try {
      const entitlement = await fetchEntitlement(working);
      if (entitlement) working.entitlement = entitlement;
    } catch (err) {
      console.warn(`Entitlement fetch failed for ${slot}:`, err?.message || err);
    }
```

- [ ] **Step 4: Update sanitizeAccount to include entitlement**

In the `sanitizeAccount` function (around line 375-391), add `entitlement` to the returned object. Change:

```js
    lastError: account.lastError || null,
  };
```

to:

```js
    lastError: account.lastError || null,
    entitlement: account.entitlement || null,
  };
```

- [ ] **Step 5: Restart service and verify**

```bash
cd /path/to/codex-usage-dashboard && npx vite build && systemctl --user restart codex-usage-dashboard
```

Wait a few seconds for startup, then:

```bash
curl -s --noproxy localhost http://localhost:1455/api/accounts/slot1/refresh -X POST | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('account',{}).get('entitlement'), indent=2))"
```

Expected: entitlement object with `active`, `expiresAt`, `renewsAt`, etc.

- [ ] **Step 6: Commit**

```bash
git add server.mjs
git commit -m "feat: fetch subscription entitlement from accounts/check API"
```

---

### Task 6: Frontend — display subscription status on cards

**Files:**
- Modify: `src/types/api.ts` (add Entitlement interface)
- Modify: `src/lib/utils.ts` (add formatSubscriptionStatus helper)
- Modify: `src/components/AccountCard.tsx` (display subscription info)

- [ ] **Step 1: Add Entitlement type**

In `src/types/api.ts`, after the `UsageData` interface (after line 10), add:

```ts
export interface Entitlement {
  active: boolean
  plan: string | null
  expiresAt: string | null
  renewsAt: string | null
  cancelsAt: string | null
  willRenew: boolean
  delinquent: boolean
}
```

Then add `entitlement` to the `Account` interface. After the `lastError` field (line 22), add:

```ts
  entitlement: Entitlement | null
```

- [ ] **Step 2: Add formatSubscriptionStatus helper**

In `src/lib/utils.ts`, add at the end of the file:

```ts
export function formatSubscriptionStatus(entitlement: {
  active: boolean
  expiresAt: string | null
  renewsAt: string | null
  cancelsAt: string | null
  willRenew: boolean
  delinquent: boolean
} | null): { text: string; color: 'muted' | 'warn' | 'bad' } | null {
  if (!entitlement || !entitlement.active) return null

  if (entitlement.delinquent) {
    return { text: 'payment overdue', color: 'bad' }
  }

  const targetDate = entitlement.willRenew
    ? entitlement.renewsAt
    : (entitlement.cancelsAt || entitlement.expiresAt)
  if (!targetDate) return null

  const target = new Date(targetDate).getTime()
  const now = Date.now()
  const diffMs = target - now

  if (diffMs <= 0) {
    return entitlement.willRenew
      ? { text: 'renewing…', color: 'muted' }
      : { text: 'expired', color: 'bad' }
  }

  const verb = entitlement.willRenew ? 'renews' : 'expires'
  const diffDays = diffMs / 86_400_000

  // Warning color: ≤3 days left and not renewing
  const color = !entitlement.willRenew && diffDays <= 3 ? 'warn' : 'muted'

  // Smart format: relative if <30 days, absolute otherwise
  let timeStr: string
  if (diffDays < 1) {
    const hours = Math.max(1, Math.floor(diffMs / 3_600_000))
    timeStr = `in ${hours}h`
  } else if (diffDays < 30) {
    timeStr = `in ${Math.ceil(diffDays)}d`
  } else {
    const d = new Date(targetDate)
    timeStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return { text: `${verb} ${timeStr}`, color }
}
```

- [ ] **Step 3: Display subscription status in AccountCard**

In `src/components/AccountCard.tsx`, add the import for `formatSubscriptionStatus`:

Change the import line:

```tsx
import { formatRelativeTime } from '../lib/utils'
```

to:

```tsx
import { formatRelativeTime, formatSubscriptionStatus } from '../lib/utils'
```

Then, after line 14 (`const plan = ...`), add:

```tsx
  const subStatus = formatSubscriptionStatus(account.entitlement)
```

Then, replace the plan badge display. The current code (around lines 31-35):

```tsx
          {plan && (
            <span className="text-[11px] uppercase tracking-wide text-text-muted">
              {plan}
            </span>
          )}
```

Replace with:

```tsx
          {plan && (
            <span className="text-[11px] uppercase tracking-wide text-text-muted">
              {plan}
              {subStatus && (
                <span className={subStatus.color === 'bad' ? 'text-bad' : subStatus.color === 'warn' ? 'text-warn' : ''}>
                  {' · '}{subStatus.text}
                </span>
              )}
            </span>
          )}
```

- [ ] **Step 4: Build and verify**

```bash
cd /path/to/codex-usage-dashboard && npx vite build && systemctl --user restart codex-usage-dashboard
```

- [ ] **Step 5: Commit**

```bash
git add src/types/api.ts src/lib/utils.ts src/components/AccountCard.tsx
git commit -m "feat: display subscription renewal/expiry on account cards"
```

---

### Task 7: Deploy, verify with screenshots, squash commits

**Files:** None new — verification and cleanup

- [ ] **Step 1: Build and restart**

```bash
cd /path/to/codex-usage-dashboard && npx vite build && systemctl --user restart codex-usage-dashboard
```

- [ ] **Step 2: Refresh all accounts to populate entitlement**

```bash
curl -s --noproxy localhost -X POST http://localhost:1455/api/refresh-all | python3 -c "import sys,json; d=json.load(sys.stdin); [print(a['email'], a.get('entitlement',{}).get('expiresAt','none') if a.get('entitlement') else 'no-entitlement') for a in d.get('accounts',[])]"
```

Expected: PLUS accounts show ISO dates, FREE account shows "no-entitlement" or null dates.

- [ ] **Step 3: Take desktop screenshot**

Use Playwright to navigate to `http://localhost:1455` at 1280×800 and take a screenshot. Verify:
- Cards show `PLUS · renews in Xd` or `FREE` with no suffix
- Window labels say "Weekly Quota" (not "168h Quota")
- No excessive card whitespace

- [ ] **Step 4: Take history page screenshot**

Navigate to `http://localhost:1455/#/history`, switch between 24h/7d/30d ranges. Verify:
- X axis spans the full range (7d chart shows 7 days of x-axis)
- Data points cluster at the right edge when data is limited

- [ ] **Step 5: Verify all labels via API**

```bash
curl -s --noproxy localhost http://localhost:1455/api/accounts | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d['accounts']:
    if a.get('usage'):
        labels = [w['label'] for w in a['usage']['windows']]
        ent = a.get('entitlement')
        sub = f\"active={ent['active']}, renews={ent.get('renewsAt','?')}\" if ent else 'none'
        print(f\"{a['email']}: windows={labels}, entitlement={sub}\")
"
```

Expected: No "168h" labels. All PLUS accounts have entitlement with dates.
