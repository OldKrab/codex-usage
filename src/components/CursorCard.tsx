import { useEffect, useState, type FormEvent } from 'react'
import { Code2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { CursorPaceMetrics, CursorSubscription, CursorSubscriptionConfig } from '../types/api'
import {
  useCursorSubscription,
  useDeleteCursorSubscription,
  useRefreshCursorSubscription,
  useSaveCursorSubscription,
} from '../lib/hooks'
import { formatRelativeTime } from '../lib/utils'
import { QuotaPaceBlock } from './QuotaPaceBlock'

type CursorDraft = {
  plan: string
  monthlyCost: string
  currency: string
  renewalDate: string
}

const emptyDraft: CursorDraft = {
  plan: 'Cursor',
  monthlyCost: '',
  currency: 'USD',
  renewalDate: '',
}

function toDraft(cursor: CursorSubscription | null): CursorDraft {
  if (!cursor) return { ...emptyDraft }
  return {
    plan: cursor.plan,
    monthlyCost: cursor.monthlyCost === null ? '' : String(cursor.monthlyCost),
    currency: cursor.currency,
    renewalDate: cursor.renewalDate || '',
  }
}

function formatMoney(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return 'Not set'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return value.toFixed(2) + ' ' + currency
  }
}

function recentWindowLabel(metrics: CursorPaceMetrics): string {
  if (!metrics.recentRateAvailable) return `${Math.round(metrics.recentWindowHours * 60)}m collected`
  if (metrics.recentWarmingUp) {
    return `${metrics.recentWindowHours.toFixed(1)}h of ${metrics.recentWindowTargetHours}h`
  }
  return `${metrics.recentWindowTargetHours}h rolling`
}

function CursorPaceBlock({ label, metrics }: { label: string; metrics: CursorPaceMetrics }) {
  return (
    <QuotaPaceBlock
      label={label}
      usedPercent={metrics.usedPercent}
      remainingPercent={metrics.remainingPercent}
      remainingTimePercent={metrics.remainingTimePercent}
      recentRate={metrics.actualRatePercentPerHour}
      safeRate={metrics.safeRatePercentPerHour}
      rateMultiple={metrics.rateMultiple}
      recentWindowLabel={recentWindowLabel(metrics)}
      projectedExhaustionHours={metrics.projectedExhaustionHours}
      resetAt={metrics.resetAt}
    />
  )
}

