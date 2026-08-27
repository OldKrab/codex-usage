import { Plus } from 'lucide-react'
import { useCreateSlot } from '../lib/hooks'

export function AddCard() {
  const createSlot = useCreateSlot()
  return (
    <button
      onClick={() => createSlot.mutate()}
      disabled={createSlot.isPending}
      className="group flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text active:bg-surface-hover disabled:opacity-50"
    >
      <Plus className="size-4 transition-transform group-hover:rotate-90" />
      <span>Add Codex account</span>
    </button>
  )
}
