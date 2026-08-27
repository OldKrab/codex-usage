import assert from 'node:assert/strict'
import test from 'node:test'

import { createHostedApp } from '../netlify/lib/hosted-app.mjs'
import { createCodexClient } from '../netlify/lib/codex-client.mjs'
import { createMemoryRepository } from '../netlify/lib/memory-repository.mjs'
import { runScheduledRefresh } from '../netlify/lib/scheduled-refresh.mjs'

const NativeRequest = globalThis.Request
class Request extends NativeRequest {
  constructor(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const method = String(init.method || input?.method || 'GET').toUpperCase()
    const headers = new Headers(init.headers || input?.headers)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !headers.has('origin')) {
      headers.set('origin', new URL(url).origin)
    }
    super(input, { ...init, headers })
  }
}

async function json(response) {
  return response.json()
}

function mutation(url, options = {}) {
  const origin = new URL(url).origin
  return new Request(url, {
    ...options,
    headers: { origin, ...options.headers },
  })
}

test('account slots persist across hosted handler instances', async () => {
  const repository = createMemoryRepository()
  const firstHandler = createHostedApp({ repository })

  const created = await firstHandler(new Request('https://dashboard.test/api/accounts/create', {
    method: 'POST',
  }))
  assert.equal(created.status, 200)
  assert.equal((await json(created)).slot, 'slot1')

  repository.listHistory = async () => {
    throw new Error('empty slots must not read history')
  }
  const secondHandler = createHostedApp({ repository })
  const response = await secondHandler(new Request('https://dashboard.test/api/accounts'))

  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), {
    mode: 'hosted',
    providers: ['codex'],
    accounts: [{ slot: 'slot1', connected: false }],
  })
})

test('hosted account responses never expose OAuth tokens', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'secret-access-token',
    refresh: 'secret-refresh-token',
    email: 'owner@example.com',
    accountId: 'account-1',
    planTypeFromJwt: 'pro',
    usage: { plan: 'pro', windows: [] },
    expires: 1_900_000_000_000,
    updatedAt: 1_800_000_000_000,
    lastCheckedAt: 1_800_000_000_000,
    lastError: null,
    entitlement: { active: true, plan: 'pro', activeUntil: null },
  }, { version: '1' })

  const response = await createHostedApp({ repository })(
    new Request('https://dashboard.test/api/accounts'),
  )
  const text = await response.text()

  assert.equal(response.status, 200)
  assert.doesNotMatch(text, /secret-access-token|secret-refresh-token/)
  assert.deepEqual(JSON.parse(text).accounts[0], {
    slot: 'slot1',
    connected: true,
    email: 'owner@example.com',
    accountId: 'account-1',
    planTypeFromJwt: 'pro',
    usage: { plan: 'pro', windows: [] },
    alertMetrics: null,
    expires: 1_900_000_000_000,
    updatedAt: 1_800_000_000_000,
    lastCheckedAt: 1_800_000_000_000,
    lastError: null,
    entitlement: { active: true, plan: 'pro', activeUntil: null },
  })
})

test('hosted account view derives reset-aware weekly and short-window pace from persisted history', async () => {
  const now = 1_800_000_000_000
  const hour = 60 * 60 * 1000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'secret-access',
    refresh: 'secret-refresh',
    usage: {
      plan: 'pro',
      windows: [
        { label: '5h', usedPercent: 30, resetAt: now + 2 * hour },
        { label: 'Week', usedPercent: 40, resetAt: now + 4 * 24 * hour },
      ],
    },
  }, { version: '1' })
  await repository.appendHistory({
    timestamp: now - hour,
    accounts: { slot1: { email: null, windows: [
      { label: '5h', usedPercent: 20 },
      { label: 'Week', usedPercent: 35 },
    ] } },
  })

  const response = await createHostedApp({ repository, now: () => now })(
    new Request('https://dashboard.test/api/accounts'),
  )
  const metrics = (await response.json()).accounts[0].alertMetrics

  assert.equal(metrics.recentRateAvailable, true)
  assert.equal(metrics.actualRatePercentPerHour, 5)
  assert.equal(metrics.remainingWeekPercent, 60)
  assert.equal(metrics.remainingBudgetHours, 96)
  assert.equal(metrics.safeRatePercentPerHour, 0.625)
  assert.equal(metrics.rateMultiple, 8)
  assert.equal(metrics.projectedExhaustionHours, 12)
  assert.equal(metrics.status, 'fast')
  assert.deepEqual(metrics.shortWindow, {
    label: '5h',
    resetAt: now + 2 * hour,
    usedPercent: 30,
    remainingPercent: 70,
    remainingHours: 2,
    remainingTimePercent: 40,
    recentWindowTargetHours: 1,
    recentWindowHours: 1,
    recentWarmingUp: false,
    recentRateAvailable: true,
    actualRatePercentPerHour: 10,
    safeRatePercentPerHour: 35,
    rateMultiple: 10 / 35,
    projectedExhaustionHours: 7,
    willExhaustBeforeReset: false,
    status: 'good',
  })
})

