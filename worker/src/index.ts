/**
 * Signal Vault — worker main loop
 *
 * Every 60 s: fetch Polymarket probability → store in memory → write snapshot.json
 * Later phases add LLM alert detection (D2) and Telegram notifications (D4).
 */
import 'dotenv/config'
import path from 'path'
import fs from 'fs/promises'
import { fetchMarketProbability } from './polymarket.js'
import { checkAlert } from './llm.js'
import { onAlert } from './registry.js'
import { notify } from './notify.js'

const POLL_INTERVAL_MS = 60_000
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

async function poll(): Promise<void> {
  let probability: number

  try {
    probability = await fetchMarketProbability()
  } catch {
    // polymarket.ts already retried once and warned; skip this cycle
    return
  }

  const entry: SnapshotEntry = {
    timestamp: new Date().toISOString(),
    probability,
  }
  snapshots.push(entry)
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS)
  }

  try {
    await writeSnapshot()
  } catch (err) {
    console.warn('[index] failed to write snapshot.json', err)
  }

  console.log(`[index] ${entry.timestamp}  prob=${(probability * 100).toFixed(2)}%  total=${snapshots.length}`)

  // D2: LLM alert detection (currently a no-op placeholder)
  try {
    const recentProbs = snapshots.slice(-10).map((s) => s.probability)
    const alert = await checkAlert(recentProbs)
    if (alert.isAlert) {
      const marketId = process.env.POLYMARKET_TOKEN_ID ?? 'unknown'
      await onAlert(marketId, probability, alert.reason)
      await notify(`🚨 Signal Vault alert — ${process.env.MARKET_QUESTION}\nProb: ${(probability * 100).toFixed(2)}%\nReason: ${alert.reason}`)
    }
  } catch (err) {
    console.warn('[index] alert pipeline error', err)
  }
}

async function main(): Promise<void> {
  console.log('[main] Signal Vault worker starting…')
  console.log(`[main] Snapshot output: ${SNAPSHOT_PATH}`)
  console.log(`[main] Market: ${process.env.MARKET_QUESTION ?? '(set MARKET_QUESTION in .env)'}`)

  await poll() // run immediately on start
  setInterval(() => {
    poll().catch((err) => console.warn('[main] unexpected poll error', err))
  }, POLL_INTERVAL_MS)
}

main().catch((err) => {
  console.error('[main] fatal error', err)
  process.exit(1)
})
