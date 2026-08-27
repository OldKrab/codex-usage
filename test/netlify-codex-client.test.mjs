import assert from 'node:assert/strict'
import test from 'node:test'

import { createCodexClient } from '../netlify/lib/codex-client.mjs'

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

test('expired hosted credentials rotate before fetching normalized Codex usage', async () => {
  const access = jwt({
    'https://api.openai.com/profile': { email: 'owner@example.com' },
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-1',
      chatgpt_plan_type: 'pro',
    },
  })
  const requests = []
  const fetch = async (url, options) => {
    requests.push({ url: String(url), options })
    if (String(url).includes('/oauth/token')) {
      return Response.json({ access_token: access, refresh_token: 'rotated-refresh', expires_in: 3600 })
    }
    return Response.json({
      plan_type: 'pro',
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18_000, reset_at: 1_900_000_000 },
        secondary_window: { used_percent: 20, limit_window_seconds: 604_800, reset_at: 1_900_604_800 },
      },
    })
  }
  const client = createCodexClient({ fetch, now: () => 1_800_000_000_000 })

  const refreshed = await client.refreshUsage({
    access: 'expired-access',
    refresh: 'old-refresh',
    expires: 1_700_000_000_000,
  })

  assert.equal(refreshed.refresh, 'rotated-refresh')
  assert.equal(refreshed.email, 'owner@example.com')
  assert.deepEqual(refreshed.usage.windows.map(window => [window.label, window.usedPercent]), [
    ['5h', 10],
    ['Week', 20],
  ])
  assert.equal(requests.length, 2)
  assert.equal(requests[1].options.headers['ChatGPT-Account-Id'], 'account-1')
})

test('hosted Codex errors never include provider response bodies that may contain tokens', async () => {
  const client = createCodexClient({
    fetch: async () => new Response('provider leaked refresh_token=top-secret', { status: 401 }),
  })

  await assert.rejects(
    client.exchangeCode({ code: 'bad-code', verifier: 'verifier', redirectUri: 'http://localhost:1455/auth/callback' }),
    error => error.message === 'Token exchange failed: 401',
  )
})

test('hosted provider requests abort at the configured timeout without leaking credentials', async () => {
  const client = createCodexClient({
    requestTimeoutMs: 10,
    fetch: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }),
  })

  await assert.rejects(
    client.refreshUsage({ access: 'secret-access', refresh: 'secret-refresh', expires: Date.now() + 60_000 }),
    error => error.message === 'Usage request timed out',
  )
})
