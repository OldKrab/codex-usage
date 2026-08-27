import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Timer, Check, ChevronDown } from 'lucide-react'
import { useSettings, useUpdateSettings } from '../lib/hooks'

const HOSTED_MODE = import.meta.env.VITE_HOSTED_MODE === 'netlify'

const LIVE_INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
] as const

const BG_INTERVALS = [
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
] as const

export function RefreshPicker() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const live = settings?.liveInterval ?? 30
  const bg = settings?.backgroundInterval ?? 300
  const liveLabel = LIVE_INTERVALS.find(i => i.value === live)?.label ?? `${live}s`

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button aria-label={`Live refresh: ${liveLabel}`} className="toolbar-button">
          <Timer className="w-3.5 h-3.5" />
          <span><span className="max-sm:hidden">Live </span>{liveLabel}</span>
          <ChevronDown className="size-3 max-sm:hidden" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[180px] rounded-xl border border-border bg-surface-hover p-1 shadow-xl shadow-black/40 animate-in fade-in slide-in-from-top-1 duration-150"
          sideOffset={4}
          align="end"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-[11px] font-medium text-text-muted/60 uppercase tracking-wider">
            Live refresh
          </DropdownMenu.Label>
          {LIVE_INTERVALS.map(({ label, value }) => (
            <DropdownMenu.Item
              key={`live-${value}`}
              onSelect={() => updateSettings.mutate({ liveInterval: value })}
              className="flex min-h-11 items-center justify-between px-3 py-2 text-sm rounded-md cursor-pointer outline-none hover:bg-white/[0.06] focus:bg-white/[0.06]"
            >
              <span>{label}</span>
              {live === value && <Check className="w-3.5 h-3.5 text-accent" />}
            </DropdownMenu.Item>
          ))}
          {!HOSTED_MODE && <>
            <DropdownMenu.Separator className="h-px bg-white/[0.06] my-1" />
            <DropdownMenu.Label className="px-3 py-1.5 text-[11px] font-medium text-text-muted/60 uppercase tracking-wider">
              Background
            </DropdownMenu.Label>
            {BG_INTERVALS.map(({ label, value }) => (
              <DropdownMenu.Item
                key={`bg-${value}`}
                onSelect={() => updateSettings.mutate({ backgroundInterval: value })}
                className="flex min-h-11 items-center justify-between px-3 py-2 text-sm rounded-md cursor-pointer outline-none hover:bg-white/[0.06] focus:bg-white/[0.06]"
              >
                <span>{label}</span>
                {bg === value && <Check className="w-3.5 h-3.5 text-accent" />}
              </DropdownMenu.Item>
            ))}
          </>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
