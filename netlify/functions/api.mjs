import { createBlobsRepository } from '../lib/blobs-repository.mjs'
import { createCodexClient } from '../lib/codex-client.mjs'
import { createHostedApp } from '../lib/hosted-app.mjs'

export default async function handler(request) {
  try {
    const app = createHostedApp({
      repository: createBlobsRepository(),
      codexClient: createCodexClient(),
    })
    return await app(request)
  } catch {
    return Response.json({ ok: false, error: 'Hosted request failed' }, {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
