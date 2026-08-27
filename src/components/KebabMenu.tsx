import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreVertical, LogOut, Trash2 } from 'lucide-react'
import type { Account } from '../types/api'
import { useLogoutSlot, useDeleteSlot } from '../lib/hooks'
import { toast } from 'sonner'

export function KebabMenu({ account }: { account: Account }) {
  const logoutSlot = useLogoutSlot()
  const deleteSlot = useDeleteSlot()

  const handleLogout = async () => {
    try {
      await logoutSlot.mutateAsync(account.slot)
      toast.success('Logged out')
    } catch (err) {
      toast.error(`Logout failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteSlot.mutateAsync(account.slot)
      toast.success('Slot deleted')
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="grid size-10 place-items-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text active:bg-white/[0.08] transition-colors max-sm:size-11"
          aria-label="More actions"
        >
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bg-surface-hover rounded-lg p-1 min-w-[140px] shadow-xl shadow-black/40 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
          sideOffset={4}
          align="end"
        >
          {account.connected && (
            <DropdownMenu.Item
              onSelect={handleLogout}
              className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-bad rounded-md cursor-pointer outline-none hover:bg-white/[0.06] focus:bg-white/[0.06]"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </DropdownMenu.Item>
          )}
          {!account.connected && (
            <DropdownMenu.Item
              onSelect={handleDelete}
              className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-bad rounded-md cursor-pointer outline-none hover:bg-white/[0.06] focus:bg-white/[0.06]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete slot
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
