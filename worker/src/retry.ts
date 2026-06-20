/**
 * Shared retry utility for all external calls (HTTP / RPC / LLM).
 * No external dependencies — plain setTimeout + console.
 *
 * Usage:
 *   const result = await withRetry(() => doSomething(), { label: '[polymarket]' })
 */

export interface RetryOptions {
  /** Total attempts including the first one (default: 2 → 1 retry). */
  attempts?: number
  /** Base delay before each retry in ms (default: 1000). */
  baseDelayMs?: number
  /** Extra random jitter in ms added on top of baseDelayMs (default: 500). */
  jitterMs?: number
  /** Module label used in every log line, e.g. '[polymarket]'. */
  label: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Run `fn` up to `opts.attempts` times.
 * - Logs a warn with context on every failure.
 * - Waits baseDelayMs + rand(0, jitterMs) between attempts.
 * - Throws the last error after all attempts are exhausted (caller decides whether to skip).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 2, baseDelayMs = 1_000, jitterMs = 500, label }: RetryOptions,
): Promise<T> {
  let lastErr: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const isLast = i === attempts - 1

      if (isLast) {
        console.warn(`${label} all ${attempts} attempt(s) exhausted — skipping. Last error: ${msg}`)
      } else {
        const delay = baseDelayMs + Math.random() * jitterMs
        console.warn(
          `${label} attempt ${i + 1}/${attempts} failed (${msg}), ` +
            `retrying in ${Math.round(delay)} ms…`,
        )
        await sleep(delay)
      }
    }
  }

  throw lastErr
}
