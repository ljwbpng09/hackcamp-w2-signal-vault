'use client'

/**
 * Signal Vault — Dashboard
 *
 * Client component: auto-refreshes every 30 s via fetch('/snapshot.json').
 * All interactive elements (copy, chart, table) live here.
 *
 * Env (add to .env.local or Vercel):
 *   NEXT_PUBLIC_CONTRACT_ADDRESS=0x…
 */

import { useCallback, useEffect, useState } from 'react'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  Activity,
  Clock,
  Copy,
  ExternalLink,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SnapshotEntry {
  timestamp: string
  probability: number
}

interface AlertRecord {
  localId: string
  onChainId: number | null
  market: string
  direction: 'UP' | 'DOWN'
  probAtAlert: number
  targetProbPct: number | null
  urgency: 'low' | 'medium' | 'high'
  reason: string
  alertedAt: string
  settleAfter: string
  settled: boolean
  probAtSettle?: number
  correct?: boolean
  txHashSettle?: string
  settledAt?: string
}

interface SnapshotFile {
  market: { tokenId: string; question: string }
  snapshots: SnapshotEntry[]
  alerts: AlertRecord[]
  lastUpdated: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? ''
const ETHERSCAN_BASE = 'https://sepolia.etherscan.io'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function urgencyBadgeClass(urgency: string) {
  if (urgency === 'high') return 'bg-red-900/50 text-red-300 border-red-800/60 hover:bg-red-900/50'
  if (urgency === 'medium') return 'bg-yellow-900/50 text-yellow-300 border-yellow-800/60 hover:bg-yellow-900/50'
  return 'bg-blue-900/50 text-blue-300 border-blue-800/60 hover:bg-blue-900/50'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card className="bg-gray-900/80 border-gray-800">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-gray-500 mb-2">
          {icon}
          <span className="text-xs uppercase tracking-wider font-medium">{label}</span>
        </div>
        <p className="text-2xl font-bold text-gray-100">{value}</p>
        {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-[#080810] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-10 w-72 bg-gray-800" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 bg-gray-800" />
          ))}
        </div>
        <Skeleton className="h-24 bg-gray-800" />
        <Skeleton className="h-80 bg-gray-800" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <Skeleton className="h-64 bg-gray-800 lg:col-span-3" />
          <Skeleton className="h-64 bg-gray-800 lg:col-span-2" />
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<SnapshotFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/snapshot.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status} — is the worker running?`)
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

  const copyAddr = async () => {
    if (!CONTRACT_ADDRESS) return
    await navigator.clipboard.writeText(CONTRACT_ADDRESS)
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }

  if (loading) return <LoadingSkeleton />

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#080810] flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-red-400 text-sm text-center max-w-md">{error ?? 'No snapshot data.'}</p>
        <button
          onClick={() => void fetchData()}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // ── Derived data ────────────────────────────────────────────────────────────
  const snapshots = data.snapshots
  const alerts: AlertRecord[] = data.alerts ?? []
  const latest = snapshots.at(-1)
  const latestProb = latest ? (latest.probability * 100).toFixed(3) : '—'

  const settledAlerts = alerts.filter((a) => a.settled && a.correct !== undefined)
  const correctAlerts = settledAlerts.filter((a) => a.correct === true)
  const accuracy =
    settledAlerts.length > 0
      ? ((correctAlerts.length / settledAlerts.length) * 100).toFixed(1)
      : null

  // Chart: last 60 readings
  const chartData = snapshots.slice(-60).map((s) => ({
    time: fmtTime(s.timestamp),
    prob: parseFloat((s.probability * 100).toFixed(3)),
    ts: s.timestamp,
  }))

  // Chart: alert x-positions for reference lines
  const alertTimeSet = new Set(alerts.map((a) => fmtTime(a.alertedAt)))

  // Table: last 20 rows newest-first, annotated with nearest alert
  const tableRows = snapshots
    .slice(-20)
    .reverse()
    .map((s, i, arr) => {
      const prev = arr[i + 1]
      const delta = prev
        ? parseFloat(((s.probability - prev.probability) * 100).toFixed(3))
        : 0
      const linkedAlert = alerts.find((a) => {
        const diff = Math.abs(
          new Date(a.alertedAt).getTime() - new Date(s.timestamp).getTime(),
        )
        return diff < 65_000
      })
      return { ...s, delta, linkedAlert }
    })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080810] text-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Zap className="w-6 h-6 text-indigo-400" />
              Signal Vault
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              2026 FIFA World Cup · Polymarket Signal Specialist
            </p>
            <p className="text-xs text-gray-600 mt-1 max-w-lg truncate">
              {data.market.question}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {CONTRACT_ADDRESS ? (
              <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-gray-400 font-mono">
                  {shortAddr(CONTRACT_ADDRESS)}
                </span>
                <button
                  onClick={() => void copyAddr()}
                  title="Copy address"
                  className="text-gray-600 hover:text-gray-300 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Etherscan"
                  className="text-gray-600 hover:text-indigo-400 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {copied && (
                  <span className="text-xs text-green-400 ml-1">Copied!</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-gray-700">
                Set NEXT_PUBLIC_CONTRACT_ADDRESS
              </span>
            )}
            <button
              onClick={() => void fetchData()}
              className="text-xs text-gray-500 hover:text-gray-300 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 transition-colors"
            >
              ↻ {lastFetch?.toLocaleTimeString() ?? '—'}
            </button>
          </div>
        </header>

        {/* ── Stat cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Activity className="w-4 h-4 text-gray-400" />}
            label="Total Decisions"
            value={String(snapshots.length)}
            sub="poll cycles recorded"
          />
          <StatCard
            icon={<Zap className="w-4 h-4 text-yellow-400" />}
            label="Alerts Triggered"
            value={String(alerts.length)}
            sub={`${settledAlerts.length} settled on-chain`}
          />
          <StatCard
            icon={<Clock className="w-4 h-4 text-blue-400" />}
            label="Last Update"
            value={latest ? relativeTime(latest.timestamp) : '—'}
            sub={latest ? fmtTime(latest.timestamp) : ''}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-indigo-400" />}
            label="Latest Price"
            value={`${latestProb}%`}
            sub={`token: ${data.market.tokenId.slice(0, 8)}…`}
          />
        </div>

        {/* ── Differentiator: AI Track Record ────────────────────────────── */}
        <Card className="bg-gradient-to-r from-indigo-950/60 via-gray-900 to-gray-900 border-indigo-900/50">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-5 h-5 text-indigo-400 shrink-0" />
                  <span className="text-sm font-semibold text-indigo-300 uppercase tracking-wider">
                    AI Track Record
                  </span>
                  <Badge
                    variant="outline"
                    className="border-indigo-700/60 text-indigo-400 text-xs px-1.5"
                  >
                    Verifiable on Sepolia
                  </Badge>
                </div>

                <p className="text-xs text-gray-500 mb-4 max-w-xl">
                  Every anomaly alert makes a directional prediction written on-chain{' '}
                  <strong className="text-gray-400">before</strong> price settlement.
                  Accuracy is publicly auditable — no trust required.
                </p>

                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-4xl font-bold text-white">
                      {accuracy !== null ? `${accuracy}%` : '—'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {correctAlerts.length} correct / {settledAlerts.length} settled
                      {alerts.length - settledAlerts.length > 0 && (
                        <span className="text-yellow-600 ml-2">
                          · {alerts.length - settledAlerts.length} pending
                        </span>
                      )}
                    </p>
                  </div>

                  {settledAlerts.length > 0 && (
                    <div className="flex-1 max-w-xs">
                      <div className="bg-gray-800 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-2.5 bg-indigo-500 rounded-full transition-all duration-700"
                          style={{
                            width: `${(correctAlerts.length / settledAlerts.length) * 100}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-gray-600 mt-1">accuracy progress</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Mini recent predictions */}
              {alerts.length > 0 && (
                <div className="hidden lg:flex flex-col gap-1.5 min-w-[220px]">
                  <p className="text-xs text-gray-600 mb-0.5">Recent predictions</p>
                  {alerts
                    .slice(-4)
                    .reverse()
                    .map((a) => (
                      <div
                        key={a.localId}
                        className="flex items-center justify-between text-xs bg-gray-900/80 rounded-lg px-2.5 py-1.5"
                      >
                        <span className="text-gray-500">{fmtTime(a.alertedAt)}</span>
                        <span
                          className={cn(
                            'font-mono font-medium',
                            a.direction === 'UP' ? 'text-green-400' : 'text-red-400',
                          )}
                        >
                          {a.direction === 'UP' ? '▲' : '▼'}{' '}
                          {(a.probAtAlert * 100).toFixed(2)}%
                        </span>
                        <span>
                          {a.settled ? (
                            <span
                              className={
                                a.correct ? 'text-green-400' : 'text-red-400'
                              }
                            >
                              {a.correct ? '✅' : '❌'}
                            </span>
                          ) : (
                            <span className="text-yellow-600">⏳</span>
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Chart ──────────────────────────────────────────────────────── */}
        <Card className="bg-gray-900/80 border-gray-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-200">
                Probability — Last {Math.min(60, chartData.length)} readings
              </CardTitle>
              {alertTimeSet.size > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="inline-block w-3 h-0.5 border-t border-dashed border-indigo-500" />
                  alert markers
                </div>
              )}
            </div>
            <CardDescription className="text-xs text-gray-500">
              {data.market.question}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={chartData}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#4b5563', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1f2937' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[
                      (min: number) => Math.max(0, parseFloat((min - 0.5).toFixed(1))),
                      (max: number) => Math.min(100, parseFloat((max + 0.5).toFixed(1))),
                    ]}
                    tick={{ fill: '#4b5563', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1f2937' }}
                    unit="%"
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f0f1a',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={(v) => [`${Number(v).toFixed(3)}%`, 'Probability']}
                  />
                  {/* Alert markers */}
                  {chartData
                    .filter((d) => alertTimeSet.has(d.time))
                    .map((d) => (
                      <ReferenceLine
                        key={d.time}
                        x={d.time}
                        stroke="#6366f1"
                        strokeDasharray="4 4"
                        strokeOpacity={0.8}
                      />
                    ))}
                  <Line
                    type="monotone"
                    dataKey="prob"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#6366f1', stroke: '#1e1b4b', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
                Start the worker and wait for the first poll cycle.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Bottom row: Timeline + On-chain ────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Decision Timeline */}
          <Card className="bg-gray-900/80 border-gray-800 lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-gray-200">Decision Timeline</CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Last 20 poll cycles · alert rows highlighted
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-xs text-gray-600 w-16 pl-4">Time</TableHead>
                    <TableHead className="text-xs text-gray-600">Price</TableHead>
                    <TableHead className="text-xs text-gray-600">Δ pp</TableHead>
                    <TableHead className="text-xs text-gray-600">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-gray-600 text-xs py-10"
                      >
                        No data yet — start the worker
                      </TableCell>
                    </TableRow>
                  ) : (
                    tableRows.map((row, i) => (
                      <TableRow
                        key={i}
                        className={cn(
                          'border-gray-800/60 text-xs transition-colors',
                          row.linkedAlert
                            ? 'bg-indigo-950/40 hover:bg-indigo-950/60'
                            : 'hover:bg-gray-800/40',
                        )}
                      >
                        <TableCell className="text-gray-500 font-mono pl-4">
                          {fmtTime(row.timestamp)}
                        </TableCell>
                        <TableCell className="text-gray-200 font-mono">
                          {(row.probability * 100).toFixed(3)}%
                        </TableCell>
                        <TableCell
                          className={cn(
                            'font-mono',
                            row.delta > 0.001
                              ? 'text-green-400'
                              : row.delta < -0.001
                                ? 'text-red-400'
                                : 'text-gray-600',
                          )}
                        >
                          {row.delta > 0 ? '+' : ''}
                          {row.delta.toFixed(3)}
                        </TableCell>
                        <TableCell>
                          {row.linkedAlert ? (
                            <div className="flex items-center gap-1.5">
                              <Badge
                                className={cn(
                                  'text-xs px-1.5 py-0 border',
                                  urgencyBadgeClass(row.linkedAlert.urgency),
                                )}
                              >
                                {row.linkedAlert.direction === 'UP' ? '▲' : '▼'}{' '}
                                {row.linkedAlert.urgency.toUpperCase()}
                              </Badge>
                              {row.linkedAlert.onChainId !== null && CONTRACT_ADDRESS && (
                                <a
                                  href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}#events`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-500 hover:text-indigo-300 transition-colors"
                                  title={`On-chain prediction #${row.linkedAlert.onChainId}`}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-700">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* On-chain Predictions */}
          <Card className="bg-gray-900/80 border-gray-800 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-gray-200 flex items-center gap-2">
                On-chain Predictions
                {alerts.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs text-indigo-400 border-indigo-800/60"
                  >
                    {alerts.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                SignalVault.sol · Sepolia testnet
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 px-4 pb-4">
              {alerts.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-8">
                  No predictions yet — waiting for an anomaly
                </p>
              ) : (
                alerts
                  .slice(-10)
                  .reverse()
                  .map((a) => (
                    <div
                      key={a.localId}
                      className="bg-gray-800/50 rounded-xl p-3 space-y-2 border border-gray-700/30"
                    >
                      {/* Top row: badges + time */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            className={cn(
                              'text-xs px-1.5 py-0 border',
                              a.direction === 'UP'
                                ? 'bg-green-900/50 text-green-300 border-green-800/60 hover:bg-green-900/50'
                                : 'bg-red-900/50 text-red-300 border-red-800/60 hover:bg-red-900/50',
                            )}
                          >
                            {a.direction === 'UP' ? '▲' : '▼'} {a.direction}
                          </Badge>
                          {a.settled ? (
                            <Badge
                              className={cn(
                                'text-xs px-1.5 py-0 border',
                                a.correct
                                  ? 'bg-green-900/50 text-green-300 border-green-800/60 hover:bg-green-900/50'
                                  : 'bg-red-900/50 text-red-300 border-red-800/60 hover:bg-red-900/50',
                              )}
                            >
                              {a.correct ? '✅ CORRECT' : '❌ WRONG'}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs text-yellow-500 border-yellow-800/60 px-1.5 py-0"
                            >
                              ⏳ PENDING
                            </Badge>
                          )}
                          <Badge
                            className={cn(
                              'text-xs px-1.5 py-0 border',
                              urgencyBadgeClass(a.urgency),
                            )}
                          >
                            {a.urgency}
                          </Badge>
                        </div>
                        <span className="text-xs text-gray-600">{fmtTime(a.alertedAt)}</span>
                      </div>

                      {/* Reason */}
                      <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">
                        {a.reason}
                      </p>

                      {/* Price row */}
                      <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span>
                          at{' '}
                          <span className="text-gray-300 font-mono">
                            {(a.probAtAlert * 100).toFixed(2)}%
                          </span>
                        </span>
                        {a.probAtSettle !== undefined && (
                          <span>
                            → settled{' '}
                            <span
                              className={cn(
                                'font-mono',
                                a.correct ? 'text-green-400' : 'text-red-400',
                              )}
                            >
                              {(a.probAtSettle * 100).toFixed(2)}%
                            </span>
                          </span>
                        )}
                        {a.onChainId !== null && CONTRACT_ADDRESS && (
                          <a
                            href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}#events`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto flex items-center gap-1 text-indigo-500 hover:text-indigo-300 transition-colors"
                          >
                            #{a.onChainId}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <p className="text-xs text-gray-700 text-center pb-4">
          Auto-refreshes every 30 s · {snapshots.length} snapshots ·{' '}
          {data.lastUpdated ? `Last updated ${relativeTime(data.lastUpdated)}` : ''}
        </p>

      </div>
    </div>
  )
}