test('persisted pace serves account and refresh metrics without reading immutable history', async () => {
  const now = 1_800_000_000_000
  const hour = 60 * 60 * 1000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'secret-access',
    refresh: 'secret-refresh',
    usage: { plan: 'pro', windows: [
      { label: '5h', usedPercent: 30, resetAt: now + 2 * hour },
      { label: 'Week', usedPercent: 40, resetAt: now + 4 * 24 * hour },
    ] },
    paceSamples: {
      weekly: [{ at: now - hour, weekPercent: 35 }],
      short: [{ at: now - hour, weekPercent: 20 }],
    },
  }, { version: '1' })
  repository.listHistory = async () => {
    throw new Error('history must not be read')
  }
  const codexClient = {
    async refreshUsage(account) {
      return {
        ...account,
        usage: { plan: 'pro', windows: [
          { label: '5h', usedPercent: 31, resetAt: now + 2 * hour },
          { label: 'Week', usedPercent: 41, resetAt: now + 4 * 24 * hour },
        ] },
      }
    },
  }
  const handler = createHostedApp({ repository, codexClient, now: () => now })

  const accounts = await json(await handler(new Request('https://dashboard.test/api/accounts')))
  const refreshed = await json(await handler(new Request(
    `https://dashboard.test/api/accounts/${slot}/refresh`,
    { method: 'POST' },
  )))

  assert.equal(accounts.accounts[0].alertMetrics.actualRatePercentPerHour, 5)
  assert.equal(refreshed.account.alertMetrics.actualRatePercentPerHour, 6)
  assert.equal('paceSamples' in accounts.accounts[0], false)
  assert.equal('paceSamples' in refreshed.account, false)
})

test('hosted account view keeps rates unavailable before a meaningful sampling interval', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    usage: { plan: 'pro', windows: [
      { label: 'Week', usedPercent: 11, resetAt: now + 6 * 24 * 60 * 60 * 1000 },
    ] },
  }, { version: '1' })
  await repository.appendHistory({
    timestamp: now - 60_000,
    accounts: { slot1: { email: null, windows: [{ label: 'Week', usedPercent: 10 }] } },
  })

  const response = await createHostedApp({ repository, now: () => now })(
    new Request('https://dashboard.test/api/accounts'),
  )
  const metrics = (await response.json()).accounts[0].alertMetrics

  assert.equal(metrics.recentWarmingUp, true)
  assert.equal(metrics.recentRateAvailable, false)
  assert.equal(metrics.actualRatePercentPerHour, null)
  assert.equal(metrics.projectedExhaustionHours, null)
})

test('hosted API advertises Codex only and does not expose optional provider endpoints', async () => {
  const handler = createHostedApp({ repository: createMemoryRepository() })

  const accounts = await json(await handler(new Request('https://dashboard.test/api/accounts')))
  const cursor = await handler(new Request('https://dashboard.test/api/cursor'))
  const openCode = await handler(new Request('https://dashboard.test/api/opencode-go/connect', {
    method: 'POST',
    body: '{}',
  }))

  assert.deepEqual(accounts.providers, ['codex'])
  assert.equal(accounts.mode, 'hosted')
  assert.equal(cursor.status, 404)
  assert.equal(openCode.status, 404)
})

test('hosted API exposes a storage-independent health check', async () => {
  const handler = createHostedApp({ repository: createMemoryRepository() })
  const response = await handler(new Request('https://dashboard.test/api/health'))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    mode: 'hosted',
    storage: 'netlify-blobs',
  })
})

