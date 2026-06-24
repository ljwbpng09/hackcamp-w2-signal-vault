/**
 * Signal Vault — worker main loop (multi-market + auto match-day)
 *
 * Static markets: read from POLYMARKET_MARKETS env var (tournament winner odds).
 * Dynamic markets (Plan B): every poll cycle, matchday.ts queries the Gamma API
 *   for today's "Will X win on YYYY-MM-DD?" markets and merges them into the
 *   live monitoring set. Resolved markets (prob at 0/1) are automatically retired.
 *
 * Every 60 s per market:
 *   0. Sync match-day markets (add new / retire resolved)
 *   1. Fetch probability from Polymarket CLOB
 *   2. Append to per-market ring buffer
 *   3. Write multi-market snapshot.json
 *   4. Run LLM alertOnAnomaly (per market)
 *   5. Settle any pending predictions whose deadline has passed
 *
 * snapshot.json schema:
 *   {
 *     markets: [{ tokenId, question, snapshots, alerts }],
 *     lastUpdated: ISO string
 *   }
 *
 * Error-handling contract:
 *   - Each market fetch is individually guarded — one failure doesn't skip others.
 *   - doPoll() wraps all sub-steps in try/catch.
 *   - poll() is the final safety net so a single cycle never crashes the process.
 */
import 'dotenv/config'
import path from 'path'
import fs from 'fs/promises'
import { fetchMarketProbability } from './polymarket.js'
import { alertOnAnomaly, type AlertState, pendingPredictions } from './alert.js'
import { checkSettlements, toAlertRecord, type AlertRecord } from './settler.js'
import { setupCommands, botState, pendingMarketQueue, setGetMarketsCallback } from './notify.js'
import { withRetry } from './retry.js'
import { fetchMatchDayMarkets, fetchResolvedMatchDayTokenIds } from './matchday.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = Math.max(10_000, parseInt(process.env.POLL_INTERVAL_MS ?? '60000', 10))
const MAX_SNAPSHOTS = 500

const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  process.env.SNAPSHOT_OUTPUT_PATH ?? '../web/public/snapshot.json',
)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketConfig {
  tokenId: string
  question: string
}

interface SnapshotEntry {
  timestamp: string
  probability: number
}

interface MarketSnapshotData {
  tokenId: string
  question: string
  snapshots: SnapshotEntry[]
  alerts: AlertRecord[]
}

interface SnapshotFile {
  markets: MarketSnapshotData[]
  lastUpdated: string
}

// ─── Market config loader ─────────────────────────────────────────────────────

/**
 * Reads POLYMARKET_MARKETS (JSON array of {tokenId, question}) from .env.
 * Falls back to the legacy POLYMARKET_TOKEN_ID + MARKET_QUESTION pair.
 */
function loadMarkets(): MarketConfig[] {
  const raw = process.env.POLYMARKET_MARKETS
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MarketConfig[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((m) => m.tokenId && m.question)
      }
    } catch {
      console.warn('[main] failed to parse POLYMARKET_MARKETS — falling back to single market')
    }
  }
  // Legacy single-market fallback
  const tokenId = process.env.POLYMARKET_TOKEN_ID ?? ''
  const question = process.env.MARKET_QUESTION ?? 'Unknown market'
  if (!tokenId) throw new Error('Set POLYMARKET_MARKETS or POLYMARKET_TOKEN_ID in .env')
  return [{ tokenId, question }]
}

// ─── Per-market state ─────────────────────────────────────────────────────────

const markets: MarketConfig[] = loadMarkets()

/** Per-market ring buffer: tokenId → SnapshotEntry[] */
const marketSnapshots = new Map<string, SnapshotEntry[]>(
  markets.map((m) => [m.tokenId, []]),
)

/** Per-market LLM alert state: tokenId → AlertState */
const marketAlertState = new Map<string, AlertState>(
  markets.map((m) => [m.tokenId, { lastAlertedAt: null }]),
)

/** tokenIds that were added automatically by match-day detection (vs. static config). */
const matchDayTokenIds = new Set<string>()

// ─── Match-day sync ───────────────────────────────────────────────────────────

