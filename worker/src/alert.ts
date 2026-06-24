/**
 * alertOnAnomaly — World Cup price-anomaly decision scenario.
 *
 * Uses decide() with two tools:
 *   - trigger_alert: makes a directional prediction on-chain (PredictionMade)
 *                    + sends TG notification
 *   - record_only:   console.log only, no side effects
 *
 * On trigger_alert, the prediction is pushed to `pendingPredictions`.
 * settler.ts reads that array and calls settlePrediction() ~10 min later.
 *
 * Never throws. All LLM / chain failures are caught internally.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions.js'
import { decide } from './llm.js'
import { makePrediction } from './registry.js'
import { sendTGAlert, type SendTGAlertOpts } from './notify.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlertState {
  /** Timestamp of the last trigger_alert — suppresses repeat firing. */
  lastAlertedAt: Date | null
}

export interface AlertCycleResult {
  state: AlertState
  /** true if trigger_alert fired this cycle */
  triggered: boolean
  /** Etherscan URL of the PredictionMade TX, if mined */
  txUrl?: string
}

export interface PendingPrediction {
  /** Stable local ID (used before on-chain ID is known). */
  localId: string
  /** On-chain prediction ID returned by makePrediction(). null = tx failed. */
  onChainId: bigint | null
  /** CLOB token ID — needed by settler to match the correct current price. */
  tokenId: string
  market: string
  probAtAlert: number
  direction: 'UP' | 'DOWN'
  targetProbPct: number | null
  urgency: 'low' | 'medium' | 'high'
  reason: string
  txHashMake: string | null
  alertedAt: Date
  /** Settle after this timestamp (~10 min after alert). */
  settleAfter: Date
  settled: boolean
  /** Filled in by settler.ts after settlement. */
  probAtSettle?: number
  correct?: boolean
  txHashSettle?: string
  settledAt?: Date
}

// ─── Module-level pending predictions (read by settler.ts) ───────────────────

/**
 * Predictions waiting for settlement. Exported so settler.ts can iterate and
 * call settlePrediction() once their deadline has passed.
 * Lives in memory — a worker restart loses pending predictions (acceptable for demo).
 */
export const pendingPredictions: PendingPrediction[] = []

let localIdCounter = 0

// ─── Tool definitions ────────────────────────────────────────────────────────

const ALERT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'trigger_alert',
      description:
        'Fire when a genuine price anomaly is detected and you have high confidence ' +
        'the market is temporarily mis-priced. Makes a directional prediction on-chain. ' +
        'Cost: gas + user attention. Use sparingly.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'One sentence: what moved, by how much, and the most plausible cause.',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description:
              'low = worth watching, medium = act within minutes, high = act immediately.',
          },
          direction: {
            type: 'string',
            enum: ['UP', 'DOWN'],
            description:
              'Predicted direction of price movement over the next 10 minutes. ' +
              'UP = price will continue rising; DOWN = price will fall back.',
          },
          targetProbPct: {
            type: 'number',
            description:
              'Your estimated market probability (%) after 10 minutes. ' +
              'e.g. if current is 4.90% and you predict UP, maybe 5.5.',
          },
        },
        required: ['reason', 'urgency', 'direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_only',
      description:
        'Normal market movement — no actionable edge detected. ' +
        'Logs observation locally. No notification, no on-chain write.',
      parameters: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'One-sentence market observation.',
          },
        },
        required: ['note'],
      },
    },
  },
]

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a quantitative signal analyst for the 2026 FIFA World Cup Polymarket markets.
You monitor live probability data and decide whether each movement represents genuine mispricing worth anchoring on-chain.

This is not a news summariser. Your job is to detect PRICE ANOMALIES — moments where the market
is temporarily wrong relative to observable information.

== Decision Rules ==

Use record_only when:
- Delta over the window is < 3 pp (routine noise)
- The series is monotone with no inflection point (steady drift = market is digesting news, not mispriced)
- You have < 5 data points (too little history)
- You already triggered an alert in the same direction within the last 10 readings (no repeat alerts)

Use trigger_alert when ALL of the following are true:
- Delta over the window is ≥ 3 pp
- The move is non-linear (acceleration visible in the series — convex or concave shape)
- You can name a plausible information source (match result, injury report, lineup news, etc.)
- Magnitude of mis-pricing is ≥ 2 pp (market appears to be under- or over-pricing the outcome)

== Direction guidance ==
- Set direction = UP  if you believe the price spike is genuine and will continue briefly
- Set direction = DOWN if you believe the spike is an overreaction and will revert
- targetProbPct is your best estimate of where the market will trade in ~10 minutes

== Urgency ==
- high:   sudden spike ≥ 8 pp, likely breaking news
- medium: steady anomaly 3–8 pp with plausible cause
- low:    borderline signal, worth logging but not urgent

== Cost of errors ==
- False positive (trigger_alert when nothing happened): wastes gas, erodes trust. Heavily penalised.
- False negative (record_only when real signal): acceptable. Err on this side.

