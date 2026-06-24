/**
 * 10-round simulation of alertOnAnomaly().
 *
 * Price series design:
 *   Rounds 0–3  : stable baseline ~1.5–1.6%  → expect record_only
 *   Round  4    : price jumps to 4.9%         → expect trigger_alert (spike)
 *   Rounds 5–6  : price stays elevated ~4.5%  → expect record_only (no repeat alert)
 *   Round  7    : price drops sharply to 1.8% → expect trigger_alert (reversal)
 *   Rounds 8–9  : price recovers to ~2.0%     → expect record_only
 *
 * Run:
 *   npx tsx src/test-alert.ts
 */
import 'dotenv/config'
import { alertOnAnomaly, type AlertState, type AlertCycleResult } from './alert.js'

// ─── Synthetic price series ───────────────────────────────────────────────────

const PRICE_SERIES = [
  // stable baseline
  0.015, 0.0152, 0.0155, 0.0153,
  // spike: +3.4 pp jump → trigger_alert expected
  0.049,
  // elevated, no reversal yet → record_only
  0.047, 0.045,
  // sharp drop back → trigger_alert expected
  0.018,
  // recovery → record_only
  0.019, 0.020,
]

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[test-alert] ══════════════════════════════════════════════')
  console.log('[test-alert] 10-round alertOnAnomaly() simulation')
  console.log(`[test-alert] model  : ${process.env.LLM_MODEL ?? '(LLM_MODEL not set)'}`)
  console.log(`[test-alert] apiBase: ${process.env.LLM_BASE_URL ?? '(LLM_BASE_URL not set)'}`)
  console.log('[test-alert] ══════════════════════════════════════════════\n')

  let state: AlertState = { lastAlertedAt: null }

  // Build a rolling history window: each round sees all previous prices
  const rollingHistory: number[] = []

  for (let round = 0; round < PRICE_SERIES.length; round++) {
    const price = PRICE_SERIES[round]!
    rollingHistory.push(price)

    const delta =
      rollingHistory.length > 1
        ? ((rollingHistory.at(-1)! - rollingHistory[0]!) * 100).toFixed(2)
        : '0.00'

    console.log(
      `[test-alert] ── round ${round + 1}/10  ` +
        `price=${(price * 100).toFixed(2)}%  ` +
        `Δ=${delta}pp  ` +
        `history_len=${rollingHistory.length}` +
        (state.lastAlertedAt
          ? `  lastAlert=${state.lastAlertedAt.toISOString().slice(11, 19)}`
          : ''),
    )

    const cycleResult: AlertCycleResult = await alertOnAnomaly(
      process.env.POLYMARKET_TOKEN_ID ?? 'test-token-id',
      process.env.MARKET_QUESTION ?? 'Test market',
      price,
      [...rollingHistory],
      state,
    )
    state = cycleResult.state

    console.log() // blank line between rounds
  }

  console.log('[test-alert] ══════════════════════════════════════════════')
  console.log('[test-alert] simulation complete')
  console.log(
    `[test-alert] final state: lastAlertedAt=${state.lastAlertedAt?.toISOString() ?? 'null'}`,
  )
  // suppress unused import lint
  void (undefined as unknown as AlertCycleResult)
}

main().catch((err) => {
  console.error('[test-alert] fatal:', err)
  process.exit(1)
})