function CursorForm({
  cursor,
  draft,
  setDraft,
  onSubmit,
  onCancel,
  isPending,
}: {
  cursor: CursorSubscription | null
  draft: CursorDraft
  setDraft: (draft: CursorDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  isPending: boolean
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_22px_60px_rgba(0,0,0,0.16)]">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 max-sm:px-4 max-sm:py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-hover text-text-muted">
            <Code2 className="size-[18px]" />
          </div>
          <div className="min-w-0">
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Cursor</div>
            <h2 className="text-[15px] font-semibold leading-5 tracking-tight">
              {cursor ? 'Edit subscription' : 'Add subscription'}
            </h2>
          </div>
        </div>
        {cursor && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel editing Cursor subscription"
            className="toolbar-button w-auto px-3"
          >
            <X className="size-3.5" />
            <span>Cancel</span>
          </button>
        )}
      </header>

      <form onSubmit={onSubmit} className="space-y-4 p-5 max-sm:p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(150px,0.8fr)_110px]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">Plan</span>
            <input
              value={draft.plan}
              onChange={event => setDraft({ ...draft, plan: event.target.value })}
              placeholder="Pro+"
              maxLength={80}
              className="min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">Monthly price</span>
            <input
              type="number"
              min="0"
              max="100000"
              step="0.01"
              value={draft.monthlyCost}
              onChange={event => setDraft({ ...draft, monthlyCost: event.target.value })}
              placeholder="60"
              className="min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">Currency</span>
            <select
              value={draft.currency}
              onChange={event => setDraft({ ...draft, currency: event.target.value })}
              className="min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
              <option>CAD</option>
              <option>AUD</option>
            </select>
          </label>
        </div>

        <label className="block max-w-[260px]">
          <span className="mb-1.5 block text-xs font-medium text-text-muted">Next renewal</span>
          <input
            type="date"
            value={draft.renewalDate}
            onChange={event => setDraft({ ...draft, renewalDate: event.target.value })}
            className="min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text focus:border-accent focus:outline-none"
          />
        </label>

        <div className="rounded-lg bg-bg px-3 py-2.5 text-xs leading-5 text-text-muted">
          Live usage reads the local Cursor Agent session on this server. The access token is not stored in the dashboard data.
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {!cursor && (
            <button
              type="button"
              onClick={onCancel}
              className="toolbar-button w-auto px-4"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            <span>{isPending ? 'Saving…' : cursor ? 'Save changes' : 'Add Cursor'}</span>
          </button>
        </div>
      </form>
    </section>
  )
}

export function CursorCard() {
  const { data, isLoading } = useCursorSubscription()
  const saveCursor = useSaveCursorSubscription()
  const refreshCursor = useRefreshCursorSubscription()
  const deleteCursor = useDeleteCursorSubscription()
  const cursor = data?.cursor ?? null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CursorDraft>({ ...emptyDraft })

  useEffect(() => {
    if (!editing) setDraft(toDraft(cursor))
  }, [cursor, editing])

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const monthlyCost = draft.monthlyCost.trim() ? Number(draft.monthlyCost) : null
    if (!draft.plan.trim()) {
      toast.error('Enter a Cursor plan name')
      return
    }
    if (monthlyCost !== null && (!Number.isFinite(monthlyCost) || monthlyCost < 0)) {
      toast.error('Enter a valid monthly price')
      return
    }

    const config: CursorSubscriptionConfig = {
      plan: draft.plan.trim(),
      monthlyCost,
      currency: draft.currency,
      renewalDate: draft.renewalDate || null,
    }
    try {
      await saveCursor.mutateAsync(config)
      setEditing(false)
      toast.success('Cursor subscription saved')
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleRefresh = async () => {
    try {
      await refreshCursor.mutateAsync()
    } catch (err) {
      toast.error('Cursor update failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Remove the Cursor subscription from this dashboard?')) return
    try {
      await deleteCursor.mutateAsync()
      setEditing(false)
      toast.success('Cursor subscription removed')
    } catch (err) {
      toast.error('Remove failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  if (isLoading) {
    return <div className="h-16 animate-pulse rounded-2xl border border-border bg-surface" aria-label="Loading Cursor subscription" />
  }

  if (!cursor && !editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text active:bg-surface-hover"
      >
        <Plus className="size-4 transition-transform group-hover:rotate-90" />
        <span>Add Cursor subscription</span>
      </button>
    )
  }

  if (editing) {
    return (
      <CursorForm
        cursor={cursor}
        draft={draft}
        setDraft={setDraft}
        onSubmit={handleSave}
        onCancel={() => setEditing(false)}
        isPending={saveCursor.isPending}
      />
    )
  }

  if (!cursor) return null

  const hasLiveUsage = Boolean(cursor.usage?.planUsage)
  const pace = cursor.usage?.pace
  const hasError = Boolean(cursor.lastError)

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_22px_60px_rgba(0,0,0,0.16)]">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 max-sm:px-4 max-sm:py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-hover text-text-muted">
            <Code2 className="size-[18px]" />
          </div>
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              <span>Cursor</span>
              <span className={'inline-flex items-center gap-1 normal-case tracking-normal ' + (hasLiveUsage ? 'text-good' : 'text-text-muted')}>
                <span className={'size-1.5 rounded-full ' + (hasLiveUsage ? 'bg-good' : 'bg-text-muted')} />
                {hasLiveUsage ? 'live' : 'manual'}
              </span>
            </div>
            <h2 className="truncate text-[15px] font-semibold leading-5 tracking-tight">{cursor.plan}</h2>
            {cursor.monthlyCost !== null && (
              <div className="truncate text-xs leading-4 text-text-muted">
                {formatMoney(cursor.monthlyCost, cursor.currency)}/mo
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit Cursor subscription"
          className="toolbar-button w-auto px-3"
        >
          <Pencil className="size-3.5" />
          <span>Edit</span>
        </button>
      </header>

      <div className="min-w-0 p-5 max-sm:p-4">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Usage limits</div>
        {hasLiveUsage ? (
          <div className="space-y-4">
            {pace?.cursorModels && <CursorPaceBlock label="Cursor models" metrics={pace.cursorModels} />}
            {pace?.otherModels && (
              <div className="border-t border-border pt-4">
                <CursorPaceBlock label="Other models" metrics={pace.otherModels} />
              </div>
            )}
            {!pace?.cursorModels && !pace?.otherModels && (
              <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm leading-6 text-text-muted">
                Cursor usage speed is being measured.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm leading-6 text-text-muted">
            Live usage is not available yet. The manual subscription details are still tracked.
          </div>
        )}
      </div>

      {hasError && (
        <div className="mx-5 mb-4 rounded-lg bg-bad/10 px-3 py-2 text-xs leading-5 text-bad break-words max-sm:mx-4">
          {cursor.lastError}
        </div>
      )}

      <footer className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-t border-border px-5 text-xs text-text-muted max-sm:px-4">
        <span>Checked {formatRelativeTime(cursor.lastCheckedAt)}</span>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshCursor.isPending}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 font-medium text-text hover:bg-surface-hover disabled:opacity-50"
          >
            <RefreshCw className={'size-3.5 ' + (refreshCursor.isPending ? 'animate-spin' : '')} />
            <span>Update</span>
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteCursor.isPending}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 font-medium text-bad hover:bg-bad/10 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
            <span>Remove</span>
          </button>
        </div>
      </footer>
    </article>
  )
}
