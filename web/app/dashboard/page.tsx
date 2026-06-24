'use client'

/**
 * Signal Vault — Dashboard (multi-market)
 *
 * Reads snapshot.json which now carries a `markets` array.
 * Falls back gracefully to the legacy single-market format.
 *
 * Layout:
 *   Header → Market Tab row → Stat Cards → AI Track Record →
 *   Chart → [ Decision Timeline | On-chain Predictions ]
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
  AlertCircle,
  CheckCircle,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Target,
  TrendingDown,
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

interface MarketSnapshot {
  tokenId: string
  question: string
  snapshots: SnapshotEntry[]
  alerts: AlertRecord[]
}

/** New multi-market schema — normalised from both old and new formats. */
interface SnapshotFile {
  markets: MarketSnapshot[]
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

/** Convert raw fetch response to normalised SnapshotFile (handles legacy format). */
function normalise(raw: Record<string, unknown>): SnapshotFile {
  // New multi-market format
  if (Array.isArray(raw['markets'])) {
    return raw as unknown as SnapshotFile
  }
  // Legacy single-market format
  return {
    markets: [
      {
        tokenId: (raw['market'] as Record<string, string> | undefined)?.tokenId ?? '',
        question: (raw['market'] as Record<string, string> | undefined)?.question ?? 'Unknown',
        snapshots: (raw['snapshots'] as SnapshotEntry[]) ?? [],
        alerts: (raw['alerts'] as AlertRecord[]) ?? [],
      },
    ],
    lastUpdated: (raw['lastUpdated'] as string) ?? new Date().toISOString(),
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
  sub,
}: {
  icon: React.ReactNode
  value: string
  label: string
  sub?: string
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 text-slate-500 mb-3">
          {icon}
          <span className="text-xs uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-3xl font-bold text-white">{value}</p>
        {sub && <p className="text-sm text-slate-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function ActionCell({ alert }: { alert: AlertRecord | undefined }) {
  if (!alert) {
    return (
      <div className="flex items-center gap-1.5 text-slate-600">
        <Info className="w-3.5 h-3.5" />
        <span className="text-xs">record_only</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
      <span className="text-xs text-red-400 font-medium">
        {alert.direction === 'UP'
          ? <TrendingUp className="w-3 h-3 inline mr-0.5" />
          : <TrendingDown className="w-3 h-3 inline mr-0.5" />}
        {alert.urgency.toUpperCase()}
      </span>
      {alert.onChainId !== null && CONTRACT_ADDRESS && (
        <a
          href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}#events`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-500 hover:text-indigo-400 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}

function SettleIcon({ correct, settled }: { correct?: boolean; settled: boolean }) {
  if (!settled) return <Clock className="w-4 h-4 text-slate-500" />
  if (correct) return <CheckCircle className="w-4 h-4 text-emerald-500" />
  return <AlertCircle className="w-4 h-4 text-red-500" />
}

/** Short label for market tab (e.g. "France", "Argentina"). */
function marketLabel(question: string): string {
  // "Will X win …" → extract X
  const match = question.match(/Will (.+?) win/i)
  if (match?.[1]) return match[1].length > 14 ? match[1].slice(0, 12) + '…' : match[1]
  return question.slice(0, 14)
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-10 w-72 bg-slate-800" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-28 bg-slate-800 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 bg-slate-800" />)}
        </div>
        <Skeleton className="h-24 bg-slate-800" />
        <Skeleton className="h-80 bg-slate-800" />
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
  const [selectedIdx, setSelectedIdx] = useState(0)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/snapshot.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status} — is the worker running?`)
      const json = await res.json() as Record<string, unknown>
      setData(normalise(json))
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

  // Keep selectedIdx in bounds if markets count changes
  useEffect(() => {
    if (data && selectedIdx >= data.markets.length) setSelectedIdx(0)
  }, [data, selectedIdx])

  const copyAddr = async () => {
    if (!CONTRACT_ADDRESS) return
    await navigator.clipboard.writeText(CONTRACT_ADDRESS)
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }

  if (loading) return <LoadingSkeleton />

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 px-6">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-slate-400 text-center max-w-md">{error ?? 'No snapshot data.'}</p>
        <button
          onClick={() => void fetchData()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // ── Derived data for selected market ────────────────────────────────────────
  const market = data.markets[Math.min(selectedIdx, data.markets.length - 1)]!
  const { snapshots, alerts } = market
  const latest = snapshots.at(-1)
  const latestProb = latest ? (latest.probability * 100).toFixed(3) : '—'

  // Track record across ALL markets (global AI accuracy)
  const allAlerts = data.markets.flatMap((m) => m.alerts)
  const settledAll = allAlerts.filter((a) => a.settled && a.correct !== undefined)
  const correctAll = settledAll.filter((a) => a.correct === true)
  const accuracyAll = settledAll.length > 0
    ? ((correctAll.length / settledAll.length) * 100).toFixed(1)
    : null

  // Per-market track record
  const settledMkt = alerts.filter((a) => a.settled && a.correct !== undefined)
  const correctMkt = settledMkt.filter((a) => a.correct === true)
  const accuracyMkt = settledMkt.length > 0
    ? ((correctMkt.length / settledMkt.length) * 100).toFixed(1)
    : null

  const chartData = snapshots.slice(-60).map((s) => ({
    time: fmtTime(s.timestamp),
    prob: parseFloat((s.probability * 100).toFixed(3)),
  }))

  const alertTimeSet = new Set(alerts.map((a) => fmtTime(a.alertedAt)))

  const tableRows = snapshots
    .slice(-20)
    .reverse()
    .map((s, i, arr) => {
      const prev = arr[i + 1]
      const delta = prev
        ? parseFloat(((s.probability - prev.probability) * 100).toFixed(3))
        : 0
      const linkedAlert = alerts.find((a) => {
        const diff = Math.abs(new Date(a.alertedAt).getTime() - new Date(s.timestamp).getTime())
        return diff < 65_000
      })
      return { ...s, delta, linkedAlert }
    })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Zap className="w-6 h-6 text-indigo-500" />
              AI Blackbox
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Commit first. Score later. · 2026 FIFA World Cup
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Monitoring <span className="text-indigo-400 font-medium">{data.markets.length}</span>{' '}
              market{data.markets.length !== 1 ? 's' : ''}
              {accuracyAll !== null && (
                <span className="ml-2 text-emerald-500">
                  · Global AI accuracy: {accuracyAll}%
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {CONTRACT_ADDRESS ? (
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
                <span className="text-xs font-mono text-slate-400">{shortAddr(CONTRACT_ADDRESS)}</span>
                <button
                  onClick={() => void copyAddr()}
                  className="text-slate-600 hover:text-slate-300 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-600 hover:text-indigo-500 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {copied && <span className="text-xs text-emerald-500 ml-1">Copied!</span>}
              </div>
            ) : (
              <span className="text-xs text-slate-700">Set NEXT_PUBLIC_CONTRACT_ADDRESS</span>
            )}
            <button
              onClick={() => void fetchData()}
              className="text-xs text-slate-500 hover:text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 transition-colors"
            >
              ↻ {lastFetch?.toLocaleTimeString() ?? '—'}
            </button>
          </div>
        </header>

        {/* ── Market Tab Switcher ─────────────────────────────────────────── */}
        {data.markets.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {data.markets.map((m, i) => {
              const mAlerts = m.alerts ?? []
              const mSettled = mAlerts.filter((a) => a.settled && a.correct !== undefined)
              const mCorrect = mSettled.filter((a) => a.correct === true)
              const acc = mSettled.length > 0
                ? `${((mCorrect.length / mSettled.length) * 100).toFixed(0)}%`
                : null

              return (
                <button
                  key={m.tokenId}
                  onClick={() => setSelectedIdx(i)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
                    i === selectedIdx
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700',
                  )}
                >
                  {marketLabel(m.question)}
                  {acc !== null && (
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded-full',
                      i === selectedIdx ? 'bg-indigo-500/50 text-indigo-200' : 'bg-slate-800 text-slate-500',
                    )}>
                      {acc}
                    </span>
                  )}
                  <span className={cn(
                    'text-xs',
                    i === selectedIdx ? 'text-indigo-300' : 'text-slate-600',
                  )}>
                    {(m.snapshots ?? []).length}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* ── Stat Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            value={String(snapshots.length)}
            label="Readings"
            sub={`across ${data.markets.length} market${data.markets.length !== 1 ? 's' : ''}`}
          />
          <StatCard
            icon={<AlertCircle className="w-4 h-4 text-red-500" />}
            value={String(allAlerts.length)}
            label="Alerts Triggered"
            sub={`${settledAll.length} settled on-chain`}
          />
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            value={latest ? relativeTime(latest.timestamp) : '—'}
            label="Last Update"
            sub={latest ? fmtTime(latest.timestamp) : ''}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-indigo-500" />}
            value={`${latestProb}%`}
            label="Latest Price"
            sub={marketLabel(market.question)}
          />
        </div>

        {/* ── AI Track Record ─────────────────────────────────────────────── */}
        <Card className="bg-slate-900 border-indigo-900/40">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-5 h-5 text-indigo-500 shrink-0" />
                  <span className="text-sm font-semibold text-indigo-400 uppercase tracking-wider">
                    AI Track Record
                  </span>
                  <Badge
                    variant="outline"
                    className="border-indigo-800/60 text-indigo-400 text-xs px-1.5"
                  >
                    Verifiable on Sepolia
                  </Badge>
                </div>

                <p className="text-sm text-slate-500 mb-4 max-w-xl">
                  Every anomaly alert makes a directional prediction written on-chain{' '}
                  <strong className="text-slate-300">before</strong> price settlement —
                  accuracy is publicly auditable, no trust required.
                </p>

                <div className="flex items-center gap-8 flex-wrap">
                  {/* Global accuracy */}
                  <div>
                    <p className="text-xs text-slate-600 mb-1">All markets</p>
                    <p className="text-3xl font-bold text-white">
                      {accuracyAll !== null ? `${accuracyAll}%` : '—'}
                    </p>
                    <p className="text-sm text-slate-400 mt-1">
                      {correctAll.length} correct / {settledAll.length} settled
                      {allAlerts.length - settledAll.length > 0 && (
                        <span className="text-slate-500 ml-2">
                          · {allAlerts.length - settledAll.length} pending
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Per-market accuracy */}
                  {data.markets.length > 1 && (
                    <div>
                      <p className="text-xs text-slate-600 mb-1">{marketLabel(market.question)}</p>
                      <p className="text-3xl font-bold text-white">
                        {accuracyMkt !== null ? `${accuracyMkt}%` : '—'}
                      </p>
                      <p className="text-sm text-slate-400 mt-1">
                        {correctMkt.length} / {settledMkt.length} settled
                      </p>
                    </div>
                  )}

                  {settledAll.length > 0 && (
                    <div className="flex-1 max-w-xs">
                      <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 bg-indigo-500 rounded-full transition-all duration-700"
                          style={{ width: `${(correctAll.length / settledAll.length) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-600 mt-1">global accuracy</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent predictions mini-panel */}
              {alerts.length > 0 && (
                <div className="hidden lg:flex flex-col gap-1.5 min-w-[220px]">
                  <p className="text-xs text-slate-600 mb-0.5">Recent · {marketLabel(market.question)}</p>
                  {alerts
                    .slice(-4)
                    .reverse()
                    .map((a) => (
                      <div
                        key={a.localId}
                        className="flex items-center justify-between text-xs bg-slate-800/60 rounded-lg px-2.5 py-1.5"
                      >
                        <span className="text-slate-500">{fmtTime(a.alertedAt)}</span>
                        <span className="flex items-center gap-1 text-slate-300">
                          {a.direction === 'UP'
                            ? <TrendingUp className="w-3 h-3 text-indigo-400" />
                            : <TrendingDown className="w-3 h-3 text-slate-400" />}
                          {(a.probAtAlert * 100).toFixed(2)}%
                        </span>
                        <SettleIcon correct={a.correct} settled={a.settled} />
                      </div>
                    ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Chart ──────────────────────────────────────────────────────── */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold text-slate-200">
                Probability — Last {Math.min(60, chartData.length)} readings
              </CardTitle>
              {alertTimeSet.size > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed border-indigo-500/70" />
                  <span className="text-xs text-slate-500">alert</span>
                </div>
              )}
            </div>
            <CardDescription className="text-sm text-slate-500">
              {market.question}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#475569', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1e293b' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[
                      (min: number) => Math.max(0, parseFloat((min - 0.5).toFixed(1))),
                      (max: number) => Math.min(100, parseFloat((max + 0.5).toFixed(1))),
                    ]}
                    tick={{ fill: '#475569', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1e293b' }}
                    unit="%"
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(v) => [`${Number(v).toFixed(3)}%`, 'Probability']}
                  />
                  {chartData
                    .filter((d) => alertTimeSet.has(d.time))
                    .map((d) => (
                      <ReferenceLine
                        key={d.time}
                        x={d.time}
                        stroke="#6366f1"
                        strokeDasharray="4 4"
                        strokeOpacity={0.7}
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
              <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
                Start the worker and wait for the first poll cycle.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Bottom Row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Decision Timeline */}
          <Card className="bg-slate-900 border-slate-800 lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-slate-200">Decision Timeline</CardTitle>
              <CardDescription className="text-sm text-slate-500">
                Last 20 poll cycles · {marketLabel(market.question)} · alert rows highlighted
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="text-xs text-slate-600 w-16 pl-6">Time</TableHead>
                    <TableHead className="text-xs text-slate-600">Price</TableHead>
                    <TableHead className="text-xs text-slate-600">Δ pp</TableHead>
                    <TableHead className="text-xs text-slate-600">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-600 text-sm py-10">
                        No data yet — start the worker
                      </TableCell>
                    </TableRow>
                  ) : (
                    tableRows.map((row, i) => (
                      <TableRow
                        key={i}
                        className={cn(
                          'border-slate-800/60 text-xs transition-colors',
                          row.linkedAlert
                            ? 'bg-red-950/20 hover:bg-red-950/30'
                            : 'hover:bg-slate-800/40',
                        )}
                      >
                        <TableCell className="text-slate-500 font-mono pl-6">
                          {fmtTime(row.timestamp)}
                        </TableCell>
                        <TableCell className="text-slate-200 font-mono">
                          {(row.probability * 100).toFixed(3)}%
                        </TableCell>
                        <TableCell
                          className={cn(
                            'font-mono',
                            row.delta > 0.001 ? 'text-indigo-400'
                              : row.delta < -0.001 ? 'text-slate-400'
                                : 'text-slate-600',
                          )}
                        >
                          {row.delta > 0 ? '+' : ''}{row.delta.toFixed(3)}
                        </TableCell>
                        <TableCell>
                          <ActionCell alert={row.linkedAlert} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* On-chain Predictions */}
          <Card className="bg-slate-900 border-slate-800 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                On-chain Predictions
                {alerts.length > 0 && (
                  <Badge variant="outline" className="text-xs text-indigo-400 border-indigo-800/60">
                    {alerts.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                SignalVault.sol · {marketLabel(market.question)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-6 pt-0">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Info className="w-8 h-8 text-slate-700" />
                  <p className="text-sm text-slate-600 text-center">
                    No predictions yet — waiting for an anomaly
                  </p>
                </div>
              ) : (
                alerts
                  .slice(-10)
                  .reverse()
                  .map((a) => (
                    <div
                      key={a.localId}
                      className="bg-slate-800/50 rounded-xl p-4 space-y-2.5 border border-slate-700/30"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <SettleIcon correct={a.correct} settled={a.settled} />
                          <div className="flex items-center gap-1 text-slate-300">
                            {a.direction === 'UP'
                              ? <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                              : <TrendingDown className="w-3.5 h-3.5 text-slate-400" />}
                            <span className="text-xs font-medium">{a.direction}</span>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs px-1.5 py-0',
                              a.urgency === 'high'
                                ? 'border-red-800/60 text-red-400'
                                : 'border-slate-700 text-slate-500',
                            )}
                          >
                            {a.urgency}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-600">{fmtTime(a.alertedAt)}</span>
                      </div>

                      <p className="text-sm text-slate-400 leading-relaxed line-clamp-2">{a.reason}</p>

                      <div className="flex items-center gap-3 text-xs text-slate-600">
                        <span>
                          at{' '}
                          <span className="text-slate-300 font-mono">
                            {(a.probAtAlert * 100).toFixed(2)}%
                          </span>
                        </span>
                        {a.probAtSettle !== undefined && (
                          <span>
                            →{' '}
                            <span className={cn('font-mono', a.correct ? 'text-emerald-400' : 'text-red-400')}>
                              {(a.probAtSettle * 100).toFixed(2)}%
                            </span>
                          </span>
                        )}
                        {a.onChainId !== null && CONTRACT_ADDRESS && (
                          <a
                            href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}#events`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto flex items-center gap-1 text-indigo-500 hover:text-indigo-400 transition-colors"
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
        <p className="text-xs text-slate-700 text-center pb-4">
          Auto-refreshes every 30 s · {snapshots.length} readings for {marketLabel(market.question)} ·{' '}
          {data.lastUpdated ? `Last updated ${relativeTime(data.lastUpdated)}` : ''}
        </p>

      </div>
    </div>
  )
}
