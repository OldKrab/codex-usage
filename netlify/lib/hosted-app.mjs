import crypto from 'node:crypto'
import {
  calculateHostedAlertMetrics,
  hasPersistedPaceSamples,
  withUpdatedHostedPaceSamples,
} from './hosted-pacing.mjs'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const REDIRECT_URI = 'http://localhost:1455/auth/callback'
const SCOPE = 'openid profile email offline_access'
const DEFAULT_SETTINGS = { liveInterval: 30, backgroundInterval: 900 }
const LIVE_INTERVALS = new Set([0, 10, 30, 60, 300])

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function accountView(slot, account, alertMetrics = null) {
  if (!account) return { slot, connected: false }
  return {
    slot,
    connected: true,
    email: account.email || null,
    accountId: account.accountId || null,
    planTypeFromJwt: account.planTypeFromJwt || null,
    usage: account.usage || null,
    alertMetrics,
    expires: account.expires || null,
    updatedAt: account.updatedAt || null,
    lastCheckedAt: account.lastCheckedAt || null,
    lastError: account.lastError || null,
    entitlement: account.entitlement || null,
  }
}

function accountsPayload(records, history = [], now = Date.now()) {
  return {
    mode: 'hosted',
    providers: ['codex'],
    accounts: records.map(record => accountView(record.slot, record.account,
      calculateHostedAlertMetrics({ slot: record.slot, account: record.account, history, now }))),
  }
}

async function repositoryAccountsPayload(repository, records, now) {
  const needsLegacyHistory = records.some(record => record.account && !hasPersistedPaceSamples(record.account))
  const history = needsLegacyHistory
    ? await repository.listHistory({ since: now - 7 * 24 * 60 * 60 * 1000 })
    : []
  return accountsPayload(records, history, now)
}

async function repositoryAccountView(repository, slot, account, now) {
  const history = hasPersistedPaceSamples(account)
    ? []
    : await repository.listHistory({ since: now - 7 * 24 * 60 * 60 * 1000 })
  return accountView(slot, account, calculateHostedAlertMetrics({ slot, account, history, now }))
}

function sanitizedError(error, ...accounts) {
  let message = String(error?.message || error)
  const tokens = accounts.flatMap(account => [account?.access, account?.refresh, account?.idToken])
  for (const token of tokens) {
    if (typeof token === 'string' && token) message = message.split(token).join('[redacted]')
  }
  return message
}

function accountIdentity(account) {
  if (typeof account?.accountId === 'string' && account.accountId.trim()) {
    return `account:${account.accountId.trim()}`
  }
  if (typeof account?.email === 'string' && account.email.trim()) {
    return `email:${account.email.trim().toLowerCase()}`
  }
  return null
}

export async function refreshCodexSlot({ repository, codexClient, slot, now = Date.now }) {
  const startedAt = now()
  let legacyHistory = null
  const lease = await repository.acquireRefreshLease(slot, {
    now: startedAt,
    leaseMs: 25_000,
    minimumIntervalMs: 10_000,
  })
  if (!lease) return { ok: false, status: 429, error: 'Refresh already in progress or recently completed' }
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await repository.getAccount(slot)
      if (!current) return { ok: false, status: 404, error: 'Unknown slot' }
      if (!current.account) return { ok: false, status: 400, error: 'Slot is empty' }
      let refreshed
      try {
        refreshed = await codexClient.refreshUsage(current.account)
      } catch (error) {
        const durableAccount = error?.refreshedAccount
          ? { ...current.account, ...error.refreshedAccount }
          : current.account
        const message = sanitizedError(error, durableAccount, current.account)
        const failed = { ...durableAccount, lastCheckedAt: now(), lastError: message }
        try {
          const saved = await repository.putAccount(slot, failed, { version: current.version })
          return { ok: false, status: 502, error: message, account: accountView(slot, saved.account) }
        } catch (writeError) {
          if (writeError?.code !== 'CONFLICT' || attempt === 2) throw writeError
          continue
        }
      }
      try {
        const sampledAt = now()
        if (!hasPersistedPaceSamples(current.account) && legacyHistory === null) {
          legacyHistory = await repository.listHistory({ since: sampledAt - 7 * 24 * 60 * 60 * 1000 })
        }
        const accountWithPace = withUpdatedHostedPaceSamples(current.account, refreshed, sampledAt, {
          history: legacyHistory || [],
          slot,
        })
        const saved = await repository.putAccount(slot, accountWithPace, { version: current.version })
        return {
          ok: true,
          status: 200,
          account: accountView(slot, saved.account),
          internalAccount: saved.account,
        }
      } catch (error) {
        if (error?.code !== 'CONFLICT' || attempt === 2) throw error
      }
    }
  } finally {
    await repository.releaseRefreshLease(slot, lease.token, now())
  }
}

