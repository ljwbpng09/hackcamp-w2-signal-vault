/**
 * LLM-based alert detection (D2 TODO).
 *
 * Uses the OpenAI-compatible client pointed at DeepSeek by default.
 * Switch provider by changing LLM_BASE_URL / LLM_MODEL in .env — no code change needed.
 */
import OpenAI from 'openai'

// TODO (D2): Replace placeholder with real implementation.
// Suggested approach:
//   1. Feed the last N probability readings to the model.
//   2. Ask it to identify significant shifts (e.g. >5 pp in 10 min).
//   3. Return { isAlert: true, reason: "..." } when a shift is detected.
//   4. Call onAlert() in registry.ts and notify() in notify.ts on positive result.

export interface AlertResult {
  isAlert: boolean
  reason: string
}

function buildClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LLM_API_KEY ?? '',
    baseURL: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
  })
}

export async function checkAlert(probabilities: number[]): Promise<AlertResult> {
  // Silence unused-variable lint until D2 implementation
  void probabilities
  void buildClient

  // TODO (D2): Implement real LLM call, e.g.:
  // const client = buildClient()
  // const completion = await client.chat.completions.create({
  //   model: process.env.LLM_MODEL ?? 'deepseek-chat',
  //   messages: [
  //     {
  //       role: 'system',
  //       content:
  //         'You are a prediction-market analyst. Detect significant probability shifts. ' +
  //         'Reply with JSON: { "isAlert": boolean, "reason": string }',
  //     },
  //     {
  //       role: 'user',
  //       content: `Recent probabilities (newest last): ${probabilities.join(', ')}`,
  //     },
  //   ],
  //   response_format: { type: 'json_object' },
  // })
  // return JSON.parse(completion.choices[0].message.content ?? '{}') as AlertResult

  console.log('[llm] checkAlert placeholder — implement in D2')
  return { isAlert: false, reason: 'placeholder' }
}