test('state-changing hosted routes require a matching Origin while GET remains unaffected', async () => {
  const handler = createHostedApp({ repository: createMemoryRepository() })

  const missing = await handler(new NativeRequest('https://dashboard.test/api/accounts/create', { method: 'POST' }))
  const crossSite = await handler(new Request('https://dashboard.test/api/accounts/create', {
    method: 'POST',
    headers: { origin: 'https://attacker.test' },
  }))
  const sameOrigin = await handler(mutation('https://dashboard.test/api/accounts/create', { method: 'POST' }))
  const health = await handler(new Request('https://dashboard.test/api/health'))

  assert.equal(missing.status, 403)
  assert.equal(crossSite.status, 403)
  assert.equal(sameOrigin.status, 200)
  assert.equal(health.status, 200)
})

test('conditional account updates reject a stale concurrent writer', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  const left = await repository.getAccount(slot)
  const right = await repository.getAccount(slot)

  const results = await Promise.allSettled([
    repository.putAccount(slot, { email: 'left@example.com' }, { version: left.version }),
    repository.putAccount(slot, { email: 'right@example.com' }, { version: right.version }),
  ])

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected')
  assert.equal(rejected.reason.code, 'CONFLICT')
  assert.match((await repository.getAccount(slot)).account.email, /^(left|right)@example\.com$/)
})

test('manual OAuth exchange can finish in a different handler invocation', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  const codexClient = {
    async exchangeCode({ code }) {
      assert.equal(code, 'authorization-code')
      return {
        access: 'new-access-token',
        refresh: 'new-refresh-token',
        expires: 1_900_000_000_000,
        accountId: 'account-1',
        email: 'owner@example.com',
        planTypeFromJwt: 'pro',
        entitlement: null,
      }
    },
    async refreshUsage(account) {
      return {
        ...account,
        usage: { plan: 'pro', windows: [
          { label: '5h', usedPercent: 4, resetAt: now + 2 * 60 * 60 * 1000 },
          { label: 'Week', usedPercent: 7, resetAt: now + 4 * 24 * 60 * 60 * 1000 },
        ] },
        lastCheckedAt: now,
        lastError: null,
      }
    },
  }
  const loginHandler = createHostedApp({ repository, codexClient, now: () => now })
  const login = await json(await loginHandler(new Request(
    `https://dashboard.test/api/accounts/${slot}/login`,
    { method: 'POST' },
  )))
  const state = new URL(login.authUrl).searchParams.get('state')
  assert.ok(state)

  const exchangeHandler = createHostedApp({ repository, codexClient, now: () => now })
  const response = await exchangeHandler(new Request(
    `https://dashboard.test/api/accounts/${slot}/exchange`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: `http://localhost:1455/auth/callback?code=authorization-code&state=${state}`,
      }),
    },
  ))
  const text = await response.text()

  assert.equal(response.status, 200)
  assert.doesNotMatch(text, /new-access-token|new-refresh-token/)
  assert.equal(JSON.parse(text).accounts[0].email, 'owner@example.com')
  const stored = (await repository.getAccount(slot)).account
  assert.equal(stored.refresh, 'new-refresh-token')
  assert.deepEqual(stored.paceSamples, {
    weekly: [{ at: now, weekPercent: 7 }],
    short: [{ at: now, weekPercent: 4 }],
  })
})

test('hosted live-refresh settings persist while background refresh stays fixed at 15 minutes', async () => {
  const repository = createMemoryRepository()
  const firstHandler = createHostedApp({ repository })
  const updated = await firstHandler(new Request('https://dashboard.test/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ liveInterval: 60 }),
  }))

  assert.equal(updated.status, 200)
  assert.deepEqual(await json(updated), { ok: true, liveInterval: 60, backgroundInterval: 900 })

  const secondHandler = createHostedApp({ repository })
  assert.deepEqual(
    await json(await secondHandler(new Request('https://dashboard.test/api/settings'))),
    { liveInterval: 60, backgroundInterval: 900 },
  )
})

test('hosted live interval accepts only the server allowlist', async () => {
  const repository = createMemoryRepository()
  const handler = createHostedApp({ repository })

  const rejected = await handler(new Request('https://dashboard.test/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ liveInterval: 11 }),
  }))
  const accepted = await handler(new Request('https://dashboard.test/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ liveInterval: 10 }),
  }))

  assert.equal(rejected.status, 400)
  assert.equal(accepted.status, 200)
})

