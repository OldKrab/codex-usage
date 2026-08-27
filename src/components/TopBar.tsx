import { useState } from 'react'
import { RefreshCw, ChartNoAxesCombined, Bell, BellOff, Activity } from 'lucide-react'
import { RefreshPicker } from './RefreshPicker'
import { BROWSER_NOTIFICATIONS_KEY, useRefreshAll } from '../lib/hooks'
import { navigate } from '../lib/router'
import { toast } from 'sonner'

export function TopBar({ accountCount }: { accountCount: number }) {
  const refreshAll = useRefreshAll()
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => (
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  ))
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(() => (
    typeof window !== 'undefined' && localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === 'true'
  ))

  const handleRefreshAll = async () => {
    try {
      const data = await refreshAll.mutateAsync()
      const results = data.results ?? []
      const ok = results.filter(r => r.ok).length
      const fail = results.filter(r => !r.ok).length
      fail > 0
        ? toast.error(`Refreshed: ${ok} ok, ${fail} failed`)
        : toast.success(`${ok} account${ok !== 1 ? 's' : ''} refreshed`)
    } catch {
      toast.error('Refresh failed')
    }
  }

  const handleBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      toast.error('Browser notifications are not supported')
      return
    }
    if (browserNotificationsEnabled) {
      localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, 'false')
      setBrowserNotificationsEnabled(false)
      toast.message('Browser notifications disabled')
      return
    }
    try {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
      setNotificationPermission(permission)
      if (permission !== 'granted') {
        localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, 'false')
        setBrowserNotificationsEnabled(false)
        toast.error('Browser notification permission was not granted')
        return
      }
      localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, 'true')
      setBrowserNotificationsEnabled(true)
      toast.success('Browser notifications enabled')
      new Notification('Usage alerts enabled', {
        body: 'Usage speed changes can now appear while this dashboard is open.',
        tag: 'codex-notifications-enabled',
      })
    } catch {
      toast.error('Could not enable browser notifications')
    }
  }

  const notificationsActive = browserNotificationsEnabled && notificationPermission === 'granted'

  return (
    <header className="mb-7 max-sm:mb-4">
      <div className="flex items-end justify-between gap-5 max-sm:block">
        <div className="max-sm:mb-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-text-muted">
            <Activity className="size-3.5 text-accent" />
            <span>AI capacity monitor</span>
          </div>
          <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.035em] max-sm:text-2xl">Usage</h1>
          <p className="mt-1 text-sm text-text-muted">
            {accountCount} active account{accountCount === 1 ? '' : 's'}, tracked against time to reset
          </p>
        </div>

        <nav className="flex items-center gap-2 max-sm:grid max-sm:w-full max-sm:min-w-0 max-sm:grid-cols-4" aria-label="Dashboard actions">
          <button onClick={() => navigate('/history')} className="toolbar-button" title="Usage history">
            <ChartNoAxesCombined className="size-4" />
            <span>History</span>
          </button>
          <button
            onClick={handleBrowserNotifications}
            className={`toolbar-button ${notificationsActive ? 'text-good' : ''}`}
            title={notificationsActive ? 'Disable browser notifications' : 'Enable browser notifications'}
          >
            {notificationsActive ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            <span>Alerts</span>
          </button>
          <RefreshPicker />
          <button
            onClick={handleRefreshAll}
            disabled={refreshAll.isPending}
            className="toolbar-button"
            title="Refresh all"
          >
            <RefreshCw className={`size-4 ${refreshAll.isPending ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </nav>
      </div>
    </header>
  )
}
