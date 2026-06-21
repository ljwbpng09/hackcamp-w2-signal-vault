/**
 * settler.ts — background prediction settlement loop.
 *
 * Called from doPoll() every cycle. Checks pendingPredictions from alert.ts,
 * finds any whose deadline has passed, fetches the current market price,
 * calls settlePrediction() on-chain, and updates snapshot.json's alerts[].
 *
 * Never throws. All failures are caught and logged.
 */
import { pendingPredictions, type PendingPrediction } from './alert.js'
import { settlePrediction } from './registry.js'
import { sendTGAlert, botState } from './notify.js'

// ─── Public types (re-exported so index.ts can use them in SnapshotFile) ─────

export interface AlertRecord {
  localId: string
  onChainId: number | null
  market: string
  probAtAlert: number       // [0, 1]
  direction: 'UP' | 'DOWN'
  targetProbPct: number | null
  urgency: 'low' | 'medium' | 'high'
  reason: string
  alertedAt: string         // ISO
  settleAfter: string       // ISO
  settled: boolean
  probAtSettle?: number     // [0, 1] — filled after settlement
  correct?: boolean
  txHashSettle?: string
  settledAt?: string        // ISO
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a PendingPrediction to a snapshot-safe AlertRecord. */
export function toAlertRecord(p: PendingPrediction): AlertRecord {
  return {
    localId: p.localId,
    onChainId: p.onChainId !== null ? Number(p.onChainId) : null,
    market: p.market,
    probAtAlert: p.probAtAlert,
    direction: p.direction,
    targetProbPct: p.targetProbPct,
    urgency: p.urgency,
    reason: p.reason,
    alertedAt: p.alertedAt.toISOString(),
    settleAfter: p.settleAfter.toISOString(),
    settled: p.settled,
    ...(p.probAtSettle !== undefined ? { probAtSettle: p.probAtSettle } : {}),
    ...(p.correct !== undefined ? { correct: p.correct } : {}),
    ...(p.txHashSettle ? { txHashSettle: p.txHashSettle } : {}),
    ...(p.settledAt ? { settledAt: p.settledAt.toISOString() } : {}),
  }
}

// ─── checkSettlements ─────────────────────────────────────────────────────────

/**
 * Check all pending predictions. For each one whose deadline has passed,
 * settle it on-chain with the current market price and send a TG result message.
 *
 * @param currentPrice Latest market probability [0, 1]
 */
export async function checkSettlements(currentPrice: number): Promise<void> {
  const now = new Date()

  const due = pendingPredictions.filter(
    (p) => !p.settled && p.settleAfter <= now,
  )

  if (due.length === 0) return

  console.log(`[settler] ${due.length} prediction(s) due for settlement`)

  for (const prediction of due) {
    await settle(prediction, currentPrice)
  }
}

async function settle(p: PendingPrediction, currentPrice: number): Promise<void> {
  p.settled = true // mark immediately to avoid double-settlement
  p.probAtSettle = currentPrice
  p.settledAt = new Date()

  // Determine correctness locally (mirrors the contract logic)
  if (p.direction === 'UP') {
    p.correct = currentPrice > p.probAtAlert
  } else {
    p.correct = currentPrice < p.probAtAlert
  }

  const resultEmoji = p.correct ? '✅' : '❌'

  console.log(
    `[settler] prediction ${p.localId}  ` +
      `dir=${p.direction}  ` +
      `atAlert=${(p.probAtAlert * 100).toFixed(2)}%  ` +
      `atSettle=${(currentPrice * 100).toFixed(2)}%  ` +
      `${resultEmoji} ${p.correct ? 'CORRECT' : 'WRONG'}`,
  )

  // ── On-chain settlement ───────────────────────────────────────────────────
  if (p.onChainId !== null) {
    try {
      const txHash = await settlePrediction({
        onChainId: p.onChainId,
        actualProb: currentPrice,
      })
      if (txHash) p.txHashSettle = txHash
    } catch (err) {
      console.warn('[settler] settlePrediction() error:', (err as Error).message)
    }
  } else {
    console.warn(`[settler] prediction ${p.localId} has no on-chain ID — skipping on-chain settlement`)
  }

  // ── Track Record stats ────────────────────────────────────────────────────
  const total = pendingPredictions.filter((x) => x.settled && x.correct !== undefined).length
  const correct = pendingPredictions.filter((x) => x.settled && x.correct === true).length
  const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : '—'

  // ── Update botState ───────────────────────────────────────────────────────
  if (p.txHashSettle) {
    botState.lastTxUrl = `https://sepolia.etherscan.io/tx/${p.txHashSettle}`
  }

  // ── Telegram: settlement result ───────────────────────────────────────────
  const settleTxLine = p.txHashSettle
    ? `[Settlement TX](https://sepolia.etherscan.io/tx/${p.txHashSettle})`
    : ''

  const message = `
${resultEmoji} *Prediction Settled* [#${p.onChainId ?? p.localId}]
*Market:* ${p.market}
*Predicted:* ${p.direction}  (at ${(p.probAtAlert * 100).toFixed(2)}%)
*Actual:*    ${(currentPrice * 100).toFixed(2)}%
*Result:* ${p.correct ? 'CORRECT ✓' : 'WRONG ✗'}
*AI Track Record:* ${correct}/${total} = ${accuracy}%
${settleTxLine}
`.trim()

  await sendTGAlert(message, {
    dedupeKey: `settle:${p.localId}`,
  })
}