Be terse. One sentence for reason. No narrative padding.`

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Run one decision cycle for the anomaly-alert scenario.
 *
 * @param tokenId      CLOB token ID of the market being monitored
 * @param question     Human-readable market question (e.g. "Will France win…")
 * @param currentPrice Latest probability [0, 1]
 * @param recentPrices Last ~60 prices (1 h at 60 s intervals), newest last
 * @param state        Mutable alert state (lastAlertedAt)
 * @returns AlertCycleResult — updated state + whether an alert fired + optional TX URL
 */
export async function alertOnAnomaly(
  tokenId: string,
  question: string,
  currentPrice: number,
  recentPrices: number[],
  state: AlertState,
): Promise<AlertCycleResult> {
  const deltaOverWindow =
    recentPrices.length > 1
      ? parseFloat(((recentPrices.at(-1)! - recentPrices[0]!) * 100).toFixed(3))
      : 0

  const minutesSinceLastAlert =
    state.lastAlertedAt !== null
      ? Math.floor((Date.now() - state.lastAlertedAt.getTime()) / 60_000)
      : null

  const result = await decide({
    scenario: 'wc-anomaly-alert',
    currentData: {
      market: question,
      tokenId: tokenId.slice(0, 16) + '…',
      currentProbPct: parseFloat((currentPrice * 100).toFixed(3)),
    },
    history: recentPrices.map((p, i) => ({
      i,
      pct: parseFloat((p * 100).toFixed(3)),
    })),
    status: {
      lastAlertedAt: state.lastAlertedAt?.toISOString() ?? null,
      minutesSinceLastAlert,
      windowSize: recentPrices.length,
      deltaOverWindowPp: deltaOverWindow,
    },
    systemPrompt: SYSTEM_PROMPT,
    tools: ALERT_TOOLS,
    handlers: {
      trigger_alert: async (args) => {
        const urgency = (args['urgency'] as 'low' | 'medium' | 'high') ?? 'medium'
        const reason = (args['reason'] as string) ?? '(no reason provided)'
        const direction = (args['direction'] as 'UP' | 'DOWN') ?? 'UP'
        const targetProbPct = (args['targetProbPct'] as number | undefined) ?? null

        const alertedAt = new Date()
        const settleAfter = new Date(alertedAt.getTime() + 10 * 60_000)
        const localId = `alert-${++localIdCounter}-${alertedAt.getTime()}`
        const market = question

        // Build payload for on-chain hash + off-chain storage
        const payload = {
          localId,
          market,
          tokenId: tokenId.slice(0, 16),
          probability: currentPrice,
          deltaOverWindowPp: deltaOverWindow,
          direction,
          targetProbPct,
          reason,
          urgency,
          ts: alertedAt.toISOString(),
        }

        // ── On-chain: makePrediction() ────────────────────────────────────────
        const onChainId = await makePrediction({
          snapshotObject: payload,
          market: market.slice(0, 64),
          direction,
          probAtAlert: currentPrice,
          deadlineMs: settleAfter.getTime(),
        })

        const txUrl = onChainId !== null
          ? undefined // txHash comes from registry log; we reference by onChainId
          : undefined

        // ── Register pending prediction for settler.ts ────────────────────────
        const pending: PendingPrediction = {
          localId,
          onChainId,
          tokenId,
          market,
          probAtAlert: currentPrice,
          direction,
          targetProbPct,
          urgency,
          reason,
          txHashMake: null,
          alertedAt,
          settleAfter,
          settled: false,
        }
        pendingPredictions.push(pending)

        // ── Telegram message — spec template ──────────────────────────────────
        const dirArrow = direction === 'UP' ? '▲' : '▼'
        const changeStr = `${deltaOverWindow > 0 ? '+' : ''}${deltaOverWindow}`
        const targetStr = targetProbPct !== null ? ` → ~${targetProbPct.toFixed(1)}% in 10 min` : ''
        const onChainStr = onChainId !== null
          ? `[Etherscan #${onChainId}](https://sepolia.etherscan.io/address/${process.env.CONTRACT_ADDRESS ?? ''})`
          : '_chain write failed_'

        const message = `
*🚨 ${urgency.toUpperCase()} Market Alert*
*Token:* \`${tokenId.slice(0, 16)}…\`
*Change:* ${changeStr} pp in window
*Current:* ${(currentPrice * 100).toFixed(2)}%  ${dirArrow} ${direction}${targetStr}
*Reason:* ${reason}
*On-chain:* ${onChainStr}

[View on Polymarket](https://polymarket.com/event/2026-fifa-world-cup-winner)
`.trim()

        const tgOpts: SendTGAlertOpts = {
          dedupeKey: `alert:${tokenId.slice(0, 12)}:${direction}`,
          dedupeWindowMs: 30 * 60_000,
          extra: {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📊 Dashboard', url: 'https://signal-vault.vercel.app' },
                  { text: '🔇 Mute 1h',   callback_data: 'mute_60' },
                ],
              ],
            },
          },
        }

        await sendTGAlert(message, tgOpts)

        return { onChainId: onChainId?.toString(), txUrl }
      },

      record_only: async (args) => {
        console.log('[alert] record_only:', args['note'])
        return {}
      },
    },
  })

  const triggered = result.action === 'trigger_alert'
  return {
    state: {
      lastAlertedAt: triggered ? new Date() : state.lastAlertedAt,
    },
    triggered,
    txUrl: (result.args['txUrl'] as string | undefined),
  }
}
