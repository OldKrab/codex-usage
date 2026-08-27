import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Netlify target builds the hosted UI, routes the API, and schedules 15-minute refreshes', async () => {
  const config = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8')
  const api = await import('../netlify/functions/api.mjs')
  const scheduled = await import('../netlify/functions/refresh-codex.mjs')

  assert.match(config, /command\s*=\s*"npm run build"/)
  assert.match(config, /publish\s*=\s*"dist"/)
  assert.match(config, /VITE_HOSTED_MODE\s*=\s*"netlify"/)
  assert.match(config, /from\s*=\s*"\/api\/\*"/)
  assert.match(config, /to\s*=\s*"\/\.netlify\/functions\/api\/:splat"/)
  assert.match(config, /\[functions\."refresh-codex"\][\s\S]*schedule\s*=\s*"\*\/15 \* \* \* \*"/)
  assert.equal(typeof api.default, 'function')
  assert.equal(typeof scheduled.default, 'function')
})

test('hosted frontend excludes the Cursor card and fixed background schedule controls', async () => {
  const dashboard = await readFile(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8')
  const refreshPicker = await readFile(new URL('../src/components/RefreshPicker.tsx', import.meta.url), 'utf8')
  const accountCard = await readFile(new URL('../src/components/AccountCard.tsx', import.meta.url), 'utf8')

  assert.match(dashboard, /!HOSTED_MODE\s*&&\s*<CursorCard/)
  assert.match(refreshPicker, /!HOSTED_MODE\s*&&/)
  assert.match(accountCard, /!HOSTED_MODE\s*&&\s*account\.provider === 'claude-code'/)
  assert.match(accountCard, /!HOSTED_MODE\s*&&\s*account\.provider === 'opencode-go'/)
})

test('README provides the official deploy button and mandatory private-project warning', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

  assert.match(readme, /https:\/\/app\.netlify\.com\/start\/deploy\?repository=https:\/\/github\.com\/OldKrab\/codex-usage/)
  assert.match(readme, /https:\/\/www\.netlify\.com\/img\/deploy\/button\.svg/)
  assert.match(readme, /created (?:on or )?after 2026-07-28[\s\S]*default to Private/i)
  assert.match(readme, /older teams[\s\S]*Project visibility = Private[\s\S]*before connecting/i)
  assert.match(readme, /Netlify Blobs[\s\S]*Free/i)
})