/**
 * Called once per poll cycle (Step 0).
 * - Queries Gamma API for today's live match markets.
 * - Adds new ones to `markets`, `marketSnapshots`, `marketAlertState`.
 * - Removes previously auto-added markets that are now resolved.
 *
 * Static markets (from POLYMARKET_MARKETS) are never removed.
 */
async function syncMatchDayMarkets(): Promise<void> {
  try {
    // 0. Drain markets queued via /add Telegram command
    while (pendingMarketQueue.length > 0) {
      const m = pendingMarketQueue.shift()!
      if (markets.some((x) => x.tokenId === m.tokenId)) continue
      markets.push(m)
      marketSnapshots.set(m.tokenId, [])
      marketAlertState.set(m.tokenId, { lastAlertedAt: null })
      console.log(`[index] /add applied: ${m.question.slice(0, 60)}`)
    }

    // 1. Discover new match-day markets
    const discovered = await fetchMatchDayMarkets()
    for (const m of discovered) {
      if (markets.some((x) => x.tokenId === m.tokenId)) continue // already tracked
      markets.push(m)
      marketSnapshots.set(m.tokenId, [])
      marketAlertState.set(m.tokenId, { lastAlertedAt: null })
      matchDayTokenIds.add(m.tokenId)
      console.log(`[matchday] ➕ added: ${m.question.slice(0, 60)}`)
    }

    // 2. Retire resolved match-day markets
    const resolvedQuestions = await fetchResolvedMatchDayTokenIds()
    for (const tokenId of [...matchDayTokenIds]) {
      const market = markets.find((x) => x.tokenId === tokenId)
      if (!market) continue
      if (resolvedQuestions.has(market.question)) {
        const idx = markets.indexOf(market)
        if (idx !== -1) markets.splice(idx, 1)
        marketSnapshots.delete(tokenId)
        marketAlertState.delete(tokenId)
        matchDayTokenIds.delete(tokenId)
        console.log(`[matchday] ➖ retired: ${market.question.slice(0, 60)}`)
      }
    }
  } catch (err) {
    // Non-fatal — static markets continue unaffected
    console.warn('[matchday] syncMatchDayMarkets error:', (err as Error).message)
  }
}

// ─── Snapshot loader ──────────────────────────────────────────────────────────

async function loadSnapshot(): Promise<void> {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>

    // New multi-market format
    if (Array.isArray(data['markets'])) {
      const saved = data['markets'] as MarketSnapshotData[]
      let total = 0
      for (const saved_market of saved) {
        const buf = marketSnapshots.get(saved_market.tokenId)
        if (buf && Array.isArray(saved_market.snapshots) && saved_market.snapshots.length > 0) {
          const restored = saved_market.snapshots.slice(-MAX_SNAPSHOTS)
          buf.push(...restored)
          total += restored.length
        }
      }
      console.log(`[main] restored ${total} snapshot(s) across ${saved.length} market(s)`)
      return
    }

    // Legacy single-market format: { market: {tokenId}, snapshots: [...] }
    if (Array.isArray(data['snapshots'])) {
      const legacyTokenId = (data['market'] as Record<string, string> | undefined)?.tokenId ?? ''
      const buf = marketSnapshots.get(legacyTokenId) ?? marketSnapshots.values().next().value
      if (buf) {
        const restored = (data['snapshots'] as SnapshotEntry[]).slice(-MAX_SNAPSHOTS)
        buf.push(...restored)
        console.log(`[main] restored ${restored.length} snapshot(s) from legacy format`)
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      console.log('[main] no existing snapshot.json — starting fresh')
    } else {
      console.warn('[main] could not load existing snapshot.json, starting fresh:', err)
    }
  }
}

// ─── Snapshot writer ──────────────────────────────────────────────────────────

async function writeSnapshot(): Promise<void> {
  const file: SnapshotFile = {
    markets: markets.map((m) => ({
      tokenId: m.tokenId,
      question: m.question,
      snapshots: marketSnapshots.get(m.tokenId) ?? [],
      alerts: pendingPredictions
        .filter((p) => p.tokenId === m.tokenId)
        .map(toAlertRecord),
    })),
    lastUpdated: new Date().toISOString(),
  }
  const dir = path.dirname(SNAPSHOT_PATH)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(file, null, 2), 'utf-8')
}

