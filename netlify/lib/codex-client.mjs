import { preserveTransientWindowRegressions } from '../../usage-guard.mjs'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'
const PROFILE_CLAIM_PATH = 'https://api.openai.com/profile'

function decodeJwt(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return null
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function tokenProfile(accessToken) {
  const payload = decodeJwt(accessToken) || {}
  const auth = payload[JWT_CLAIM_PATH] || {}
  const profile = payload[PROFILE_CLAIM_PATH] || {}
  return {
    accountId: typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : null,
    email: typeof profile.email === 'string' ? profile.email : null,
    planTypeFromJwt: typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : null,
  }
}

function entitlementFromIdToken(idToken, now) {
  const auth = decodeJwt(idToken)?.[JWT_CLAIM_PATH]
  if (!auth) return null
  const plan = auth.chatgpt_plan_type || null
  const activeUntil = auth.chatgpt_subscription_active_until || null
  const activeUntilMs = activeUntil ? Date.parse(activeUntil) : null
  const active = Boolean(plan && plan !== 'free' && Number.isFinite(activeUntilMs) && activeUntilMs > now())
  if (activeUntil && !active) return null
  return { active, plan, activeUntil }
}

function normalizeWindowLabel(hours) {
  if (hours >= 168) return 'Week'
  if (hours >= 24) return 'Day'
  return `${hours}h`
}

function normalizeUsage(data) {
  const windows = []
  const primary = data?.rate_limit?.primary_window
  if (primary && Number.isFinite(Number(primary.used_percent))) {
    windows.push({
      label: normalizeWindowLabel(Math.round(Number(primary.limit_window_seconds || 10_800) / 3600)),
      usedPercent: Number(primary.used_percent),
      resetAt: primary.reset_at ? Number(primary.reset_at) * 1000 : null,
    })
  }
  const secondary = data?.rate_limit?.secondary_window
  if (secondary && Number.isFinite(Number(secondary.used_percent))) {
    const hours = Math.round(Number(secondary.limit_window_seconds || 86_400) / 3600)
    const isWeeklyByResetGap = Number(secondary.reset_at) - Number(primary?.reset_at) >= 3 * 24 * 60 * 60
    windows.push({
      label: isWeeklyByResetGap ? 'Week' : normalizeWindowLabel(hours),
      usedPercent: Number(secondary.used_percent),
      resetAt: secondary.reset_at ? Number(secondary.reset_at) * 1000 : null,
    })
  }
  let plan = data?.plan_type || null
  const balance = Number(data?.credits?.balance)
  if (Number.isFinite(balance) && balance > 0) {
    plan = plan ? `${plan} ($${balance.toFixed(2)})` : `$${balance.toFixed(2)}`
  }
  return { plan, windows }
}

async function tokenRequest(fetch, parameters, failureLabel, now) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...parameters, client_id: CLIENT_ID }),
  })
  if (!response.ok) throw new Error(`${failureLabel}: ${response.status}`)
  const body = await response.json()
  if (!body.access_token || !body.refresh_token || typeof body.expires_in !== 'number') {
    throw new Error(`${failureLabel}: invalid response`)
  }
  const profile = tokenProfile(body.access_token)
  if (!profile.accountId) throw new Error(`${failureLabel}: account ID missing`)
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expires: now() + body.expires_in * 1000,
    ...profile,
    entitlement: entitlementFromIdToken(body.id_token, now),
    updatedAt: now(),
  }
}

/** Creates the OpenAI boundary used by the hosted runtime. */
export function createCodexClient({ fetch = globalThis.fetch, now = Date.now, requestTimeoutMs = 8_000 } = {}) {
  async function request(url, options, label) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      return await fetch(url, { ...options, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${label} timed out`)
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async function rotate(account) {
    const next = await tokenRequest((url, options) => request(url, options, 'Token request'), {
      grant_type: 'refresh_token',
      refresh_token: account.refresh,
    }, 'Token refresh failed', now)
    return { ...account, ...next, entitlement: next.entitlement || account.entitlement || null }
  }

  async function fetchUsage(account) {
    const headers = {
      authorization: `Bearer ${account.access}`,
      accept: 'application/json',
      'user-agent': 'CodexUsageDashboard',
    }
    if (account.accountId) headers['ChatGPT-Account-Id'] = account.accountId
    const response = await request(USAGE_URL, { method: 'GET', headers }, 'Usage request')
    if (!response.ok) {
      const error = new Error(`Usage request failed: ${response.status}`)
      error.status = response.status
      throw error
    }
    return normalizeUsage(await response.json())
  }

  return {
    async exchangeCode({ code, verifier, redirectUri }) {
      return tokenRequest((url, options) => request(url, options, 'Token request'), {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }, 'Token exchange failed', now)
    },

    async refreshUsage(account) {
      let working = { ...account }
      let rotated = false
      if (!working.access || now() >= Number(working.expires || 0)) {
        working = await rotate(working)
        rotated = true
      }
      let usage
      try {
        usage = await fetchUsage(working)
      } catch (error) {
        if (error?.status !== 401 && error?.status !== 403) {
          if (rotated) Object.defineProperty(error, 'refreshedAccount', { value: working })
          throw error
        }
        working = await rotate(working)
        rotated = true
        try {
          usage = await fetchUsage(working)
        } catch (retryError) {
          Object.defineProperty(retryError, 'refreshedAccount', { value: working })
          throw retryError
        }
      }
      return {
        ...working,
        usage: preserveTransientWindowRegressions(account.usage, usage, now()),
        lastCheckedAt: now(),
        lastError: null,
      }
    },
  }
}
