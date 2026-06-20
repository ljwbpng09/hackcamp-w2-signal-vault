/**
 * alertOnAnomaly — World Cup price-anomaly decision scenario.
 *
 * Uses decide() with two tools:
 *   - trigger_alert: sends TG notification + anchors payload on-chain
 *   - record_only:   console.log only, no side effects
 *
 * Never throws. All LLM / chain failures are caught internally.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions.js'
import { decide } from './llm.js'
import { anchor } from './registry.js'
import { sendTGAlert } from './notify.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlertState {
  /** Timestamp of the last trigger_alert, used to suppress repeat firing. */
  lastAlertedAt: Date | null
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const ALERT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'trigger_alert',
      description:
        'Fire when a genuine price anomaly is detected and you have high confidence ' +
        'the market is temporarily mis-priced. Triggers a Telegram notification and ' +
        'an on-chain anchor. Cost: gas + user attention. Use sparingly.',
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
        },
        required: ['reason', 'urgency'],
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
 * @param currentPrice Latest probability [0, 1]
 * @param recentPrices Last ~60 prices (1 h at 60 s intervals), newest last
 * @param state        Mutable alert state (lastAlertedAt)
 * @returns Updated AlertState (lastAlertedAt refreshed on trigger_alert)
 */
export async function alertOnAnomaly(
  tokenId: string,
  currentPrice: number,
  recentPrices: number[],
  state: AlertState,
): Promise<AlertState> {
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
      market: process.env.MARKET_QUESTION ?? 'Unknown',
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
        const urgency = (args['urgency'] as string) ?? 'medium'
        const reason = (args['reason'] as string) ?? '(no reason provided)'
        const urgencyEmoji =
          urgency === 'high' ? '🚨' : urgency === 'medium' ? '⚠️' : 'ℹ️'

        // Telegram notification (D4 placeholder falls back to console.log)
        const message = [
          `${urgencyEmoji} *Signal Vault* [${urgency.toUpperCase()}]`,
          `*Market:* ${process.env.MARKET_QUESTION ?? 'Unknown'}`,
          `*Prob:* ${(currentPrice * 100).toFixed(2)}%  (Δ ${deltaOverWindow > 0 ? '+' : ''}${deltaOverWindow} pp)`,
          `*Signal:* ${reason}`,
        ].join('\n')

        await sendTGAlert(message, urgency)

        // On-chain anchor
        const payload = {
          market: process.env.MARKET_QUESTION,
          tokenId: tokenId.slice(0, 16),
          probability: currentPrice,
          deltaOverWindowPp: deltaOverWindow,
          reason,
          urgency,
          ts: new Date().toISOString(),
        }
        const txHash = (await anchor(payload, `wc-${urgency}-alert`)) ?? undefined
        return { txHash }
      },

      record_only: async (args) => {
        console.log('[alert] record_only:', args['note'])
        return {}
      },
    },
  })

  return {
    lastAlertedAt:
      result.action === 'trigger_alert' ? new Date() : state.lastAlertedAt,
  }
}
