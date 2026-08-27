import { refreshAllCodexAccounts } from './hosted-app.mjs'

/** Refreshes connected Codex accounts and writes one immutable five-minute history bucket. */
export async function runScheduledRefresh({ repository, codexClient, now = Date.now }) {
  const currentTime = now()
  await repository.pruneHistory(currentTime - 30 * 24 * 60 * 60 * 1000)
  await repository.prunePendingLogins(currentTime - 15 * 60 * 1000)
  const { results } = await refreshAllCodexAccounts({ repository, codexClient, now })
  return {
    total: results.length,
    ok: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
  }
}
