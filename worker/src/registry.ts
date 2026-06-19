/**
 * On-chain alert logging via viem (D2 TODO).
 *
 * Calls SnapshotRegistry.logAlert() on Sepolia testnet when the LLM detects
 * a significant probability shift. Deploy the contract with Remix first (see contracts/).
 *
 * RED LINE: This code must NEVER touch mainnet. Sepolia only.
 */

// TODO (D2): Uncomment and implement once SnapshotRegistry is deployed on Sepolia.
//
// import { createPublicClient, createWalletClient, http, parseAbi, privateKeyToAccount } from 'viem'
// import { sepolia } from 'viem/chains'
//
// const REGISTRY_ABI = parseAbi([
//   'function logAlert(string calldata marketId, uint256 probability, string calldata reason) external',
//   'event AlertLogged(uint256 indexed timestamp, string marketId, uint256 probability, string reason)',
// ])
//
// function getClients() {
//   const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}`
//   if (!privateKey) throw new Error('WALLET_PRIVATE_KEY not set')
//   const account = privateKeyToAccount(privateKey)
//   const transport = http(process.env.RPC_URL)
//   const publicClient = createPublicClient({ chain: sepolia, transport })
//   const walletClient = createWalletClient({ chain: sepolia, transport, account })
//   return { publicClient, walletClient, account }
// }

/**
 * Log an alert event on-chain.
 * @param marketId  - CLOB token ID string
 * @param probability - value in [0, 1], will be scaled to 1e6 on-chain
 * @param reason    - human-readable LLM explanation
 */
export async function onAlert(
  marketId: string,
  probability: number,
  reason: string,
): Promise<void> {
  // TODO (D2): Replace with actual viem transaction:
  // const { walletClient, account } = getClients()
  // const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}`
  // const hash = await walletClient.writeContract({
  //   address: contractAddress,
  //   abi: REGISTRY_ABI,
  //   functionName: 'logAlert',
  //   args: [marketId, BigInt(Math.round(probability * 1_000_000)), reason],
  //   account,
  // })
  // console.log(`[registry] alert logged on-chain: ${hash}`)

  console.log('[registry] onAlert placeholder — implement in D2', {
    marketId,
    probability,
    reason,
  })
}