test('account refresh persists fresh Codex usage without returning tokens', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'old-access',
    refresh: 'old-refresh',
    email: 'owner@example.com',
  }, { version: '1' })
  const codexClient = {
    async refreshUsage(account) {
      return {
        ...account,
        access: 'rotated-access',
        refresh: 'rotated-refresh',
        usage: { plan: 'pro', windows: [{ label: 'Week', usedPercent: 12, resetAt: null }] },
        lastCheckedAt: 1_800_000_000_000,
        lastError: null,
      }
    },
  }

  const response = await createHostedApp({ repository, codexClient })(new Request(
    `https://dashboard.test/api/accounts/${slot}/refresh`,
    { method: 'POST' },
  ))
  const text = await response.text()

  assert.equal(response.status, 200)
  assert.doesNotMatch(text, /rotated-access|rotated-refresh/)
  assert.equal(JSON.parse(text).account.usage.windows[0].usedPercent, 12)
  assert.equal((await repository.getAccount(slot)).account.refresh, 'rotated-refresh')
})

test('successful refresh persists weekly and short pace samples in the account CAS update', async () => {
  const now = 1_800_000_000_000
  const hour = 60 * 60 * 1000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'access',
    refresh: 'refresh',
    lastCheckedAt: now - hour,
    usage: { plan: 'pro', windows: [
      { label: '5h', usedPercent: 20, resetAt: now + 2 * hour },
      { label: 'Week', usedPercent: 35, resetAt: now + 4 * 24 * hour },
    ] },
  }, { version: '1' })
  const codexClient = {
    async refreshUsage(account) {
      return {
        ...account,
        lastCheckedAt: now,
        usage: { plan: 'pro', windows: [
          { label: '5h', usedPercent: 30, resetAt: now + 2 * hour },
          { label: 'Week', usedPercent: 40, resetAt: now + 4 * 24 * hour },
        ] },
      }
    },
  }

  const response = await createHostedApp({ repository, codexClient, now: () => now })(new Request(
    `https://dashboard.test/api/accounts/${slot}/refresh`,
    { method: 'POST' },
  ))
  const stored = (await repository.getAccount(slot)).account

  assert.equal(response.status, 200)
  assert.deepEqual(stored.paceSamples, {
    weekly: [
      { at: now - hour, weekPercent: 35 },
      { at: now, weekPercent: 40 },
    ],
    short: [
      { at: now - hour, weekPercent: 20 },
      { at: now, weekPercent: 30 },
    ],
  })
  assert.equal('paceSamples' in (await response.json()).account, false)

  repository.listHistory = async () => {
    throw new Error('history must not be read after pace is persisted')
  }
  const laterHandler = createHostedApp({ repository, now: () => now })
  const laterView = await json(await laterHandler(new Request('https://dashboard.test/api/accounts')))
  assert.equal(laterView.accounts[0].alertMetrics.actualRatePercentPerHour, 5)
})

test('accepted quota resets discard the previous persisted pace segment', async () => {
  const now = 1_800_000_000_000
  const hour = 60 * 60 * 1000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'access',
    refresh: 'refresh',
    usage: { plan: 'pro', windows: [
      { label: '5h', usedPercent: 95, resetAt: now + hour },
      { label: 'Week', usedPercent: 95, resetAt: now + hour },
    ] },
    paceSamples: {
      weekly: [
        { at: now - 2 * hour, weekPercent: 90 },
        { at: now - hour, weekPercent: 95 },
      ],
      short: [
        { at: now - 2 * hour, weekPercent: 90 },
        { at: now - hour, weekPercent: 95 },
      ],
    },
  }, { version: '1' })
  const codexClient = {
    async refreshUsage(account) {
      return { ...account, usage: { plan: 'pro', windows: [
        { label: '5h', usedPercent: 2, resetAt: now + 5 * hour },
        { label: 'Week', usedPercent: 3, resetAt: now + 7 * 24 * hour },
      ] } }
    },
  }

  const response = await createHostedApp({ repository, codexClient, now: () => now })(new Request(
    `https://dashboard.test/api/accounts/${slot}/refresh`,
    { method: 'POST' },
  ))

  assert.equal(response.status, 200)
  assert.deepEqual((await repository.getAccount(slot)).account.paceSamples, {
    weekly: [{ at: now, weekPercent: 3 }],
    short: [{ at: now, weekPercent: 2 }],
  })
})

