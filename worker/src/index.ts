/**
 * Signal Vault — worker main loop
 *
 * Every 60 s: fetch Polymarket probability → store in memory → write snapshot.json
 * Later phases add LLM alert detection (D2) and Telegram notifications (D4).
 *
 * Error-handling contract:
 *   - Each sub-step (fetch / write / LLM / notify) has its own try/catch.
 *   - doPoll() is the inner function that contains all business logic.
 *   - poll() wraps doPoll() as a final safety net — a bug anywhere in doPoll()
 *     will be caught here so the process never crashes.
 *   - The setInterval callback catches any residual errors from poll().
 *   - The initial poll() in main() is separately guarded so startup failure
 *     does not prevent the interval from running.
 */
import 'dotenv/config'
import path from 'path'
import fs from 'fs/promises'
import { fetchMarketProbability } from './polymarket.js'
import { checkAlert } from './llm.js'
import { onAlert } from './registry.js'
import { notify } from './notify.js'
import { withRetry } from './retry.js'

// Allow override for quick local testing: POLL_INTERVAL_MS=10000 npm run dev
// Must be ≥ 60 000 ms in production to stay within Polymarket rate limits.
const POLL_INTERVAL_MS = Math.max(10_000, parseInt(process.env.POLL_INTERVAL_MS ?? '60000', 10))
const MAX_SNAPSHOTS = 500

const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  process.env.SNAPSHOT_OUTPUT_PATH ?? '../web/public/snapshot.json',
)

interface SnapshotEntry {
  timestamp: string
  probability: number
}

interface SnapshotFile {
  market: { tokenId: string; question: string }
  snapshots: SnapshotEntry[]
  lastUpdated: string
}

const snapshots: SnapshotEntry[] = []

// ─── Snapshot loader (called once on startup) ─────────────────────────────────

/**
 * Reads an existing snapshot.json back into the in-memory array so that
 * a worker restart does not lose historical data points.
 */
async function loadSnapshot(): Promise<void> {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, 'utf-8')
    const data = JSON.parse(raw) as SnapshotFile
    if (Array.isArray(data.snapshots) && data.snapshots.length > 0) {
      // Take only the most recent MAX_SNAPSHOTS entries in case the file is large.
      const restored = data.snapshots.slice(-MAX_SNAPSHOTS)
      snapshots.push(...restored)
      console.log(
        `[main] restored ${snapshots.length} snapshot(s) from ${SNAPSHOT_PATH} ` +
          `(oldest: ${restored[0]?.timestamp ?? '—'})`,
      )
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      console.log('[main] no existing snapshot.json — starting fresh')
    } else {
      // Parse error or permission error: warn but don't crash — start fresh.
      console.warn('[main] could not load existing snapshot.json, starting fresh:', err)
    }
  }
}

// ─── Snapshot writer ──────────────────────────────────────────────────────────

async function writeSnapshot(): Promise<void> {
  const data: SnapshotFile = {
    market: {
      tokenId: process.env.POLYMARKET_TOKEN_ID ?? '',
      question: process.env.MARKET_QUESTION ?? 'Unknown market',
    },
    snapshots,
    lastUpdated: new Date().toISOString(),
  }
  const dir = path.dirname(SNAPSHOT_PATH)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Inner poll logic (all errors caught individually) ────────────────────────

async function doPoll(): Promise<void> {
  // Step 1: Fetch probability — skip cycle on any failure (polymarket.ts already logged it).
  let probability: number
  try {
    probability = await fetchMarketProbability()
  } catch {
    // polymarket.ts / withRetry already printed a warn with full context.
    return
  }

  // Step 2: Update in-memory ring buffer.
  const entry: SnapshotEntry = {
    timestamp: new Date().toISOString(),
    probability,
  }
  snapshots.push(entry)
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS)
  }

  console.log(
    `[poll] #${String(snapshots.length).padStart(3, '0')}  ` +
      `${entry.timestamp}  ` +
      `prob=${(probability * 100).toFixed(3)}%`,
  )

  // Step 3: Persist snapshot.json — retry once; failure is non-fatal.
  try {
    await withRetry(() => writeSnapshot(), {
      label: '[index/snapshot]',
      attempts: 2,
      baseDelayMs: 500,
      jitterMs: 200,
    })
  } catch (err) {
    console.warn('[index] failed to write snapshot.json after retries', err)
    // Non-fatal: continue to alert pipeline even if disk write fails.
  }

  // Step 4: LLM alert detection (placeholder until D2).
  try {
    const recentProbs = snapshots.slice(-10).map((s) => s.probability)
    const alert = await checkAlert(recentProbs)
    if (alert.isAlert) {
      const marketId = process.env.POLYMARKET_TOKEN_ID ?? 'unknown'

      // Step 4a: On-chain logging — failure is non-fatal.
      try {
        await onAlert(marketId, probability, alert.reason)
      } catch (err) {
        console.warn('[index] onAlert (registry) failed', err)
      }

      // Step 4b: Telegram notification — failure is non-fatal.
      try {
        await notify(
          `🚨 Signal Vault alert — ${process.env.MARKET_QUESTION}\n` +
            `Prob: ${(probability * 100).toFixed(2)}%\nReason: ${alert.reason}`,
        )
      } catch (err) {
        console.warn('[index] notify failed', err)
      }
    }
  } catch (err) {
    console.warn('[index] LLM alert pipeline error', err)
  }
}

// ─── Outer safety net ─────────────────────────────────────────────────────────

/**
 * Public entry point called by setInterval and on startup.
 * Wraps doPoll() so that any unexpected uncaught error inside it
 * is caught here — the process is never brought down by a single cycle.
 */
async function poll(): Promise<void> {
  try {
    await doPoll()
  } catch (err) {
    // Should never reach here — doPoll() catches all sub-errors individually.
    // This is the last-resort safety net.
    console.warn('[index] unexpected error escaped doPoll(), skipping cycle', err)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[main] ─────────────────────────────────────────')
  console.log('[main] Signal Vault worker starting…')
  console.log(`[main] Market          : ${process.env.MARKET_QUESTION ?? '(set MARKET_QUESTION in .env)'}`)
  console.log(`[main] Token ID        : ${(process.env.POLYMARKET_TOKEN_ID ?? '').slice(0, 12)}…`)
  console.log(`[main] Poll interval   : ${POLL_INTERVAL_MS / 1_000}s`)
  console.log(`[main] Snapshot output : ${SNAPSHOT_PATH}`)
  console.log('[main] ─────────────────────────────────────────')

  // Restore history from previous run before the first poll.
  await loadSnapshot()

  // Initial poll — wrapped separately so a startup failure does NOT prevent
  // the interval from being registered (process keeps running).
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
  // Only truly fatal errors (e.g. can't even start setInterval) reach here.
  console.error('[main] fatal startup error', err)
  process.exit(1)
})
