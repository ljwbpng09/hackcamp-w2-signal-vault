'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SnapshotEntry {
  timestamp: string
  probability: number
}

interface SnapshotFile {
  market: { tokenId: string; question: string }
  snapshots: SnapshotEntry[]
  lastUpdated: string
}

interface ChartPoint {
  time: string
  probability: number // 0–100
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function filterLastHour(entries: SnapshotEntry[]): SnapshotEntry[] {
  const cutoff = Date.now() - 60 * 60 * 1_000
  return entries.filter((e) => new Date(e.timestamp).getTime() > cutoff)
}

function toChartPoints(entries: SnapshotEntry[]): ChartPoint[] {
  return entries.map((e) => ({
    time: formatTime(e.timestamp),
    probability: parseFloat((e.probability * 100).toFixed(2)),
  }))
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-5 ring-1 ring-gray-800">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-100">{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<SnapshotFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/snapshot.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status} — snapshot.json not found. Is the worker running?`)
      const json = (await res.json()) as SnapshotFile
      setData(json)
      setError(null)
      setLastFetch(new Date())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
    const timer = setInterval(() => void fetchData(), 30_000)
    return () => clearInterval(timer)
  }, [fetchData])

  // ── Loading / error states ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 animate-pulse">Loading snapshot…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-red-400 text-center max-w-md">{error ?? 'No data'}</p>
        <button
          onClick={() => void fetchData()}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // ── Compute stats ──
  const hourEntries = filterLastHour(data.snapshots)
  const chartPoints = toChartPoints(hourEntries)

  const allProbs = data.snapshots.map((s) => s.probability * 100)
  const latest = allProbs.at(-1)
  const high = allProbs.length ? Math.max(...allProbs) : 0
  const low = allProbs.length ? Math.min(...allProbs) : 0

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Signal Vault</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Auto-refreshes every 30 s &nbsp;·&nbsp; Last fetched:{' '}
            {lastFetch?.toLocaleTimeString() ?? '—'}
          </p>
        </div>
        <button
          onClick={() => void fetchData()}
          className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </header>

      <div className="px-8 py-8 max-w-5xl mx-auto space-y-8">
        {/* Market info */}
        <div>
          <h2 className="text-lg font-semibold text-gray-200 mb-0.5">{data.market.question}</h2>
          <p className="text-xs text-gray-600 font-mono">token: {data.market.tokenId || '(not set)'}</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Current Prob"
            value={latest !== undefined ? `${latest.toFixed(2)}%` : '—'}
            sub="latest snapshot"
          />
          <StatCard
            label="1 h High"
            value={hourEntries.length ? `${Math.max(...hourEntries.map((e) => e.probability * 100)).toFixed(2)}%` : '—'}
          />
          <StatCard
            label="1 h Low"
            value={hourEntries.length ? `${Math.min(...hourEntries.map((e) => e.probability * 100)).toFixed(2)}%` : '—'}
          />
          <StatCard
            label="Total Snapshots"
            value={String(data.snapshots.length)}
            sub={`showing last ${hourEntries.length} (1 h)`}
          />
        </div>

        {/* Chart */}
        <div className="bg-gray-900 rounded-2xl p-6 ring-1 ring-gray-800">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-gray-200">Probability — Last 1 Hour</h3>
            {chartPoints.length === 0 && (
              <span className="text-xs text-yellow-500 bg-yellow-950 px-2.5 py-1 rounded-full">
                No data in the last hour
              </span>
            )}
          </div>

          {chartPoints.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartPoints} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[
                    (min: number) => Math.max(0, Math.floor(min - 2)),
                    (max: number) => Math.min(100, Math.ceil(max + 2)),
                  ]}
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  unit="%"
                  width={44}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111827',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(v) => [`${Number(v).toFixed(2)}%`, 'Probability']}
                />
                <ReferenceLine y={50} stroke="#374151" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="probability"
                  stroke="#818cf8"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: '#818cf8', stroke: '#1e1b4b' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600">
              Start the worker and wait for the first poll cycle.
            </div>
          )}
        </div>

        {/* All-time range footer */}
        {allProbs.length > 0 && (
          <p className="text-xs text-gray-700 text-center">
            All-time range: {low.toFixed(2)}% — {high.toFixed(2)}% &nbsp;·&nbsp;
            Last updated: {new Date(data.lastUpdated).toLocaleString()}
          </p>
        )}
      </div>
    </main>
  )
}
