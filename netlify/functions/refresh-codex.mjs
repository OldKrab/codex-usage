import { createBlobsRepository } from '../lib/blobs-repository.mjs'
import { createCodexClient } from '../lib/codex-client.mjs'
import { runScheduledRefresh } from '../lib/scheduled-refresh.mjs'

export default async function scheduledRefresh() {
  const result = await runScheduledRefresh({
    repository: createBlobsRepository(),
    codexClient: createCodexClient(),
  })
  console.log(`Scheduled Codex refresh: ${result.ok}/${result.total} succeeded`)
}
