/**
 * On-chain interaction via viem — SignalVault.sol on Sepolia testnet.
 *
 * Two-step prediction lifecycle:
 *   makePrediction()   — called when AI triggers an alert (PredictionMade event)
 *   settlePrediction() — called ~10 min later with actual price (PredictionSettled event)
 *
 * Legacy anchor() is kept for backward compatibility with any callers that still use it.
 *
 * RED LINE: SEPOLIA_RPC must never point to a mainnet endpoint.
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  keccak256,
  toHex,
  type Hash,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// ─── ABI ─────────────────────────────────────────────────────────────────────

const SIGNAL_VAULT_ABI = parseAbi([
  // Two-step lifecycle
  'function makePrediction(bytes32 dataHash, string calldata market, string calldata direction, uint256 probAtAlertBps, uint256 deadline) external returns (uint256 id)',
  'function settlePrediction(uint256 id, uint256 actualProbBps) external',
  // Events (for reference / future viem log reading)
  'event PredictionMade(uint256 indexed id, address indexed reporter, bytes32 dataHash, string market, string direction, uint256 probAtAlertBps, uint256 deadline)',
  'event PredictionSettled(uint256 indexed id, bool correct, uint256 actualProbBps)',
  // Legacy anchor() — kept on the old SnapshotRegistry ABI for backward compat
  'function anchor(bytes32 dataHash, string calldata label) external',
])

const ETHERSCAN = 'https://sepolia.etherscan.io/tx'

// ─── Client factory ───────────────────────────────────────────────────────────

function getRpc(): string {
  return process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'
}

function buildWalletClient() {
  const raw = process.env.WALLET_PRIVATE_KEY ?? ''
  if (!raw || raw === '0x...' || raw.length < 10) {
    throw new Error('WALLET_PRIVATE_KEY is not set or is still the placeholder value')
  }
  const privateKey = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
  const account = privateKeyToAccount(privateKey)
  return createWalletClient({ account, chain: sepolia, transport: http(getRpc()) })
}

function buildPublicClient() {
  return createPublicClient({ chain: sepolia, transport: http(getRpc()) })
}

function getContractAddress(): `0x${string}` {
  const addr = process.env.CONTRACT_ADDRESS
  if (!addr || addr === '0x...') {
    throw new Error('CONTRACT_ADDRESS not set or still placeholder')
  }
  return addr as `0x${string}`
}

// ─── Hash helper ──────────────────────────────────────────────────────────────

/**
 * Returns keccak256( UTF-8 bytes of JSON.stringify(obj) ) as a bytes32 hex string.
 * Deterministic: the same object always produces the same hash.
 */
export function hashSnapshot(obj: unknown): `0x${string}` {
  return keccak256(toHex(JSON.stringify(obj)))
}

// ─── makePrediction ───────────────────────────────────────────────────────────

export interface MakePredictionParams {
  /** Any JSON-serialisable payload — hashed and stored off-chain in snapshot.json */
  snapshotObject: unknown
  /** Short market label shown in Etherscan (≤ 64 chars) */
  market: string
  /** Predicted price movement direction */
  direction: 'UP' | 'DOWN'
  /** Probability at alert time [0, 1] — converted to basis points internally */
  probAtAlert: number
  /** Unix ms timestamp: settlePrediction() is valid after this */
  deadlineMs: number
}

/**
 * Write a new prediction on-chain.
 * @returns on-chain prediction ID (bigint), or null on failure (never throws)
 */
export async function makePrediction(params: MakePredictionParams): Promise<bigint | null> {
  const { snapshotObject, market, direction, probAtAlert, deadlineMs } = params

  let contractAddress: `0x${string}`
  let walletClient: ReturnType<typeof buildWalletClient>
  try {
    contractAddress = getContractAddress()
    walletClient = buildWalletClient()
  } catch (err) {
    console.warn('[registry] setup failed, skipping makePrediction:', (err as Error).message)
    return null
  }

  const dataHash = hashSnapshot(snapshotObject)
  const probAtAlertBps = BigInt(Math.round(probAtAlert * 10_000))
  const deadlineSec = BigInt(Math.floor(deadlineMs / 1_000))

  try {
    const publicClient = buildPublicClient()
    // simulateContract returns the on-chain return value (prediction ID) before writing.
    const { result: onChainId, request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: contractAddress,
      abi: SIGNAL_VAULT_ABI,
      functionName: 'makePrediction',
      args: [dataHash, market, direction, probAtAlertBps, deadlineSec],
    })
    const hash = await walletClient.writeContract(request)
    console.log(`[registry] PredictionMade ✓  id=${onChainId}  dir=${direction}  prob=${(probAtAlert * 100).toFixed(2)}%`)
    console.log(`[registry] ${ETHERSCAN}/${hash}`)
    return onChainId as bigint
  } catch (err) {
    console.warn('[registry] makePrediction() tx failed:', (err as Error).message)
    return null
  }
}

// ─── settlePrediction ─────────────────────────────────────────────────────────

export interface SettlePredictionParams {
  /** On-chain prediction ID returned from makePrediction() event (stored locally) */
  onChainId: bigint
  /** Actual market probability at settlement time [0, 1] */
  actualProb: number
}

/**
 * Settle a prediction once the deadline has passed.
 * @returns TX hash or null on failure (never throws)
 */
export async function settlePrediction(params: SettlePredictionParams): Promise<Hash | null> {
  const { onChainId, actualProb } = params

  let contractAddress: `0x${string}`
  let walletClient: ReturnType<typeof buildWalletClient>
  try {
    contractAddress = getContractAddress()
    walletClient = buildWalletClient()
  } catch (err) {
    console.warn('[registry] setup failed, skipping settlePrediction:', (err as Error).message)
    return null
  }

  const actualProbBps = BigInt(Math.round(actualProb * 10_000))

  try {
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi: SIGNAL_VAULT_ABI,
      functionName: 'settlePrediction',
      args: [onChainId, actualProbBps],
    })
    console.log(`[registry] PredictionSettled ✓  id=${onChainId}  actualProb=${(actualProb * 100).toFixed(2)}%`)
    console.log(`[registry] ${ETHERSCAN}/${hash}`)
    return hash
  } catch (err) {
    console.warn('[registry] settlePrediction() tx failed:', (err as Error).message)
    return null
  }
}

// ─── Legacy anchor() — backward compat ───────────────────────────────────────

/**
 * @deprecated Use makePrediction() for new code.
 * Kept so any code still calling anchor() doesn't break.
 */
export async function anchor(snapshotObject: unknown, label: string): Promise<Hash | null> {
  let contractAddress: `0x${string}`
  let walletClient: ReturnType<typeof buildWalletClient>
  try {
    contractAddress = getContractAddress()
    walletClient = buildWalletClient()
  } catch (err) {
    console.warn('[registry] CONTRACT_ADDRESS not set — skipping anchor')
    return null
  }

  const dataHash = hashSnapshot(snapshotObject)

  try {
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi: SIGNAL_VAULT_ABI,
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
 * Convenience wrapper kept for backward compatibility.
 */
export async function onAlert(
  marketId: string,
  probability: number,
  reason: string,
): Promise<void> {
  const payload = { marketId, probability, reason, ts: new Date().toISOString() }
  await anchor(payload, 'wc-alert')
}
