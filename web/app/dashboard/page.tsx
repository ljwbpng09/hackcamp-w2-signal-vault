'use client'

/**
 * Signal Vault — Dashboard v2
 *
 * v2 design rules applied:
 *   [v2-1] Colors: indigo-500 (primary) + red-500/emerald-500 (alert states) + slate-950 bg only
 *   [v2-2] Spacing: all Card p-6, grids gap-4, max-w-7xl mx-auto
 *   [v2-3] Font sizes: text-2xl (page title) / text-lg (card title) / text-sm (body) / text-xs (label)
 *   [v2-4] Stat numbers: text-3xl font-bold + text-sm text-slate-400 label below
 *   [v2-5] Status: AlertCircle (red-500) / Info (slate-500) / CheckCircle (emerald-500) — no emoji
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
  AlertCircle,    // [v2-5] trigger_alert / wrong
  CheckCircle,    // [v2-5] correct / pay_for_service
  Clock,
  Copy,
  ExternalLink,
  Info,           // [v2-5] record_only / neutral
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

// ─── Sub-components ───────────────────────────────────────────────────────────

// [v2-4] Stat card: text-3xl number + text-sm text-slate-400 label below
// [v2-1] card bg: slate-900, border: slate-800
// [v2-2] padding: p-6
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
    <Card className="bg-slate-900 border-slate-800"> {/* [v2-1] */}
      <CardContent className="p-6"> {/* [v2-2] */}
        <div className="flex items-center gap-2 text-slate-500 mb-3">
          {icon}
          <span className="text-xs uppercase tracking-wider">{label}</span> {/* [v2-3] text-xs label */}
        </div>
        <p className="text-3xl font-bold text-white">{value}</p> {/* [v2-4] */}
        {sub && <p className="text-sm text-slate-400 mt-1">{sub}</p>} {/* [v2-4] text-sm slate-400 */}
      </CardContent>
    </Card>
  )
}

