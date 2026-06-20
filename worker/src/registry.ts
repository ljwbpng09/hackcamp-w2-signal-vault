/**
 * On-chain snapshot anchoring via viem.
 *
 * Calls SnapshotRegistry.anchor(bytes32 dataHash, string label) on Sepolia testnet.
 * The dataHash is keccak256 of the UTF-8 JSON of the snapshot object — an
 * unforgeable content fingerprint stored permanently on-chain.
 *
 * RED LINE: SEPOLIA_RPC must never point to a mainnet endpoint.
 */
import {
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toHex,
  type Hash,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// ─── ABI (matches the deployed SnapshotRegistry.sol exactly) ─────────────────

const REGISTRY_ABI = parseAbi([
  'function anchor(bytes32 dataHash, string calldata label) external',
  'event SnapshotAnchored(address indexed reporter, bytes32 dataHash, string label, uint256 timestamp)',
])

const ETHERSCAN = 'https://sepolia.etherscan.io/tx'

// ─── Client factory ───────────────────────────────────────────────────────────

function buildWalletClient() {
  const raw = process.env.WALLET_PRIVATE_KEY ?? ''
  if (!raw || raw === '0x...' || raw.length < 10) {
    throw new Error('WALLET_PRIVATE_KEY is not set or is still the placeholder value')
  }
  const privateKey = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
  const account = privateKeyToAccount(privateKey)
  const rpc = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'
  return createWalletClient({ account, chain: sepolia, transport: http(rpc) })
}

// ─── Hash helper ──────────────────────────────────────────────────────────────

/**
 * Returns keccak256( UTF-8 bytes of JSON.stringify(obj) ) as a bytes32 hex string.
 * Deterministic: the same object always produces the same hash.
 */
export function hashSnapshot(obj: unknown): `0x${string}` {
  return keccak256(toHex(JSON.stringify(obj)))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Anchor a snapshot object on Sepolia by calling SnapshotRegistry.anchor().
 *
 * @param snapshotObject - Any JSON-serialisable value (snapshot, alert, etc.)
 * @param label          - Short human-readable tag, e.g. "wc-alert" or "hourly-snapshot"
 * @returns Transaction hash, or null on failure (never throws).
 */
export async function anchor(snapshotObject: unknown, label: string): Promise<Hash | null> {
  const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!contractAddress || contractAddress === '0x...') {
    console.warn('[registry] CONTRACT_ADDRESS not set — skipping anchor')
    return null
  }

  let walletClient: ReturnType<typeof buildWalletClient>
  try {
    walletClient = buildWalletClient()
  } catch (err) {
    console.warn('[registry] wallet setup failed, skipping anchor:', (err as Error).message)
    return null
  }

  const dataHash = hashSnapshot(snapshotObject)

  try {
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi: REGISTRY_ABI,
      functionName: 'anchor',
      args: [dataHash, label],
    })
    console.log(`[registry] anchored on Sepolia ✓`)
    console.log(`[registry] ${ETHERSCAN}/${hash}`)
    return hash
  } catch (err) {
    console.warn('[registry] anchor() tx failed:', (err as Error).message)
    return null
  }
}

/**
 * Convenience wrapper called by the alert pipeline in index.ts.
 * Builds a structured payload and delegates to anchor().
 */
export async function onAlert(
  marketId: string,
  probability: number,
  reason: string,
): Promise<void> {
  const payload = {
    marketId,
    probability,
    reason,
    ts: new Date().toISOString(),
  }
  await anchor(payload, 'wc-alert')
}
