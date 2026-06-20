/**
 * LLM decision engine — generic decide() + World Cup checkAlert() wrapper.
 *
 * Provider: OpenAI-compatible (default MiniMax). Switch by editing .env:
 *   LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
 *
 * decide() is the core single-turn tool-calling loop:
 *   scenario + data + history + status → LLM → tool_call → handler → DecideResult
 *
 * Only trigger_alert handlers call anchor() to log on-chain.
 * All other actions are logged locally only.
 */
import OpenAI from 'openai'
import type { ChatCompletionTool } from 'openai/resources/chat/completions.js'
import { withRetry } from './retry.js'
import { anchor } from './registry.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface HandlerResult {
  txHash?: string
  [key: string]: unknown
}

export interface DecideParams {
  /** Short identifier shown in every log line, e.g. "wc-market-analysis". */
  scenario: string
  /** Current snapshot / tick data. Serialised into the user prompt. */
  currentData: Record<string, unknown>
  /** Recent history array (newest last). Serialised into the user prompt. */
  history: unknown[]
  /** Budget, quota, or any status object the LLM should be aware of. */
  status: Record<string, unknown>
  /** System prompt passed verbatim to the model. */
  systemPrompt: string
  /** OpenAI-format tool definitions. */
  tools: ChatCompletionTool[]
  /** Map of tool name → async handler. Receives parsed arguments object. */
  handlers: Record<string, (args: Record<string, unknown>) => Promise<HandlerResult>>
}

export interface DecideResult {
  /** Name of the tool called, or "noop" if the model chose not to call any tool. */
  action: string
  /** Parsed tool arguments (empty object for noop). */
  args: Record<string, unknown>
  /** TX hash returned by a handler that wrote to the chain, if any. */
  txHash?: string
  /** Wall-clock ms from start of LLM call to handler completion. */
  elapsedMs: number
}

/** Legacy type kept for backward compatibility with index.ts. */
export interface AlertResult {
  isAlert: boolean
  reason: string
}

// ─── Client ───────────────────────────────────────────────────────────────────

function buildClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LLM_API_KEY ?? '',
    baseURL: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
  })
}

// ─── User prompt builder ──────────────────────────────────────────────────────

function buildUserPrompt(
  currentData: Record<string, unknown>,
  history: unknown[],
  status: Record<string, unknown>,
): string {
  return [
    '## Current Data',
    JSON.stringify(currentData, null, 2),
    '',
    `## Recent History (${history.length} entries, newest last)`,
    JSON.stringify(history, null, 2),
    '',
    '## Budget / Status',
    JSON.stringify(status, null, 2),
  ].join('\n')
}

// ─── Core decide() ────────────────────────────────────────────────────────────

/**
 * Single-turn LLM tool-call decision loop.
 *
 * - Sends data to the model with the supplied tools.
 * - Parses the first tool_call from the response.
 * - Dispatches to the matching handler.
 * - Logs a structured JSON line with scenario / action / elapsedMs / args / txHash.
 * - Returns noop (never throws) on any LLM or handler failure.
 */
export async function decide(params: DecideParams): Promise<DecideResult> {
  const { scenario, currentData, history, status, systemPrompt, tools, handlers } = params
  const t0 = Date.now()
  const model = process.env.LLM_MODEL ?? 'deepseek-chat'

  // ── LLM call (1 retry via withRetry) ────────────────────────────────────────
  let completion: OpenAI.Chat.Completions.ChatCompletion
  try {
    const client = buildClient()
    completion = await withRetry(
      () =>
        client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: buildUserPrompt(currentData, history, status) },
          ],
          tools,
          tool_choice: 'auto',
        }),
      { label: '[llm]', attempts: 2, baseDelayMs: 1_000, jitterMs: 500 },
    )
  } catch (err) {
    const elapsedMs = Date.now() - t0
    console.warn('[llm] decide() call failed, returning noop:', (err as Error).message)
    console.log(JSON.stringify({ scenario, action: 'noop', elapsedMs, error: (err as Error).message }))
    return { action: 'noop', args: {}, elapsedMs }
  }

  // ── Parse tool_calls ────────────────────────────────────────────────────────
  const toolCalls = completion.choices[0]?.message?.tool_calls
  if (!toolCalls || toolCalls.length === 0) {
    const elapsedMs = Date.now() - t0
    console.log(JSON.stringify({ scenario, action: 'noop', elapsedMs, reason: 'no tool_calls in response' }))
    return { action: 'noop', args: {}, elapsedMs }
  }

  // Single-round: execute only the first tool call.
  const call = toolCalls[0]!
  const toolName = call.function.name

  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>
  } catch {
    console.warn(`[llm] could not parse arguments for tool "${toolName}", using {}`)
  }

  // ── Dispatch to handler ─────────────────────────────────────────────────────
  const handler = handlers[toolName]
  let handlerResult: HandlerResult = {}
  if (handler) {
    try {
      handlerResult = await handler(args)
    } catch (err) {
      console.warn(`[llm] handler "${toolName}" threw:`, (err as Error).message)
    }
  } else {
    console.warn(`[llm] no handler registered for tool: "${toolName}"`)
  }

  // ── Structured log ─────────────────────────────────────────────────────────
  const elapsedMs = Date.now() - t0
  // Truncate long string values in the summary so the log stays readable.
  const argsSummary = Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v,
    ]),
  )
  console.log(
    JSON.stringify({
      scenario,
      action: toolName,
      elapsedMs,
      args: argsSummary,
      ...(handlerResult.txHash ? { txHash: handlerResult.txHash } : {}),
    }),
  )

  return {
    action: toolName,
    args,
    txHash: handlerResult.txHash,
    elapsedMs,
  }
}

