/**
 * Fetches the current mid-price (probability) for a configured Polymarket CLOB token.
 *
 * Uses axios so that the HTTPS_PROXY environment variable is automatically respected
 * (avoids redirect bugs present in the @polymarket/clob-client SDK).
 *
 * Endpoint docs: https://docs.polymarket.com/#get-midpoint
 */
import axios from 'axios'

const CLOB_BASE = 'https://clob.polymarket.com'

function getTokenId(): string {
  const id = process.env.POLYMARKET_TOKEN_ID
  if (!id) throw new Error('POLYMARKET_TOKEN_ID is not set in .env')
  return id
}

async function doFetch(tokenId: string): Promise<number> {
  const url = `${CLOB_BASE}/midpoint?token_id=${encodeURIComponent(tokenId)}`
  const res = await axios.get<{ mid: string }>(url, { timeout: 10_000 })
  const mid = parseFloat(res.data.mid)
  if (isNaN(mid)) throw new Error(`Invalid midpoint response: ${JSON.stringify(res.data)}`)
  return mid
}

/**
 * Returns a probability in [0, 1] for the configured market token.
 * Retries once before throwing.
 */
export async function fetchMarketProbability(): Promise<number> {
  const tokenId = getTokenId()
  try {
    return await doFetch(tokenId)
  } catch (firstErr) {
    console.warn('[polymarket] first attempt failed, retrying in 2 s…', (firstErr as Error).message)
    await new Promise((r) => setTimeout(r, 2_000))
    try {
      return await doFetch(tokenId)
    } catch (secondErr) {
      console.warn('[polymarket] second attempt also failed, skipping cycle', (secondErr as Error).message)
      throw secondErr
    }
  }
}
