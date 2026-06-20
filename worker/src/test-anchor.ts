/**
 * One-shot smoke test for registry.ts → SnapshotRegistry.anchor() on Base Sepolia.
 *
 * Run:
 *   npx tsx src/test-anchor.ts
 *
 * Prerequisites (.env must have):
 *   WALLET_PRIVATE_KEY=0x<your Base Sepolia test wallet key>
 *   CONTRACT_ADDRESS=0xB1908acE5A0B4879675c405375E6720a07851c5c
 *   BASE_SEPOLIA_RPC=https://sepolia.base.org   (or your Alchemy/Infura URL)
 */
import 'dotenv/config'
import { anchor, hashSnapshot } from './registry.js'

const TEST_PAYLOAD = {
  market: 'Will Mexico win the 2026 FIFA World Cup?',
  tokenId: process.env.POLYMARKET_TOKEN_ID ?? 'unknown',
  probability: 0.0155,
  timestamp: new Date().toISOString(),
  _test: true,
}

async function main(): Promise<void> {
  console.log('[test-anchor] payload:', TEST_PAYLOAD)
  console.log('[test-anchor] dataHash:', hashSnapshot(TEST_PAYLOAD))
  console.log('[test-anchor] calling anchor()…')

  const hash = await anchor(TEST_PAYLOAD, 'test-smoke')

  if (hash) {
    console.log('\n[test-anchor] ✅ SUCCESS')
    console.log(`[test-anchor] TX: https://sepolia.etherscan.io/tx/${hash}`)
  } else {
    console.error('\n[test-anchor] ❌ anchor() returned null — check warnings above')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[test-anchor] fatal:', err)
  process.exit(1)
})