// ─── World Cup tool definitions ───────────────────────────────────────────────

const WC_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'trigger_alert',
      description:
        'Call this when you detect a significant World Cup market shift (≥ 3 pp within the observed window). ' +
        'Triggers an on-chain anchor. Only call when you have genuine signal — false positives cost gas.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'One-sentence explanation of the detected shift and its likely cause.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score 0–1.',
          },
          evScore: {
            type: 'number',
            description:
              'Estimated mis-pricing in probability points. Positive = YES is under-priced vs fair value.',
          },
        },
        required: ['reason', 'confidence', 'evScore'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_observation',
      description:
        'Call this when the market is moving normally — no actionable edge. Logs locally, no on-chain write.',
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

const WC_SYSTEM_PROMPT = `You are a quantitative signal analyst for the 2026 FIFA World Cup Polymarket markets.
You monitor live probability data and decide whether each movement represents genuine mispricing worth anchoring on-chain.

This is not a news summariser. Your job is to detect PRICE ANOMALIES — moments where the market
is temporarily wrong relative to observable information.

== Decision Rules ==

Use log_observation when:
- Delta over the window is < 3 pp (routine noise)
- The series is monotone with no inflection point (steady drift = market is digesting news, not mispriced)
- You have < 5 data points (too little history)
- You already triggered an alert in the same direction within the last 10 readings (no repeat alerts)

Use trigger_alert when ALL of the following are true:
- Delta over the window is ≥ 3 pp
- The move is non-linear (acceleration visible in the series — convex or concave shape)
- You can name a plausible information source (match result, injury report, lineup news, etc.)
- evScore magnitude is ≥ 2 pp (the market appears to be under- or over-pricing the outcome)

== evScore guidance ==
Positive evScore = YES token is under-priced (market hasn't fully priced in a positive development).
Negative evScore = YES token is over-priced (market is over-reacting).
Set evScore = 0 if you genuinely cannot estimate the fair value.

== Cost of errors ==
- False positive (trigger_alert when nothing happened): wastes gas, erodes trust. Heavily penalised.
- False negative (log_observation when real signal): acceptable. Err on this side.

Be terse. One sentence for reason. No narrative padding.`

// ─── checkAlert() — backward-compat wrapper for index.ts ─────────────────────

/**
 * Called by the main poll loop in index.ts.
 * Wraps decide() with World Cup-specific tools and handlers.
 * Anchors on-chain only on trigger_alert.
 */
export async function checkAlert(probabilities: number[]): Promise<AlertResult> {
  if (probabilities.length < 2) {
    return { isAlert: false, reason: 'insufficient data' }
  }

  const latest = probabilities.at(-1) ?? 0
  const oldest = probabilities[0] ?? 0
  const delta = parseFloat((latest - oldest).toFixed(6))

  const result = await decide({
    scenario: 'wc-market-analysis',
    currentData: {
      market: process.env.MARKET_QUESTION ?? 'Unknown',
      tokenId: (process.env.POLYMARKET_TOKEN_ID ?? '').slice(0, 12) + '…',
      latestProbability: latest,
      deltaOverWindow: delta,
      windowSize: probabilities.length,
    },
    history: probabilities.map((p, i) => ({ i, prob: p })),
    status: { pollCycle: new Date().toISOString() },
    systemPrompt: WC_SYSTEM_PROMPT,
    tools: WC_TOOLS,
    handlers: {
      trigger_alert: async (args) => {
        const payload = {
          market: process.env.MARKET_QUESTION,
          probability: latest,
          delta,
          reason: args['reason'],
          evScore: args['evScore'],
          confidence: args['confidence'],
          ts: new Date().toISOString(),
        }
        const txHash = (await anchor(payload, 'wc-alert')) ?? undefined
        return { txHash }
      },
      log_observation: async (args) => {
        console.log('[llm] observation:', args['note'])
        return {}
      },
    },
  })

  return {
    isAlert: result.action === 'trigger_alert',
    reason: (result.args['reason'] as string | undefined) ?? result.action,
  }
}
