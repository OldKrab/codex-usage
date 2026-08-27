import { KeyRound, RefreshCw, Sparkles, SquareTerminal } from 'lucide-react'
import type { Account } from '../types/api'
import { QuotaBlock } from './QuotaBlock'
import { BurnRateBlock } from './BurnRateBlock'
import { ShortWindowPaceBlock } from './ShortWindowPaceBlock'
import { KebabMenu } from './KebabMenu'
import { formatRelativeTime, formatSubscriptionStatus } from '../lib/utils'
import { useRefreshSlot } from '../lib/hooks'
import { toast } from 'sonner'

export function AccountCard({ account }: { account: Account }) {
  const refreshSlot = useRefreshSlot()
  const windows = account.usage?.windows ?? []
  const capacityWindows = account.alertMetrics?.shortWindow
    ? windows.filter(window => window.label !== account.alertMetrics?.shortWindow?.label)
    : windows
  const summary = account.usage?.summary
  const plan = account.usage?.plan ?? account.planTypeFromJwt
  const subStatus = formatSubscriptionStatus(account.entitlement)
  const isClaude = account.provider === 'claude-code'
  const isOpenCodeGo = account.provider === 'opencode-go'
  const title = isClaude ? 'Claude Code' : isOpenCodeGo ? 'OpenCode Go' : (account.email ?? 'Unknown')
  const detail = isClaude || isOpenCodeGo
    ? [account.email, account.orgName].filter(Boolean).join(' · ')
    : null
  const provider = isClaude
    ? { label: 'Claude Code', Icon: Sparkles }
    : isOpenCodeGo
      ? { label: 'OpenCode Go', Icon: KeyRound }
      : { label: 'Codex', Icon: SquareTerminal }
  const ProviderIcon = provider.Icon

  const handleRefresh = async () => {
    try {
      await refreshSlot.mutateAsync(account.slot)
    } catch (err) {
      toast.error(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_22px_60px_rgba(0,0,0,0.16)]">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 max-sm:px-4 max-sm:py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-hover text-text-muted">
            <ProviderIcon className="size-[18px]" />
          </div>
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              <span>{provider.label}</span>
              <span className="inline-flex items-center gap-1 normal-case tracking-normal text-good">
                <span className="size-1.5 rounded-full bg-good" /> live
              </span>
            </div>
            <h2 className="truncate text-[15px] font-semibold leading-5 tracking-tight">{title}</h2>
            {(detail || plan) && (
              <div className="truncate text-xs leading-4 text-text-muted">
                {detail || plan}
                {detail && plan ? ` · ${plan}` : ''}
                {subStatus && (
                  <span className={subStatus.color === 'bad' ? 'text-bad' : subStatus.color === 'warn' ? 'text-warn' : ''}>
                    {' · '}{subStatus.text}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {!account.readOnly && <KebabMenu account={account} />}
      </header>

      <div className={account.alertMetrics ? '' : 'grid grid-cols-[minmax(0,1.2fr)_minmax(310px,0.8fr)] max-lg:grid-cols-1'}>
        <div className="min-w-0 p-5 max-sm:p-4">
          {account.alertMetrics ? (
            <div>
              <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Usage limits</div>
              <div className="space-y-4">
                {account.alertMetrics.shortWindow && <ShortWindowPaceBlock metrics={account.alertMetrics.shortWindow} />}
                <div className="border-t border-border pt-4">
                  <BurnRateBlock metrics={account.alertMetrics} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-56 items-center justify-center text-sm text-text-muted">Usage speed becomes available after usage is recorded.</div>
          )}
        </div>

        {!account.alertMetrics && <div className="border-l border-border p-5 max-lg:border-l-0 max-lg:border-t max-sm:p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Capacity</div>
              <div className="mt-0.5 text-sm font-medium">Remaining quota</div>
            </div>
          </div>

          <div className="divide-y divide-border">
            {capacityWindows.map(window => (
              <QuotaBlock
                key={window.label}
                window={window}
                label={window.label === 'Week' ? 'Weekly' : window.label === 'Day' ? 'Daily' : window.label === 'Month' ? 'Monthly' : window.label}
              />
            ))}
          </div>

          {!windows.length && summary?.eventCount ? (
            <div className="border-t border-border pt-4 text-sm">
              <div className="flex items-center justify-between"><span className="text-text-muted">Requests</span><span className="font-semibold tabular-nums">{summary.eventCount}</span></div>
              <div className="mt-2 flex items-center justify-between"><span className="text-text-muted">Tokens</span><span className="tabular-nums">{Number(summary.totalTokens ?? 0).toLocaleString()}</span></div>
              <div className="mt-2 flex items-center justify-between"><span className="text-text-muted">Estimated cost</span><span className="tabular-nums">${Number(summary.totalCost ?? 0).toFixed(4)}</span></div>
            </div>
          ) : !windows.length && (
            <div className="py-8 text-center text-sm text-text-muted">No usage data yet</div>
          )}

        </div>}
      </div>

      {account.lastError && (
        <div className="mx-5 mb-4 rounded-lg bg-bad/10 px-3 py-2 text-xs leading-5 text-bad break-words max-sm:mx-4">{account.lastError}</div>
      )}

      <footer className="flex min-h-14 items-center justify-between border-t border-border px-5 text-xs text-text-muted max-sm:px-4">
        <span>Checked {formatRelativeTime(account.lastCheckedAt)}</span>
        <button onClick={handleRefresh} disabled={refreshSlot.isPending} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 font-medium text-text hover:bg-surface-hover disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${refreshSlot.isPending ? 'animate-spin' : ''}`} />
          <span>Update account</span>
        </button>
      </footer>
    </article>
  )
}
