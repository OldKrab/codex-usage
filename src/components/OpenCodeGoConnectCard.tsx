import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useConnectOpenCodeGo } from '../lib/hooks'

export function OpenCodeGoConnectCard() {
  const connectOpenCodeGo = useConnectOpenCodeGo()
  const [apiKey, setApiKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [authToken, setAuthToken] = useState('')

  const handleConnect = async () => {
    if (!apiKey.trim() && (!workspaceId.trim() || !authToken.trim())) return
    try {
      await connectOpenCodeGo.mutateAsync({
        apiKey: apiKey.trim() || undefined,
        workspaceId: workspaceId.trim() || undefined,
        authToken: authToken.trim() || undefined,
      })
      setApiKey('')
      setWorkspaceId('')
      setAuthToken('')
      toast.success('OpenCode Go connected')
    } catch (err) {
      toast.error(`Connect failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <article className="bg-surface rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted mb-1.5">
        <KeyRound className="w-3.5 h-3.5" />
        <span>OpenCode Go</span>
      </div>

      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div>
          <h2 className="text-[15px] font-semibold text-text-muted">OpenCode Go</h2>
          <div className="text-[11px] text-text-muted leading-4">Paste Go API key. Console fields are optional.</div>
        </div>
      </div>

      <div className="p-2 bg-[#0d1117] rounded-md">
        <div className="grid gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="API key"
            className="bg-bg text-text border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
          />
          <input
            type="text"
            value={workspaceId}
            onChange={e => setWorkspaceId(e.target.value)}
            placeholder="Workspace ID"
            className="bg-bg text-text border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
          />
          <input
            type="password"
            value={authToken}
            onChange={e => setAuthToken(e.target.value)}
            placeholder="auth cookie"
            className="bg-bg text-text border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
          />
          <button
            onClick={handleConnect}
            disabled={connectOpenCodeGo.isPending || (!apiKey.trim() && (!workspaceId.trim() || !authToken.trim()))}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1 bg-accent text-white rounded-md text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>
    </article>
  )
}
