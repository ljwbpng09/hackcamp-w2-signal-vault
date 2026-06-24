/**
 * matchday.ts — Auto match-day market detection (Plan B)
 *
 * Queries the Polymarket Gamma API every poll cycle to discover today's
 * "Will X win on YYYY-MM-DD?" markets.  Returns a list of MarketConfig
 * objects that index.ts merges into the live monitoring set.
 *
 * A market is considered a match-day market when its question matches:
 *   /will .+ win on \d{4}-\d{2}-\d{2}/i
 * and the embedded date equals today (UTC).
 *
 * Markets are auto-retired when `active: false` OR probability has
 * converged to ≥ 0.98 or ≤ 0.02 (resolved outcome).
 *
 * Never throws — all failures are caught and logged.  Returns [] on error
 * so the caller can continue with the existing market set.
 */

import axios from 'axios'
import type { MarketConfig } from './index.js'

const GAMMA_API = 'https://gamma-api.polymarket.com'

// ─── Types (Gamma API subset) ─────────────────────────────────────────────────

interface GammaMarket {
  conditionId: string
  question: string
  active: boolean
  closed: boolean
  outcomePrices: string | string[]
}

interface ClobToken {
  outcome: string
  token_id: string
}

interface ClobMarket {
  tokens: ClobToken[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Today's date in UTC as "YYYY-MM-DD". */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Pattern: "Will X win on 2026-06-24?" */
const MATCH_DAY_RE = /will .+ win on (\d{4}-\d{2}-\d{2})/i

/** Parse outcomePrices — Gamma returns either a JSON string or an array. */
function parseYesProb(raw: string | string[]): number {
  try {
    const arr: string[] = typeof raw === 'string' ? (JSON.parse(raw) as string[]) : raw
    return parseFloat(arr[0] ?? '0')
  } catch {
    return 0
  }
}

/**
 * Fetch the YES token_id for a conditionId from the CLOB API.
 * Returns null if not found or on error.
 */
export async function fetchYesTokenId(conditionId: string): Promise<string | null> {
  try {
    const res = await axios.get<ClobMarket>(
      `https://clob.polymarket.com/markets/${conditionId}`,
      { timeout: 8_000 },
    )
    const yesToken = res.data.tokens.find(
      (t) => t.outcome.toLowerCase() === 'yes',
    )
    return yesToken?.token_id ?? null
  } catch {
    return null
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Returns today's match-day markets as MarketConfig objects, ready to be
 * merged into the live monitoring set.
 *
 * Only returns markets that:
 *   1. Match the "Will X win on YYYY-MM-DD?" pattern for today
 *   2. Are still active and not yet resolved (prob not at 0/1)
 *   3. Have a fetchable YES token_id from the CLOB API
 */
export async function fetchMatchDayMarkets(): Promise<MarketConfig[]> {
  const today = todayUTC()

  let gammaMarkets: GammaMarket[]
  try {
    const res = await axios.get<GammaMarket[]>(
      `${GAMMA_API}/markets?limit=200&active=true&closed=false&order=volume24hr&ascending=false`,
      { timeout: 10_000 },
    )
    gammaMarkets = res.data
  } catch (err) {
    console.warn('[matchday] Gamma API fetch failed:', (err as Error).message)
    return []
  }

  // Filter to today's match markets that are still live
  const candidates = gammaMarkets.filter((m) => {
    const match = MATCH_DAY_RE.exec(m.question)
    if (!match) return false
    if (match[1] !== today) return false
    if (!m.active || m.closed) return false
    const prob = parseYesProb(m.outcomePrices)
    // Skip already-resolved markets (prob collapsed to near 0 or 1)
    if (prob >= 0.98 || prob <= 0.02) return false
    return true
  })

  if (candidates.length === 0) {
    console.log(`[matchday] no active match-day markets found for ${today}`)
    return []
  }

  console.log(`[matchday] found ${candidates.length} match-day market(s) for ${today}`)

  // Resolve YES token_ids concurrently (with concurrency cap to be polite)
  const results: MarketConfig[] = []
  for (const market of candidates) {
    const tokenId = await fetchYesTokenId(market.conditionId)
    if (!tokenId) {
      console.warn(`[matchday] could not resolve tokenId for: ${market.question.slice(0, 60)}`)
      continue
    }
    results.push({ tokenId, question: market.question })
    console.log(
      `[matchday]   + ${market.question.slice(0, 60)}  ` +
        `(token: ${tokenId.slice(0, 12)}…)`,
    )
  }

  return results
}

// ─── General market search ────────────────────────────────────────────────────

export interface MarketSearchResult {
  conditionId: string
  question: string
}

/**
 * Search Gamma API for active Polymarket markets whose question contains
 * the given query string (case-insensitive).
 *
 * Biased towards World Cup / soccer markets but accepts any keyword.
 * Returns up to `limit` results sorted by 24h volume.
 */
export async function searchMarkets(
  query: string,
  limit = 5,
): Promise<MarketSearchResult[]> {
  let markets: GammaMarket[]
  try {
    const res = await axios.get<GammaMarket[]>(
      `${GAMMA_API}/markets?limit=200&active=true&closed=false&order=volume24hr&ascending=false`,
      { timeout: 10_000 },
    )
    markets = res.data
  } catch (err) {
    console.warn('[matchday] searchMarkets API error:', (err as Error).message)
    return []
  }

  const lq = query.toLowerCase()
  return markets
    .filter((m) => {
      if (!m.active || m.closed) return false
      const q = m.question.toLowerCase()
      if (!q.includes(lq)) return false
      // Prefer World Cup / soccer context but don't exclude others
      return true
    })
    .slice(0, limit)
    .map((m) => ({ conditionId: m.conditionId, question: m.question }))
}

/**
 * Returns conditionIds of today's match markets that appear resolved:
 *   active=false, closed=true, OR prob ≥ 0.98 / ≤ 0.02.
 *
 * index.ts uses this to retire markets from the live set.
 */
export async function fetchResolvedMatchDayTokenIds(): Promise<Set<string>> {
  const today = todayUTC()
  const resolved = new Set<string>()

  let gammaMarkets: GammaMarket[]
  try {
    // Include closed markets in this query to catch resolved ones
    const res = await axios.get<GammaMarket[]>(
      `${GAMMA_API}/markets?limit=200&order=volume24hr&ascending=false`,
      { timeout: 10_000 },
    )
    gammaMarkets = res.data
  } catch {
    return resolved
  }

  for (const m of gammaMarkets) {
    const match = MATCH_DAY_RE.exec(m.question)
    if (!match || match[1] !== today) continue
    const prob = parseYesProb(m.outcomePrices)
    if (!m.active || m.closed || prob >= 0.98 || prob <= 0.02) {
      // We only have conditionId here; index.ts will match by question string
      resolved.add(m.question)
    }
  }

  return resolved
}
