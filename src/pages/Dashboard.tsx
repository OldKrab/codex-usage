import { useAccounts, useBurnRateNotifications, useLiveRefresh } from '../lib/hooks'
import { TopBar } from '../components/TopBar'
import { AccountCard } from '../components/AccountCard'
import { EmptyCard } from '../components/EmptyCard'
import { AddCard } from '../components/AddCard'
import { CursorCard } from '../components/CursorCard'

const HOSTED_MODE = import.meta.env.VITE_HOSTED_MODE === 'netlify'

export function Dashboard() {
  const { data, isLoading } = useAccounts()
  useLiveRefresh()
  const accounts = data?.accounts ?? []
  const connectedAccounts = accounts.filter(account => account.connected)
  useBurnRateNotifications(accounts)

  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-[1180px] px-6 py-7 max-sm:px-3 max-sm:py-4">
        <TopBar accountCount={connectedAccounts.length} />

        {isLoading ? (
          <div className="space-y-5" aria-label="Loading accounts">
            {[0, 1].map(item => (
              <div key={item} className="h-[390px] animate-pulse rounded-2xl border border-border bg-surface max-sm:h-[560px]" />
            ))}
          </div>
        ) : (
          <div className="space-y-5 max-sm:space-y-3">
            {accounts.map(account =>
              account.connected
                ? <AccountCard key={account.slot} account={account} />
                : <EmptyCard key={account.slot} account={account} />
            )}
            {!HOSTED_MODE && <CursorCard />}
            <AddCard />
          </div>
        )}
      </div>
    </main>
  )
}
