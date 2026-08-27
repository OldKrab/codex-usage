import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useHistory, useAccounts } from '../lib/hooks'
import { navigate } from '../lib/router'

type Range = '24h' | '7d' | '30d'
type ChartPoint = {
  time: number
  Short: number | null
  Weekly: number | null
}
type DrainPoint = {
  time: number
  ShortDrain: number | null
  WeeklyDrain: number | null
  drainPeriod: string | null
}

type Snapshot = {
  timestamp: number
  accounts: Record<string, { windows: { label: string; usedPercent: number }[] }>
}

const drainBucketMsMap = {
  '24h': 5 * 60_000,
  '7d': 3_600_000,
  '30d': 6 * 3_600_000,
} as const

const formatDuration = (ms: number) => {
  const minutes = ms / 60_000
  if (minutes < 60) return `${minutes.toFixed(0)} min`
  const hours = minutes / 60
  return hours < 24 ? `${hours.toFixed(0)} h` : `${(hours / 24).toFixed(0)} d`
}

const getUsageValues = (snapshot: Snapshot, slot: string) => {
  const acct = snapshot.accounts[slot]
  const wShort = acct.windows.find(w => /^\d+h$/.test(w.label))
  const wLong = acct.windows.find(w => w !== wShort)
  return {
    shortUsed: wShort?.usedPercent ?? null,
    weeklyUsed: wLong?.usedPercent ?? null,
  }
}

const getAccountSnapshots = (snapshots: Snapshot[], slot: string) =>
  snapshots
    .filter(s => s.accounts[slot])
    .sort((a, b) => a.timestamp - b.timestamp)

const getWindowPoints = (snapshots: Snapshot[], slot: string): ChartPoint[] => {
  return getAccountSnapshots(snapshots, slot).map(s => {
    const { shortUsed, weeklyUsed } = getUsageValues(s, slot)
    return {
      time: s.timestamp,
      Short: shortUsed == null ? null : Math.max(0, 100 - shortUsed),
      Weekly: weeklyUsed == null ? null : Math.max(0, 100 - weeklyUsed),
    }
  })
}

const getDrainPoints = (snapshots: Snapshot[], slot: string, range: Range): DrainPoint[] => {
  const accountSnapshots = snapshots
    .filter(s => s.accounts[slot])
    .sort((a, b) => a.timestamp - b.timestamp)
  const bucketMs = drainBucketMsMap[range]
  const drainPeriod = formatDuration(bucketMs)
  const buckets = new Map<number, DrainPoint>()

  let previous: { time: number; shortUsed: number | null; weeklyUsed: number | null } | null = null

  for (const s of accountSnapshots) {
    const { shortUsed, weeklyUsed } = getUsageValues(s, slot)

    if (previous && s.timestamp > previous.time) {
      const bucketTime = Math.floor(s.timestamp / bucketMs) * bucketMs
      const bucket = buckets.get(bucketTime) ?? {
        time: bucketTime,
        ShortDrain: null,
        WeeklyDrain: null,
        drainPeriod,
      }
      if (shortUsed != null && previous.shortUsed != null) {
        bucket.ShortDrain = (bucket.ShortDrain ?? 0) + Math.max(0, shortUsed - previous.shortUsed)
      }
      if (weeklyUsed != null && previous.weeklyUsed != null) {
        bucket.WeeklyDrain = (bucket.WeeklyDrain ?? 0) + Math.max(0, weeklyUsed - previous.weeklyUsed)
      }
      buckets.set(bucketTime, bucket)
    }

    previous = { time: s.timestamp, shortUsed, weeklyUsed }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time)
}

export function History() {
  const [range, setRange] = useState<Range>('24h')
  const { data: historyData, isLoading } = useHistory(range)
  const { data: accountsData } = useAccounts()

  const accounts = accountsData?.accounts ?? []
  const snapshots = historyData?.snapshots ?? []

  const rangeMsMap = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 } as const
  const now = Date.now()
  const rangeStart = now - rangeMsMap[range]
  const allTimestamps = snapshots.map(s => s.timestamp)
  const timeDomain: [number, number] = [
    allTimestamps.length ? Math.min(rangeStart, Math.min(...allTimestamps)) : rangeStart,
    allTimestamps.length ? Math.max(now, Math.max(...allTimestamps)) : now,
  ]

  const accountChartData = accounts
    .filter(a => a.connected)
    .map(account => {
      const points = getWindowPoints(snapshots, account.slot)
      const drainPoints = getDrainPoints(snapshots, account.slot, range)
      return {
        email: account.email ?? account.slot,
        points,
        drainPoints,
        drainPeriod: formatDuration(drainBucketMsMap[range]),
      }
    })

  const dataSpanMs = timeDomain[1] - timeDomain[0]

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    // If actual data spans less than 24h, always show time
    if (dataSpanMs < 86_400_000) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
    if (range === '24h') {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6 max-sm:px-4">
      <header className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-surface transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-text-muted" />
          </button>
          <h1 className="text-xl font-semibold">Usage History</h1>
        </div>
        <div className="flex gap-1 bg-surface rounded-lg p-1">
          {(['24h', '7d', '30d'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                range === r
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="text-text-muted text-center py-12">Loading…</div>
      ) : accountChartData.length === 0 ? (
        <div className="text-text-muted text-center py-12">No history data yet</div>
      ) : (
        <div className="space-y-6">
          {accountChartData.map(({ email, points, drainPoints, drainPeriod }) => (
            <section key={email} className="bg-surface rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-4">{email}</h2>
              {points.length === 0 ? (
                <div className="text-text-muted text-sm py-4">
                  No data for this period
                </div>
              ) : (
                <div className="grid gap-5">
                  <div>
                    <h3 className="text-xs font-medium text-text-muted mb-2">Remaining limits</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={points}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
                        <XAxis
                          dataKey="time"
                          type="number"
                          domain={timeDomain}
                          tickFormatter={formatTime}
                          allowDuplicatedCategory={false}
                          stroke="#6b7a8d"
                          fontSize={11}
                        />
                        <YAxis
                          domain={[0, 100]}
                          stroke="#6b7a8d"
                          fontSize={11}
                          tickFormatter={v => `${v}%`}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#1a2130',
                            border: '1px solid #1e2a3a',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          labelFormatter={(label) => formatTime(label as number)}
                          formatter={(value) => [`${Number(value).toFixed(0)}%`]}
                        />
                        <Line
                          type="monotone"
                          dataKey="Short"
                          name="5h"
                          stroke="#22c55e"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="Weekly"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <h3 className="text-xs font-medium text-text-muted">Drain speed</h3>
                      <span className="text-[11px] text-text-muted">auto-scaled, % per {drainPeriod}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={drainPoints}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
                        <XAxis
                          dataKey="time"
                          type="number"
                          domain={timeDomain}
                          tickFormatter={formatTime}
                          allowDuplicatedCategory={false}
                          stroke="#6b7a8d"
                          fontSize={11}
                        />
                        <YAxis
                          domain={[0, 'auto']}
                          stroke="#6b7a8d"
                          fontSize={11}
                          tickFormatter={v => `${Number(v).toFixed(1)}%`}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#1a2130',
                            border: '1px solid #1e2a3a',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          labelFormatter={(label) => formatTime(label as number)}
                          formatter={(value, name, item) => {
                            const period = item.payload?.drainPeriod
                            return [`${Number(value).toFixed(2)}%${period ? ` / ${period}` : ''}`, name]
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="ShortDrain"
                          name="5h"
                          stroke="#86efac"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="WeeklyDrain"
                          name="Weekly"
                          stroke="#93c5fd"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
