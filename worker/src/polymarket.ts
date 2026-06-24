/**
 * Fetches the current mid-price (probability) for a configured Polymarket CLOB token.
 *
 * Uses axios so that the HTTPS_PROXY environment variable is automatically respected
 * (avoids redirect bugs present in the @polymarket/clob-client SDK).
 *
 * Endpoint docs: https://docs.polymarket.com/#get-midpoint
 *
 * Rate-limit behaviour:
 *   - HTTP 429 → sets a 5-minute module-level backoff; all calls within that window
 *     are skipped immediately without making a network request.
 *   - Any other transient error → 1 retry with 1 s + random jitter via withRetry().
 */
import axios, { AxiosError } from 'axios'
import { withRetry } from './retry.js'

const CLOB_BASE = process.env.POLYMARKET_API_HOST ?? 'https://clob.polymarket.com'
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000 // 5 minutes

/** Epoch ms until which all fetch calls must be skipped due to a 429 response. */
let rateLimitBackoffUntilMs = 0

async function doFetch(tokenId: string): Promise<number> {
  const url = `${CLOB_BASE}/midpoint?token_id=${encodeURIComponent(tokenId)}`
  let res
  try {
    res = await axios.get<{ mid: string }>(url, { timeout: 10_000 })
  } catch (err) {
    // Detect 429 before re-throwing so withRetry can still catch it for logging,
    // but we set the backoff flag here so it takes effect on the *next* outer call.
    if (err instanceof AxiosError && err.response?.status === 429) {
      rateLimitBackoffUntilMs = Date.now() + RATE_LIMIT_BACKOFF_MS
      const until = new Date(rateLimitBackoffUntilMs).toISOString()
      console.warn(
        `[polymarket] HTTP 429 received — entering 5-minute backoff (until ${until}). ` +
          'All poll cycles within this window will be skipped.',
      )
      // Re-throw a plain Error so withRetry logs it and stops retrying.
      // (Retrying a 429 immediately would just get another 429.)
      throw new Error('HTTP 429 rate-limited')
    }
    throw err
  }

  const mid = parseFloat(res.data.mid)
  if (isNaN(mid)) {
    throw new Error(`Invalid midpoint response: ${JSON.stringify(res.data)}`)
  }
  return mid
}

/**
 * Returns a probability in [0, 1] for the given market token.
 *
 * @param tokenId  CLOB token ID to fetch. Falls back to POLYMARKET_TOKEN_ID env var if omitted.
 *
 * Immediately skips (throws) if still inside a 429 backoff window.
 * Otherwise tries up to 2 times (1 retry) with jittered delay.
 */
export async function fetchMarketProbability(tokenId?: string): Promise<number> {
  // Fast-exit during backoff — no network request made.
  if (Date.now() < rateLimitBackoffUntilMs) {
    const remainingSec = Math.ceil((rateLimitBackoffUntilMs - Date.now()) / 1_000)
    console.warn(
      `[polymarket] in rate-limit backoff, skipping this cycle (${remainingSec}s remaining)`,
    )
    throw new Error('rate-limit backoff active')
  }

  const id = tokenId ?? process.env.POLYMARKET_TOKEN_ID
  if (!id) throw new Error('tokenId must be provided or POLYMARKET_TOKEN_ID must be set in .env')

  return withRetry(() => doFetch(id), {
    label: '[polymarket]',
    attempts: 2,
    baseDelayMs: 1_000,
    jitterMs: 500,
  })
}
