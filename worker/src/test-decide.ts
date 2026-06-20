/**
 * One-shot smoke test for decide() + checkAlert().
 *
 * Uses hardcoded data simulating a significant World Cup market shift:
 *   probability rises from 1.5% to 6.8% (delta +5.3 pp) in 10 readings.
 *
 * Run:
 *   npx tsx src/test-decide.ts
 */
import 'dotenv/config'
import { decide, checkAlert } from './llm.js'
import type { ChatCompletionTool } from 'openai/resources/chat/completions.js'

// ─── Simulated data ───────────────────────────────────────────────────────────

// Probability series: flat then spike (simulates a news leak or large order)
const FAKE_PROBS = [0.015, 0.015, 0.016, 0.015, 0.017, 0.022, 0.035, 0.051, 0.063, 0.068]

// ─── Test 1: generic decide() with a custom tool ─────────────────────────────

async function testDecide(): Promise<void> {
  console.log('\n══════════════════════════════════════════')
  console.log('TEST 1 — generic decide() with custom tool')
  console.log('══════════════════════════════════════════')

  const tools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'flag_anomaly',
        description: 'Flag a detected probability anomaly with a short description.',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'One-sentence summary of the anomaly.' },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['summary', 'severity'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'no_action',
        description: 'No anomaly detected — market is behaving normally.',
        parameters: {
          type: 'object',
          properties: { note: { type: 'string' } },
          required: ['note'],
        },
      },
    },
  ]

  const result = await decide({
    scenario: 'test-anomaly-detection',
    currentData: {
      market: 'Will Mexico win the 2026 FIFA World Cup?',
      latestProb: FAKE_PROBS.at(-1),
      delta10: parseFloat(((FAKE_PROBS.at(-1)! - FAKE_PROBS[0]!) * 100).toFixed(2)),
    },
    history: FAKE_PROBS.map((p, i) => ({ tick: i, prob: p })),
    status: { budgetRemaining: 100, gasUsedToday: 0 },
    systemPrompt:
      'You are a market anomaly detector. ' +
      'Call flag_anomaly if probability rose or fell more than 2 pp in the window. ' +
      'Call no_action otherwise.',
    tools,
    handlers: {
      flag_anomaly: async (args) => {
        console.log(`[test] flag_anomaly fired → severity=${args['severity']}, summary="${args['summary']}"`)
        return {}
      },
      no_action: async (args) => {
        console.log(`[test] no_action fired → note="${args['note']}"`)
        return {}
      },
    },
  })

  console.log('\n[test] decide() result:', result)
}

// ─── Test 2: checkAlert() (World Cup wrapper) ─────────────────────────────────

async function testCheckAlert(): Promise<void> {
  console.log('\n══════════════════════════════════════════')
  console.log('TEST 2 — checkAlert() World Cup wrapper')
  console.log('══════════════════════════════════════════')

  console.log(`[test] feeding ${FAKE_PROBS.length} probability readings to checkAlert()`)
  console.log(`[test] series: ${FAKE_PROBS.map((p) => (p * 100).toFixed(1) + '%').join(' → ')}`)
  console.log(`[test] delta: +${((FAKE_PROBS.at(-1)! - FAKE_PROBS[0]!) * 100).toFixed(1)} pp\n`)

  const alertResult = await checkAlert(FAKE_PROBS)

  console.log('\n[test] checkAlert() result:', alertResult)
  if (alertResult.isAlert) {
    console.log('[test] ✅ Alert triggered')
  } else {
    console.log('[test] ℹ️  No alert (noop or log_observation)')
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[test-decide] starting — model:', process.env.LLM_MODEL ?? '(LLM_MODEL not set)')
  console.log('[test-decide] baseURL:', process.env.LLM_BASE_URL ?? '(LLM_BASE_URL not set)')

  await testDecide()
  await testCheckAlert()

  console.log('\n[test-decide] done')
}

main().catch((err) => {
  console.error('[test-decide] fatal:', err)
  process.exit(1)
})
