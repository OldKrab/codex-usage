import { useState } from 'react'
import { LogIn, SquareTerminal } from 'lucide-react'
import type { Account } from '../types/api'
import { KebabMenu } from './KebabMenu'
import { useLoginSlot, useExchangeCallback } from '../lib/hooks'
import { toast } from 'sonner'

export function EmptyCard({ account }: { account: Account }) {
  const loginSlot = useLoginSlot()
  const exchangeCallback = useExchangeCallback()
  const [callbackUrl, setCallbackUrl] = useState('')

  const handleLogin = async () => {
    try {
      const data = await loginSlot.mutateAsync(account.slot)
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      toast.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleExchange = async () => {
    if (!callbackUrl.trim()) return
    try {
      await exchangeCallback.mutateAsync({ slot: account.slot, url: callbackUrl.trim() })
      setCallbackUrl('')
      toast.success('Account connected')
    } catch (err) {
      toast.error(`Exchange failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <article className="bg-surface rounded-lg p-2.5 max-sm:rounded-xl max-sm:p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted mb-1.5">
        <SquareTerminal className="w-3.5 h-3.5" />
        <span>Codex</span>
      </div>

      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h2 className="text-[15px] font-semibold text-text-muted">Empty slot</h2>
        <KebabMenu account={account} />
      </div>

      <div className="flex flex-col items-center gap-2 py-1.5">
        <button
          onClick={handleLogin}
          disabled={loginSlot.isPending}
          className="flex min-h-11 items-center gap-2 px-4 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent/90 active:bg-accent/80 transition-colors disabled:opacity-50"
        >
          <LogIn className="w-4 h-4" />
          Login
        </button>
      </div>

      <div className="p-2 bg-[#0d1117] rounded-md">
        <p className="text-xs text-text-muted mb-1">
          After authorization, paste the callback URL:
        </p>
        <div className="flex gap-2 max-[420px]:flex-col">
          <input
            type="text"
            value={callbackUrl}
            onChange={e => setCallbackUrl(e.target.value)}
            placeholder="http://localhost:1455/auth/callback?code=…"
            className="min-h-11 min-w-0 flex-1 bg-bg text-text border border-border rounded-md px-3 py-2 text-xs focus:outline-none focus:border-accent"
            onKeyDown={e => e.key === 'Enter' && handleExchange()}
          />
          <button
            onClick={handleExchange}
            disabled={exchangeCallback.isPending}
            className="min-h-11 px-3 py-2 bg-surface-hover text-text rounded-md text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {exchangeCallback.isPending ? '⏳' : 'OK'}
          </button>
        </div>
      </div>
    </article>
  )
}