// [v2-5] Status icon + label for action column
function ActionCell({ alert }: { alert: AlertRecord | undefined }) {
  if (!alert) {
    return (
      <div className="flex items-center gap-1.5 text-slate-600"> {/* [v2-5] Info for record_only */}
        <Info className="w-3.5 h-3.5" />
        <span className="text-xs">record_only</span> {/* [v2-3] text-xs */}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /> {/* [v2-5] AlertCircle red-500 */}
      <span className="text-xs text-red-400 font-medium"> {/* [v2-3] text-xs */}
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
          className="text-indigo-500 hover:text-indigo-400 transition-colors" /* [v2-1] indigo-500 */
          title={`On-chain #${alert.onChainId}`}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}

// [v2-5] Settlement result icon
function SettleIcon({ correct, settled }: { correct?: boolean; settled: boolean }) {
  if (!settled) {
    return <Clock className="w-4 h-4 text-slate-500" /> // [v2-5] pending
  }
  if (correct) {
    return <CheckCircle className="w-4 h-4 text-emerald-500" /> // [v2-5] correct
  }
  return <AlertCircle className="w-4 h-4 text-red-500" /> // [v2-5] wrong
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-950 p-6"> {/* [v2-1] slate-950 */}
      <div className="max-w-7xl mx-auto space-y-6"> {/* [v2-2] */}
        <Skeleton className="h-10 w-72 bg-slate-800" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"> {/* [v2-2] gap-4 */}
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 bg-slate-800" />
          ))}
        </div>
        <Skeleton className="h-24 bg-slate-800" />
        <Skeleton className="h-80 bg-slate-800" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4"> {/* [v2-2] gap-4 */}
          <Skeleton className="h-64 bg-slate-800 lg:col-span-3" />
          <Skeleton className="h-64 bg-slate-800 lg:col-span-2" />
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
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 px-6"> {/* [v2-1] */}
        <AlertCircle className="w-8 h-8 text-red-500" /> {/* [v2-5] */}
        <p className="text-sm text-slate-400 text-center max-w-md">{error ?? 'No snapshot data.'}</p> {/* [v2-3] text-sm */}
        <button
          onClick={() => void fetchData()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-300 transition-colors" /* [v2-1] slate */
        >
          Retry
        </button>
      </div>
    )
  }

  // ── Derived data ──────────────────────────────────────────────────────────
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
        const diff = Math.abs(
          new Date(a.alertedAt).getTime() - new Date(s.timestamp).getTime(),
        )
        return diff < 65_000
      })
      return { ...s, delta, linkedAlert }
    })

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    // [v2-1] slate-950 background, single color palette
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {/* [v2-2] max-w-7xl mx-auto */}
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            {/* [v2-3] text-2xl page title */}
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Zap className="w-6 h-6 text-indigo-500" /> {/* [v2-1] indigo-500 */}
              Signal Vault
            </h1>
            <p className="text-sm text-slate-400 mt-0.5"> {/* [v2-3] text-sm */}
              2026 FIFA World Cup · Polymarket Signal Specialist
            </p>
            <p className="text-xs text-slate-600 mt-1 max-w-lg truncate"> {/* [v2-3] text-xs */}
              {data.market.question}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {CONTRACT_ADDRESS ? (
              // [v2-1] slate-900 bg, slate-800 border
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
                <span className="text-xs font-mono text-slate-400">{shortAddr(CONTRACT_ADDRESS)}</span> {/* [v2-3] text-xs */}
                <button
                  onClick={() => void copyAddr()}
                  title="Copy address"
                  className="text-slate-600 hover:text-slate-300 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Etherscan"
                  className="text-slate-600 hover:text-indigo-500 transition-colors" /* [v2-1] indigo-500 hover */
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {copied && (
                  <span className="text-xs text-emerald-500 ml-1">Copied!</span> /* [v2-1] emerald for success */
                )}
              </div>
            ) : (
              <span className="text-xs text-slate-700">Set NEXT_PUBLIC_CONTRACT_ADDRESS</span>
            )}
            <button
              onClick={() => void fetchData()}
              className="text-xs text-slate-500 hover:text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 transition-colors" /* [v2-1] slate */
            >
              ↻ {lastFetch?.toLocaleTimeString() ?? '—'}
            </button>
          </div>
        </header>

        {/* ── Stat cards ────────────────────────────────────────────────── */}
        {/* [v2-2] gap-4 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* [v2-4] value + label pattern, [v2-1] slate icons */}
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            value={String(snapshots.length)}
            label="Total Decisions"
            sub="poll cycles recorded"
          />
          <StatCard
            icon={<AlertCircle className="w-4 h-4 text-red-500" />} /* [v2-5] AlertCircle red-500 */
            value={String(alerts.length)}
            label="Alerts Triggered"
            sub={`${settledAlerts.length} settled on-chain`}
          />
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            value={latest ? relativeTime(latest.timestamp) : '—'}
            label="Last Update"
            sub={latest ? fmtTime(latest.timestamp) : ''}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-indigo-500" />} /* [v2-1] indigo-500 */
            value={`${latestProb}%`}
            label="Latest Price"
            sub={`token: ${data.market.tokenId.slice(0, 8)}…`}
          />
        </div>

        {/* ── AI Track Record (differentiator) ─────────────────────────── */}
        {/* [v2-1] indigo-950 tint border, slate bg */}
        <Card className="bg-slate-900 border-indigo-900/40">
          <CardContent className="p-6"> {/* [v2-2] p-6 */}
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-5 h-5 text-indigo-500 shrink-0" /> {/* [v2-1] indigo-500 */}
                  {/* [v2-3] text-sm for section heading */}
                  <span className="text-sm font-semibold text-indigo-400 uppercase tracking-wider">
                    AI Track Record
                  </span>
                  <Badge
                    variant="outline"
                    className="border-indigo-800/60 text-indigo-400 text-xs px-1.5" /* [v2-1] indigo only */
                  >
                    Verifiable on Sepolia
                  </Badge>
                </div>

                {/* [v2-3] text-sm body */}
                <p className="text-sm text-slate-500 mb-4 max-w-xl">
                  Every anomaly alert makes a directional prediction written on-chain{' '}
                  <strong className="text-slate-300">before</strong> price settlement.
                  Accuracy is publicly auditable — no trust required.
                </p>

                <div className="flex items-center gap-6">
                  <div>
                    {/* [v2-4] text-3xl font-bold for key number */}
                    <p className="text-3xl font-bold text-white">
                      {accuracy !== null ? `${accuracy}%` : '—'}
                    </p>
                    {/* [v2-4] text-sm text-slate-400 label below */}
                    <p className="text-sm text-slate-400 mt-1">
                      {correctAlerts.length} correct / {settledAlerts.length} settled
                      {alerts.length - settledAlerts.length > 0 && (
                        <span className="text-slate-500 ml-2">
                          · {alerts.length - settledAlerts.length} pending
                        </span>
                      )}
                    </p>
                  </div>

                  {settledAlerts.length > 0 && (
                    <div className="flex-1 max-w-xs">
                      <div className="bg-slate-800 rounded-full h-2 overflow-hidden"> {/* [v2-1] slate */}
                        <div
                          className="h-2 bg-indigo-500 rounded-full transition-all duration-700" /* [v2-1] indigo-500 */
                          style={{
                            width: `${(correctAlerts.length / settledAlerts.length) * 100}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-slate-600 mt-1">accuracy</p> {/* [v2-3] text-xs */}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent predictions mini-list */}
              {alerts.length > 0 && (
                <div className="hidden lg:flex flex-col gap-1.5 min-w-[220px]">
                  <p className="text-xs text-slate-600 mb-0.5">Recent predictions</p> {/* [v2-3] text-xs */}
                  {alerts
                    .slice(-4)
                    .reverse()
                    .map((a) => (
                      <div
                        key={a.localId}
                        className="flex items-center justify-between text-xs bg-slate-800/60 rounded-lg px-2.5 py-1.5" /* [v2-1] slate */
                      >
                        <span className="text-slate-500">{fmtTime(a.alertedAt)}</span>
                        {/* [v2-5] icons for direction, no arrows emoji */}
                        <span className="flex items-center gap-1 text-slate-300">
                          {a.direction === 'UP'
                            ? <TrendingUp className="w-3 h-3 text-indigo-400" />
                            : <TrendingDown className="w-3 h-3 text-slate-400" />}
                          {(a.probAtAlert * 100).toFixed(2)}%
                        </span>
                        {/* [v2-5] CheckCircle / AlertCircle / Clock — no emoji */}
                        <SettleIcon correct={a.correct} settled={a.settled} />
                      </div>
                    ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Chart ────────────────────────────────────────────────────── */}
        {/* [v2-1] slate-900 bg, slate-800 border */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              {/* [v2-3] text-lg card title */}
              <CardTitle className="text-lg font-semibold text-slate-200">
                Probability — Last {Math.min(60, chartData.length)} readings
              </CardTitle>
              {alertTimeSet.size > 0 && (
                <div className="flex items-center gap-1.5">
                  {/* [v2-1] indigo-500 for alert marker legend */}
                  <span className="inline-block w-4 border-t-2 border-dashed border-indigo-500/70" />
                  <span className="text-xs text-slate-500">alert</span> {/* [v2-3] text-xs */}
                </div>
              )}
            </div>
            {/* [v2-3] text-sm description */}
            <CardDescription className="text-sm text-slate-500">
              {data.market.question}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-0"> {/* [v2-2] p-6 */}
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  {/* [v2-1] slate grid lines */}
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
                      backgroundColor: '#0f172a', // slate-900
                      border: '1px solid #1e293b', // slate-800
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#94a3b8' }} // slate-400
                    formatter={(v) => [`${Number(v).toFixed(3)}%`, 'Probability']}
                  />
                  {/* [v2-1] indigo-500 alert markers */}
                  {chartData
                    .filter((d) => alertTimeSet.has(d.time))
                    .map((d) => (
                      <ReferenceLine
                        key={d.time}
                        x={d.time}
                        stroke="#6366f1" // indigo-500
                        strokeDasharray="4 4"
                        strokeOpacity={0.7}
                      />
                    ))}
                  {/* [v2-1] indigo-500 line */}
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
              <div className="h-48 flex items-center justify-center text-slate-600 text-sm"> {/* [v2-3] text-sm */}
                Start the worker and wait for the first poll cycle.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Bottom row ────────────────────────────────────────────────── */}
        {/* [v2-2] gap-4 */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Decision Timeline */}
          {/* [v2-1] slate-900 bg, slate-800 border */}
          <Card className="bg-slate-900 border-slate-800 lg:col-span-3">
            <CardHeader className="pb-2">
              {/* [v2-3] text-lg card title */}
              <CardTitle className="text-lg text-slate-200">Decision Timeline</CardTitle>
              <CardDescription className="text-sm text-slate-500"> {/* [v2-3] text-sm */}
                Last 20 poll cycles · alert rows highlighted
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  {/* [v2-1] slate borders */}
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="text-xs text-slate-600 w-16 pl-6">Time</TableHead> {/* [v2-3] text-xs */}
                    <TableHead className="text-xs text-slate-600">Price</TableHead>
                    <TableHead className="text-xs text-slate-600">Δ pp</TableHead>
                    <TableHead className="text-xs text-slate-600">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-600 text-sm py-10"> {/* [v2-3] text-sm */}
                        No data yet — start the worker
                      </TableCell>
                    </TableRow>
                  ) : (
                    tableRows.map((row, i) => (
                      <TableRow
                        key={i}
                        className={cn(
                          'border-slate-800/60 text-xs transition-colors', /* [v2-1] slate border */
                          row.linkedAlert
                            ? 'bg-red-950/20 hover:bg-red-950/30' // [v2-1] red tint for alert rows
                            : 'hover:bg-slate-800/40',
                        )}
                      >
                        <TableCell className="text-slate-500 font-mono pl-6">
                          {fmtTime(row.timestamp)}
                        </TableCell>
                        <TableCell className="text-slate-200 font-mono">
                          {(row.probability * 100).toFixed(3)}%
                        </TableCell>
                        {/* [v2-1] delta: indigo for positive (signal), slate for zero */}
                        <TableCell
                          className={cn(
                            'font-mono',
                            row.delta > 0.001
                              ? 'text-indigo-400'   // [v2-1] indigo-500 for positive movement
                              : row.delta < -0.001
                                ? 'text-slate-400'  // [v2-1] neutral slate for negative
                                : 'text-slate-600',
                          )}
                        >
                          {row.delta > 0 ? '+' : ''}
                          {row.delta.toFixed(3)}
                        </TableCell>
                        <TableCell>
                          {/* [v2-5] ActionCell uses AlertCircle/Info icons */}
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
          {/* [v2-1] slate-900 bg, slate-800 border */}
          <Card className="bg-slate-900 border-slate-800 lg:col-span-2">
            <CardHeader className="pb-2">
              {/* [v2-3] text-lg card title */}
              <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                On-chain Predictions
                {alerts.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs text-indigo-400 border-indigo-800/60" /* [v2-1] indigo only */
                  >
                    {alerts.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500"> {/* [v2-3] text-sm */}
                SignalVault.sol · Sepolia
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-6 pt-0"> {/* [v2-2] p-6 */}
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Info className="w-8 h-8 text-slate-700" /> {/* [v2-5] Info icon */}
                  <p className="text-sm text-slate-600 text-center"> {/* [v2-3] text-sm */}
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
                      // [v2-1] slate-800 bg, slate border — no colored borders except status indicator
                      className="bg-slate-800/50 rounded-xl p-4 space-y-2.5 border border-slate-700/30"
                    >
                      {/* Top: settle status + direction + time */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {/* [v2-5] SettleIcon: CheckCircle/AlertCircle/Clock */}
                          <SettleIcon correct={a.correct} settled={a.settled} />
                          {/* [v2-5] TrendingUp/Down for direction, no arrows */}
                          <div className="flex items-center gap-1 text-slate-300">
                            {a.direction === 'UP'
                              ? <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                              : <TrendingDown className="w-3.5 h-3.5 text-slate-400" />}
                            <span className="text-xs font-medium">{a.direction}</span> {/* [v2-3] text-xs */}
                          </div>
                          {/* [v2-1] urgency as indigo/red badge only */}
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs px-1.5 py-0',
                              a.urgency === 'high'
                                ? 'border-red-800/60 text-red-400'   // [v2-1] red for high urgency
                                : 'border-slate-700 text-slate-500', // [v2-1] slate for others
                            )}
                          >
                            {a.urgency}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-600">{fmtTime(a.alertedAt)}</span> {/* [v2-3] text-xs */}
                      </div>

                      {/* Reason */}
                      <p className="text-sm text-slate-400 leading-relaxed line-clamp-2"> {/* [v2-3] text-sm */}
                        {a.reason}
                      </p>

                      {/* Price row */}
                      <div className="flex items-center gap-3 text-xs text-slate-600"> {/* [v2-3] text-xs */}
                        <span>
                          at{' '}
                          <span className="text-slate-300 font-mono">
                            {(a.probAtAlert * 100).toFixed(2)}%
                          </span>
                        </span>
                        {a.probAtSettle !== undefined && (
                          <span>
                            →{' '}
                            {/* [v2-1] emerald for correct settle, red for wrong */}
                            <span
                              className={cn(
                                'font-mono',
                                a.correct ? 'text-emerald-400' : 'text-red-400',
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
                            className="ml-auto flex items-center gap-1 text-indigo-500 hover:text-indigo-400 transition-colors" /* [v2-1] indigo-500 */
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

        {/* ── Footer ────────────────────────────────────────────────────── */}
        {/* [v2-3] text-xs footer */}
        <p className="text-xs text-slate-700 text-center pb-4">
          Auto-refreshes every 30 s · {snapshots.length} snapshots ·{' '}
          {data.lastUpdated ? `Last updated ${relativeTime(data.lastUpdated)}` : ''}
        </p>

      </div>
    </div>
  )
}