test('successful refresh bounds each persisted pace series to one thousand samples', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  const samples = Array.from({ length: 1000 }, (_, index) => ({
    at: now - (1000 - index) * 10_000,
    weekPercent: index / 10,
  }))
  await repository.putAccount(slot, {
    access: 'access',
    refresh: 'refresh',
    usage: { plan: 'pro', windows: [
      { label: '5h', usedPercent: 99.9, resetAt: now + 2 * 60 * 60 * 1000 },
      { label: 'Week', usedPercent: 99.9, resetAt: now + 4 * 24 * 60 * 60 * 1000 },
    ] },
    paceSamples: { weekly: samples, short: samples },
  }, { version: '1' })
  const codexClient = {
    async refreshUsage(account) {
      return { ...account, usage: { ...account.usage, windows: account.usage.windows.map(window => ({
        ...window,
        usedPercent: 100,
      })) } }
    },
  }

  const response = await createHostedApp({ repository, codexClient, now: () => now })(new Request(
    `https://dashboard.test/api/accounts/${slot}/refresh`,
    { method: 'POST' },
  ))
  const stored = (await repository.getAccount(slot)).account.paceSamples

  assert.equal(response.status, 200)
  assert.equal(stored.weekly.length, 1000)
  assert.equal(stored.short.length, 1000)
  assert.deepEqual(stored.weekly.at(-1), { at: now, weekPercent: 100 })
  assert.deepEqual(stored.short.at(-1), { at: now, weekPercent: 100 })
})

test('per-slot refresh lease collapses concurrent spam and allows the normal ten-second cadence', async () => {
  let currentTime = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, { access: 'access', refresh: 'refresh' }, { version: '1' })
  let calls = 0
  const codexClient = {
    async refreshUsage(account) {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 5))
      return { ...account, usage: { plan: 'pro', windows: [] } }
    },
  }
  const handler = createHostedApp({ repository, codexClient, now: () => currentTime })
  const request = () => new Request(`https://dashboard.test/api/accounts/${slot}/refresh`, { method: 'POST' })

  const concurrent = await Promise.all([handler(request()), handler(request()), handler(request())])
  currentTime += 10_000
  const next = await handler(request())

  assert.equal(calls, 2)
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 429, 429])
  assert.equal(next.status, 200)
})

test('hosted account must be logged out before its slot can be deleted', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, { access: 'secret', refresh: 'secret' }, { version: '1' })
  const handler = createHostedApp({ repository })

  const refused = await handler(new Request(`https://dashboard.test/api/accounts/${slot}/delete`, {
    method: 'POST',
  }))
  assert.equal(refused.status, 400)

  const logout = await handler(new Request(`https://dashboard.test/api/accounts/${slot}/logout`, {
    method: 'POST',
  }))
  assert.equal(logout.status, 200)
  assert.equal((await repository.getAccount(slot)).account, null)

  const deleted = await handler(new Request(`https://dashboard.test/api/accounts/${slot}/delete`, {
    method: 'POST',
  }))
  assert.equal(deleted.status, 200)
  assert.equal(await repository.getAccount(slot), null)
})

test('scheduled refresh updates every connected Codex account and records history', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'secret-access',
    refresh: 'secret-refresh',
    email: 'owner@example.com',
  }, { version: '1' })
  const codexClient = {
    async refreshUsage(account) {
      return {
        ...account,
        usage: { plan: 'pro', windows: [{ label: 'Week', usedPercent: 24, resetAt: null }] },
        lastCheckedAt: now,
        lastError: null,
      }
    },
  }

  const result = await runScheduledRefresh({ repository, codexClient, now: () => now })
  assert.deepEqual(result, { total: 1, ok: 1, failed: 0 })

  const handler = createHostedApp({ repository, codexClient, now: () => now })
  const history = await json(await handler(new Request('https://dashboard.test/api/history?range=24h')))
  assert.deepEqual(history.snapshots, [{
    timestamp: now,
    accounts: {
      slot1: {
        email: 'owner@example.com',
        windows: [{ label: 'Week', usedPercent: 24 }],
      },
    },
  }])
})