export async function refreshAllCodexAccounts({ repository, codexClient, now = Date.now }) {
  const records = await repository.listAccounts()
  const connected = records.filter(record => record.account)
  const results = new Array(connected.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < connected.length) {
      const index = nextIndex++
      const { slot } = connected[index]
      results[index] = await refreshCodexSlot({ repository, codexClient, slot, now }).catch(error => ({
        ok: false,
        status: 502,
        error: String(error?.message || error),
      }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, connected.length) }, () => worker()))
  const freshRecords = await repository.listAccounts()
  const accounts = {}
  for (const { slot, account } of freshRecords) {
    if (!account?.usage) continue
    accounts[slot] = {
      email: account.email || null,
      windows: (account.usage.windows || []).map(window => ({
        label: window.label,
        usedPercent: window.usedPercent,
      })),
    }
  }
  if (Object.keys(accounts).length > 0) {
    await repository.appendHistory({ timestamp: now(), accounts })
  }
  return { results, records: freshRecords }
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

async function createLogin(repository, slot, now) {
  const account = await repository.getAccount(slot)
  if (!account) return null
  const currentTime = now()
  await repository.prunePendingLogins(currentTime - 15 * 60 * 1000)
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  const state = base64url(crypto.randomBytes(32))
  await repository.putPendingLogin(state, { slot, slotVersion: account.version, verifier, startedAt: currentTime })

  const authUrl = new URL(AUTHORIZE_URL)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('id_token_add_organizations', 'true')
  authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
  authUrl.searchParams.set('originator', 'codex-usage-dashboard')
  return authUrl.toString()
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

/** Creates the Codex-only HTTP API used by Netlify Functions. */
export function createHostedApp({ repository, codexClient, now = Date.now }) {
  return async function handle(request) {
    const url = new URL(request.url)
    const internalPrefix = '/.netlify/functions/api/'
    if (url.pathname.startsWith(internalPrefix)) {
      const routedPath = url.pathname.slice(internalPrefix.length)
      url.pathname = routedPath === 'auth-callback' ? '/auth/callback' : `/api/${routedPath}`
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.headers.get('origin')
      if (origin !== url.origin) return json({ ok: false, error: 'Forbidden origin' }, 403)
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, mode: 'hosted', storage: 'netlify-blobs' })
    }

    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state')
      const pending = state ? await repository.getPendingLogin(state) : null
      if (!pending) return html('<h1>OAuth error</h1><p>Unknown or expired login state.</p>', 400)
      const exchanged = await handle(new Request(`${url.origin}/api/accounts/${pending.slot}/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: url.origin },
        body: JSON.stringify({ url: url.toString() }),
      }))
      const result = await exchanged.json()
      if (!exchanged.ok) {
        return html(`<h1>OAuth failed</h1><p>${escapeHtml(result.error || 'Account connection failed')}</p>`, exchanged.status)
      }
      return html(`<!doctype html><html><head><meta charset="utf-8"><title>OAuth complete</title></head><body><h1>Account connected</h1><p>Slot: <b>${escapeHtml(pending.slot)}</b></p><p>You can close this tab and return to the <a href="/">dashboard</a>.</p></body></html>`)
    }

    if (request.method === 'POST' && url.pathname === '/api/accounts/create') {
      const slot = await repository.createAccountSlot()
      const records = await repository.listAccounts()
      return json({
        ok: true,
        slot,
        ...await repositoryAccountsPayload(repository, records, now()),
      })
    }

    if (request.method === 'GET' && url.pathname === '/api/accounts') {
      const records = await repository.listAccounts()
      const currentTime = now()
      return json(await repositoryAccountsPayload(repository, records, currentTime))
    }

    if (request.method === 'GET' && url.pathname === '/api/settings') {
      const stored = await repository.getSettings()
      return json(stored?.settings || DEFAULT_SETTINGS)
    }

    if (request.method === 'PUT' && url.pathname === '/api/settings') {
      const body = await readJson(request)
      if ('backgroundInterval' in body && Number(body.backgroundInterval) !== 900) {
        return json({ ok: false, error: 'Hosted background refresh is fixed at 15 minutes' }, 400)
      }
      const liveInterval = 'liveInterval' in body ? Number(body.liveInterval) : undefined
      if (liveInterval !== undefined && !LIVE_INTERVALS.has(liveInterval)) {
        return json({ ok: false, error: 'Invalid liveInterval' }, 400)
      }
      const stored = await repository.getSettings()
      const updated = {
        ...(stored?.settings || DEFAULT_SETTINGS),
        ...(liveInterval === undefined ? {} : { liveInterval }),
        backgroundInterval: 900,
      }
      await repository.putSettings(updated, { version: stored?.version || null })
      return json({ ok: true, ...updated })
    }

    if (request.method === 'GET' && url.pathname === '/api/history') {
      const range = url.searchParams.get('range') || '24h'
      const rangeMs = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 }[range] || 86_400_000
      const since = now() - rangeMs
      const snapshots = await repository.listHistory({ since })
      return json({ snapshots })
    }

    if (request.method === 'POST' && url.pathname === '/api/refresh-all') {
      const refreshed = await refreshAllCodexAccounts({ repository, codexClient, now })
      return json({
        ok: true,
        results: refreshed.results.map(result => result.ok
          ? { ok: true, account: result.account }
          : { ok: false, error: result.error }),
        ...await repositoryAccountsPayload(repository, refreshed.records, now()),
      })
    }

    const accountAction = url.pathname.match(/^\/api\/accounts\/(slot\d+)\/(login|exchange|refresh|logout|delete)$/)
    if (request.method === 'POST' && accountAction?.[2] === 'login') {
      const slot = accountAction[1]
      const authUrl = await createLogin(repository, slot, now)
      return authUrl
        ? json({ ok: true, authUrl, slot })
        : json({ ok: false, error: 'Unknown slot' }, 404)
    }

    if (request.method === 'POST' && accountAction?.[2] === 'exchange') {
      const slot = accountAction[1]
      const body = await readJson(request)
      let callback
      try {
        callback = new URL(String(body.url || ''))
      } catch {
        return json({ ok: false, error: 'Invalid URL' }, 400)
      }
      const code = callback.searchParams.get('code')
      const state = callback.searchParams.get('state')
      const pending = state ? await repository.claimPendingLogin(state) : null
      if (!code || !state || !pending || pending.slot !== slot || now() - pending.startedAt > 15 * 60 * 1000) {
        return json({ ok: false, error: 'Unknown or expired state' }, 400)
      }
      const current = await repository.getAccount(slot)
      if (!current) return json({ ok: false, error: 'Unknown slot' }, 404)
      if (String(current.version) !== String(pending.slotVersion)) {
        await repository.deletePendingLogin(state)
        return json({ ok: false, error: 'Account slot changed while login was in progress' }, 409)
      }
      let connected = null
      try {
        connected = await codexClient.exchangeCode({ code, verifier: pending.verifier, redirectUri: REDIRECT_URI })
        const existing = (await repository.listAccounts()).find(record =>
          record.slot !== slot && record.account && (
            (connected.accountId && record.account.accountId === connected.accountId)
            || (connected.email && record.account.email === connected.email)
          ),
        )
        if (existing) {
          await repository.deletePendingLogin(state)
          return json({
            ok: false,
            error: `This account is already connected (${existing.account.email || existing.slot})`,
          }, 409)
        }
        const identity = accountIdentity(connected)
        if (!identity) return json({ ok: false, error: 'Connected account identity is missing' }, 502)
        const claimed = await repository.claimIdentity(identity, slot)
        if (!claimed) {
          await repository.deletePendingLogin(state)
          return json({ ok: false, error: 'This account is already connected' }, 409)
        }
        try {
          connected = await codexClient.refreshUsage(connected)
          connected = withUpdatedHostedPaceSamples(current.account, connected, now())
          await repository.putAccount(slot, connected, { version: current.version })
        } catch (error) {
          await repository.releaseIdentity(identity, slot)
          throw error
        }
        await repository.deletePendingLogin(state)
        const records = await repository.listAccounts()
        return json({ ok: true, slot, ...await repositoryAccountsPayload(repository, records, now()) })
      } catch (error) {
        return json({ ok: false, error: sanitizedError(error, connected) }, 502)
      }
    }

    if (request.method === 'POST' && accountAction?.[2] === 'refresh') {
      try {
        const result = await refreshCodexSlot({ repository, codexClient, slot: accountAction[1], now })
        const refreshedView = result.ok
          ? await repositoryAccountView(repository, accountAction[1], result.internalAccount, now())
          : null
        return json(result.ok
          ? { ok: true, slot: accountAction[1], account: refreshedView }
          : { ok: false, error: result.error }, result.status)
      } catch (error) {
        return json({ ok: false, error: String(error?.message || error) }, 502)
      }
    }

    if (request.method === 'POST' && accountAction?.[2] === 'logout') {
      const current = await repository.getAccount(accountAction[1])
      if (!current) return json({ ok: false, error: 'Unknown slot' }, 404)
      const saved = await repository.putAccount(accountAction[1], null, { version: current.version })
      const identity = accountIdentity(current.account)
      if (identity) await repository.releaseIdentity(identity, accountAction[1])
      return json({ ok: true, slot: accountAction[1], account: accountView(accountAction[1], saved.account) })
    }

    if (request.method === 'POST' && accountAction?.[2] === 'delete') {
      const current = await repository.getAccount(accountAction[1])
      if (!current) return json({ ok: false, error: 'Unknown slot' }, 404)
      if (current.account) return json({ ok: false, error: 'Disconnect the account first' }, 400)
      await repository.deleteAccount(accountAction[1], { version: current.version })
      const records = await repository.listAccounts()
      return json({ ok: true, slot: accountAction[1], ...await repositoryAccountsPayload(repository, records, now()) })
    }

    return json({ ok: false, error: 'Not found' }, 404)
  }
}