// ─── Inner poll logic ─────────────────────────────────────────────────────────

async function doPoll(): Promise<void> {
  // Step 0: Sync today's match-day markets (add new / retire resolved)
  await syncMatchDayMarkets()

  // Collect successful prices for settlement lookup
  const currentPrices = new Map<string, number>()

  // Step 1 + 2: Fetch each market and update its ring buffer
  for (const market of markets) {
    let probability: number
    try {
      probability = await fetchMarketProbability(market.tokenId)
    } catch {
      // polymarket.ts already logged the error — skip this market this cycle
      continue
    }

    const buf = marketSnapshots.get(market.tokenId)!
    const entry: SnapshotEntry = { timestamp: new Date().toISOString(), probability }
    buf.push(entry)
    if (buf.length > MAX_SNAPSHOTS) buf.splice(0, buf.length - MAX_SNAPSHOTS)

    currentPrices.set(market.tokenId, probability)
    console.log(
      `[poll] ${market.question.slice(0, 40).padEnd(40)}  ` +
        `#${String(buf.length).padStart(3, '0')}  ` +
        `prob=${(probability * 100).toFixed(3)}%`,
    )
  }

  if (currentPrices.size === 0) return // all fetches failed

  // Step 3: Persist snapshot.json
  try {
    await withRetry(() => writeSnapshot(), {
      label: '[index/snapshot]',
      attempts: 2,
      baseDelayMs: 500,
      jitterMs: 200,
    })
  } catch (err) {
    console.warn('[index] failed to write snapshot.json after retries', err)
  }

  // Step 4: LLM anomaly-alert decision — one per successfully fetched market
  for (const market of markets) {
    const probability = currentPrices.get(market.tokenId)
    if (probability === undefined) continue

    try {
      const buf = marketSnapshots.get(market.tokenId)!
      const recentPrices = buf.slice(-60).map((s) => s.probability)
      const state = marketAlertState.get(market.tokenId)!

      const cycleResult = await alertOnAnomaly(
        market.tokenId,
        market.question,
        probability,
        recentPrices,
        state,
      )
      marketAlertState.set(market.tokenId, cycleResult.state)
      botState.totalDecisions++
      if (cycleResult.triggered) {
        botState.alertsTriggered++
        if (cycleResult.txUrl) botState.lastTxUrl = cycleResult.txUrl
      }
    } catch (err) {
      console.warn(`[index] alert pipeline error for ${market.question.slice(0, 30)}`, err)
    }
  }

  // Step 5: Settle predictions whose 10-min deadline has passed
  try {
    await checkSettlements(currentPrices)
  } catch (err) {
    console.warn('[index] settler unexpected error', err)
  }
}

// ─── Outer safety net ─────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    await doPoll()
  } catch (err) {
    console.warn('[index] unexpected error escaped doPoll(), skipping cycle', err)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[main] ─────────────────────────────────────────')
  console.log('[main] Signal Vault worker starting…')

  try {
    await setupCommands()
  } catch (err) {
    console.warn('[main] Telegram setupCommands failed (continuing without bot):', (err as Error).message)
  }

  // Let the /markets and /status commands read the live market list
  setGetMarketsCallback(() => markets)

  console.log(`[main] Static markets  : ${markets.length}`)
  for (const m of markets) {
    console.log(`[main]   · ${m.question.slice(0, 60)}`)
    console.log(`[main]     tokenId: ${m.tokenId.slice(0, 16)}…`)
  }
  console.log(`[main] Match-day auto  : enabled (Gamma API, today's games auto-added)`)
  console.log(`[main] Poll interval   : ${POLL_INTERVAL_MS / 1_000}s`)
  console.log(`[main] Snapshot output : ${SNAPSHOT_PATH}`)
  console.log('[main] ─────────────────────────────────────────')

  await loadSnapshot()

  try {
    await poll()
  } catch (err) {
    console.warn('[main] initial poll failed, continuing to interval loop', err)
  }

  setInterval(() => {
    poll().catch((err) => console.warn('[main] interval poll rejected unexpectedly', err))
  }, POLL_INTERVAL_MS)
}

main().catch((err) => {
  console.error('[main] fatal startup error', err)
  process.exit(1)
})