test('history API passes the requested range lower bound to the repository', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const originalListHistory = repository.listHistory
  let requestedSince = null
  repository.listHistory = async options => {
    requestedSince = options.since
    return originalListHistory(options)
  }

  const response = await createHostedApp({ repository, now: () => now })(new Request(
    'https://dashboard.test/api/history?range=7d',
  ))

  assert.equal(response.status, 200)
  assert.equal(requestedSince, now - 7 * 24 * 60 * 60 * 1000)
})

test('bulk hosted refresh limits provider concurrency to two accounts', async () => {
  const repository = createMemoryRepository()
  for (let index = 0; index < 5; index += 1) {
    const slot = await repository.createAccountSlot()
    await repository.putAccount(slot, {
      access: `access-${index}`,
      refresh: `refresh-${index}`,
    }, { version: '1' })
  }
  let active = 0
  let maximum = 0
  const codexClient = {
    async refreshUsage(account) {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return { ...account, usage: { plan: 'pro', windows: [] } }
    },
  }

  await runScheduledRefresh({ repository, codexClient })

  assert.equal(maximum, 2)
})

test('scheduled refresh prunes retention and does not write an empty snapshot', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  await repository.appendHistory({ timestamp: now - 31 * 24 * 60 * 60 * 1000, accounts: { old: {} } })

  const result = await runScheduledRefresh({ repository, codexClient: {}, now: () => now })

  assert.deepEqual(result, { total: 0, ok: 0, failed: 0 })
  assert.deepEqual(await repository.listHistory(), [])
})

test('pending OAuth cleanup removes expired states and preserves fresh states', async () => {
  const repository = createMemoryRepository()
  await repository.putPendingLogin('expired', { slot: 'slot1', startedAt: 100 })
  await repository.putPendingLogin('fresh', { slot: 'slot1', startedAt: 1_000 })

  await repository.prunePendingLogins(500)

  assert.equal(await repository.getPendingLogin('expired'), null)
  assert.deepEqual(await repository.getPendingLogin('fresh'), { slot: 'slot1', startedAt: 1_000 })
})

test('browser refresh-all refreshes connected Codex accounts and returns sanitized views', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'secret-access',
    refresh: 'secret-refresh',
    email: 'owner@example.com',
  }, { version: '1' })
  const codexClient = {
    async refreshUsage(account) {
      return { ...account, usage: { plan: 'pro', windows: [] }, lastError: null }
    },
  }

  const response = await createHostedApp({ repository, codexClient })(new Request(
    'https://dashboard.test/api/refresh-all',
    { method: 'POST' },
  ))
  const text = await response.text()

  assert.equal(response.status, 200)
  assert.doesNotMatch(text, /secret-access|secret-refresh/)
  assert.equal(JSON.parse(text).results[0].ok, true)
  assert.equal(JSON.parse(text).accounts[0].usage.plan, 'pro')
})

test('refresh-all response includes hosted pace metrics from persisted history', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, { access: 'access', refresh: 'refresh' }, { version: '1' })
  await repository.appendHistory({
    timestamp: now - 60 * 60 * 1000,
    accounts: { slot1: { email: null, windows: [{ label: 'Week', usedPercent: 10 }] } },
  })
  const codexClient = {
    async refreshUsage(account) {
      return { ...account, usage: { plan: 'pro', windows: [
        { label: 'Week', usedPercent: 12, resetAt: now + 5 * 24 * 60 * 60 * 1000 },
      ] } }
    },
  }

  const response = await createHostedApp({ repository, codexClient, now: () => now })(new Request(
    'https://dashboard.test/api/refresh-all', { method: 'POST' },
  ))

  assert.equal((await response.json()).accounts[0].alertMetrics.actualRatePercentPerHour, 2)
})

test('concurrent manual callback exchanges consume OAuth state only once', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  let exchangeCalls = 0
  const codexClient = {
    async exchangeCode() {
      exchangeCalls += 1
      return { access: 'access', refresh: 'refresh', email: 'owner@example.com' }
    },
    async refreshUsage(account) {
      return account
    },
  }
  const handler = createHostedApp({ repository, codexClient })
  const login = await json(await handler(new Request(
    `https://dashboard.test/api/accounts/${slot}/login`,
    { method: 'POST' },
  )))
  const state = new URL(login.authUrl).searchParams.get('state')
  const request = () => new Request(`https://dashboard.test/api/accounts/${slot}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `http://localhost:1455/auth/callback?code=authorization-code&state=${state}`,
    }),
  })

  const responses = await Promise.all([handler(request()), handler(request())])

  assert.equal(exchangeCalls, 1)
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400])
})

test('OAuth exchange rejects a slot changed after login started without overwriting it', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  let exchangeCalls = 0
  const codexClient = {
    async exchangeCode() {
      exchangeCalls += 1
      return { access: 'stale-access', refresh: 'stale-refresh', accountId: 'stale-account' }
    },
  }
  const handler = createHostedApp({ repository, codexClient })
  const login = await json(await handler(new Request(`https://dashboard.test/api/accounts/${slot}/login`, {
    method: 'POST',
  })))
  const state = new URL(login.authUrl).searchParams.get('state')
  await repository.putAccount(slot, {
    access: 'new-access',
    refresh: 'new-refresh',
    accountId: 'new-account',
  }, { version: '1' })

  const response = await handler(new Request(`https://dashboard.test/api/accounts/${slot}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `http://localhost:1455/auth/callback?code=stale-code&state=${state}`,
    }),
  }))

  assert.equal(response.status, 409)
  assert.equal(exchangeCalls, 0)
  assert.equal((await repository.getAccount(slot)).account.accountId, 'new-account')
})

test('failed account refresh persists a sanitized error for the hosted UI', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'secret-access',
    refresh: 'secret-refresh',
    email: 'owner@example.com',
  }, { version: '1' })
  const codexClient = {
    async refreshUsage() {
      throw new Error('provider rejected secret-refresh')
    },
  }

  const response = await createHostedApp({ repository, codexClient, now: () => now })(new Request(
    `https://dashboard.test/api/accounts/${slot}/refresh`,
    { method: 'POST' },
  ))
  const text = await response.text()
  const stored = (await repository.getAccount(slot)).account

  assert.equal(response.status, 502)
  assert.doesNotMatch(text, /secret-refresh/)
  assert.equal(stored.lastError, 'provider rejected [redacted]')
  assert.equal(stored.lastCheckedAt, now)
})

test('usage failure after token rotation persists the rotated credentials before the error', async () => {
  const now = 1_800_000_000_000
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  await repository.putAccount(slot, {
    access: 'expired-access',
    refresh: 'invalidated-refresh',
    expires: now - 1,
    accountId: 'old-account',
  }, { version: '1' })
  const access = `header.${Buffer.from(JSON.stringify({
    'https://api.openai.com/profile': { email: 'owner@example.com' },
    'https://api.openai.com/auth': { chatgpt_account_id: 'new-account', chatgpt_plan_type: 'pro' },
  })).toString('base64url')}.signature`
  const codexClient = createCodexClient({
    now: () => now,
    fetch: async url => String(url).includes('/oauth/token')
      ? Response.json({ access_token: access, refresh_token: 'rotated-refresh', expires_in: 3600 })
      : new Response('', { status: 503 }),
  })

  const response = await createHostedApp({ repository, codexClient, now: () => now })(new Request(
    `https://dashboard.test/api/accounts/${slot}/refresh`,
    { method: 'POST' },
  ))
  const body = await response.text()
  const stored = (await repository.getAccount(slot)).account

  assert.equal(response.status, 502)
  assert.equal(stored.access, access)
  assert.equal(stored.refresh, 'rotated-refresh')
  assert.equal(stored.expires, now + 3_600_000)
  assert.equal(stored.accountId, 'new-account')
  assert.equal(stored.email, 'owner@example.com')
  assert.equal(stored.lastError, 'Usage request failed: 503')
  assert.doesNotMatch(body, /rotated-refresh|invalidated-refresh/)
})

test('manual OAuth exchange rejects an account already connected in another slot', async () => {
  const repository = createMemoryRepository()
  const firstSlot = await repository.createAccountSlot()
  const secondSlot = await repository.createAccountSlot()
  await repository.putAccount(firstSlot, {
    access: 'first-access',
    refresh: 'first-refresh',
    accountId: 'duplicate-account',
    email: 'owner@example.com',
  }, { version: '1' })
  const codexClient = {
    async exchangeCode() {
      return {
        access: 'second-access',
        refresh: 'second-refresh',
        accountId: 'duplicate-account',
        email: 'owner@example.com',
      }
    },
    async refreshUsage(account) {
      return account
    },
  }
  const handler = createHostedApp({ repository, codexClient })
  const login = await json(await handler(new Request(
    `https://dashboard.test/api/accounts/${secondSlot}/login`,
    { method: 'POST' },
  )))
  const state = new URL(login.authUrl).searchParams.get('state')

  const response = await handler(new Request(`https://dashboard.test/api/accounts/${secondSlot}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `http://localhost:1455/auth/callback?code=authorization-code&state=${state}`,
    }),
  }))

  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /already connected/i)
  assert.equal((await repository.getAccount(secondSlot)).account, null)
})

test('concurrent OAuth exchanges atomically reserve one account identity for one slot', async () => {
  const repository = createMemoryRepository()
  const slots = await Promise.all([repository.createAccountSlot(), repository.createAccountSlot()])
  const codexClient = {
    async exchangeCode() {
      return {
        access: 'secret-access',
        refresh: 'secret-refresh',
        accountId: 'shared-account',
        email: 'OWNER@example.com',
      }
    },
    async refreshUsage(account) {
      await new Promise(resolve => setTimeout(resolve, 5))
      return account
    },
  }
  const handler = createHostedApp({ repository, codexClient })
  const states = await Promise.all(slots.map(async slot => {
    const login = await json(await handler(new Request(`https://dashboard.test/api/accounts/${slot}/login`, {
      method: 'POST',
    })))
    return new URL(login.authUrl).searchParams.get('state')
  }))

  const responses = await Promise.all(slots.map((slot, index) => handler(new Request(
    `https://dashboard.test/api/accounts/${slot}/exchange`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: `http://localhost:1455/auth/callback?code=code-${index}&state=${states[index]}`,
      }),
    },
  ))))

  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
  assert.equal((await repository.listAccounts()).filter(record => record.account).length, 1)
})

test('failed OAuth account write releases the identity claim and never returns exchanged tokens', async () => {
  const repository = createMemoryRepository()
  const firstSlot = await repository.createAccountSlot()
  const secondSlot = await repository.createAccountSlot()
  let fail = true
  const codexClient = {
    async exchangeCode() {
      return { access: 'secret-access', refresh: 'secret-refresh', accountId: 'retry-account' }
    },
    async refreshUsage(account) {
      if (fail) {
        fail = false
        throw new Error(`failed with ${account.refresh}`)
      }
      return account
    },
  }
  const handler = createHostedApp({ repository, codexClient })
  async function exchange(slot) {
    const login = await json(await handler(new Request(`https://dashboard.test/api/accounts/${slot}/login`, {
      method: 'POST',
    })))
    const state = new URL(login.authUrl).searchParams.get('state')
    return handler(new Request(`https://dashboard.test/api/accounts/${slot}/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: `http://localhost:1455/auth/callback?code=code&state=${state}`,
      }),
    }))
  }

  const failed = await exchange(firstSlot)
  const failedText = await failed.text()
  const retried = await exchange(secondSlot)

  assert.equal(failed.status, 502)
  assert.doesNotMatch(failedText, /secret-access|secret-refresh/)
  assert.equal(retried.status, 200)
})

test('hosted OAuth callback can complete through the Netlify function route', async () => {
  const repository = createMemoryRepository()
  const slot = await repository.createAccountSlot()
  const codexClient = {
    async exchangeCode() {
      return { access: 'access', refresh: 'refresh', email: 'owner@example.com' }
    },
    async refreshUsage(account) {
      return account
    },
  }
  const loginHandler = createHostedApp({ repository, codexClient })
  const login = await json(await loginHandler(new Request(
    `https://dashboard.test/api/accounts/${slot}/login`,
    { method: 'POST' },
  )))
  const state = new URL(login.authUrl).searchParams.get('state')

  const callbackHandler = createHostedApp({ repository, codexClient })
  const response = await callbackHandler(new Request(
    `https://dashboard.test/auth/callback?code=authorization-code&state=${state}`,
  ))

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  assert.match(await response.text(), /Account connected/)
  assert.equal((await repository.getAccount(slot)).account.email, 'owner@example.com')
})
