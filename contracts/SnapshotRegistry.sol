// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  SnapshotRegistry
 * @notice Immutable on-chain log of AI-detected prediction-market alerts.
 *
 * Deploy with Remix on Sepolia testnet (D2).
 * Copy the deployed address to WORKER_CONTRACT_ADDRESS in worker/.env.
 *
 * Events are the sole persistence layer — no state array needed.
 * Index on `timestamp` so viem / ethers can filter by time range easily.
 */
contract SnapshotRegistry {
    // ─── Events ──────────────────────────────────────────────────────────────

    /**
     * @param timestamp   block.timestamp at alert time
     * @param marketId    Polymarket CLOB token ID (string for readability)
     * @param probability probability scaled by 1e6 (e.g. 650000 == 65.0000 %)
     * @param reason      LLM-generated human-readable reason string
     */
    event AlertLogged(
        uint256 indexed timestamp,
        string  marketId,
        uint256 probability,
        string  reason
    );

    // ─── State ────────────────────────────────────────────────────────────────

    address public owner;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "SnapshotRegistry: not owner");
        _;
    }

    // ─── Functions ───────────────────────────────────────────────────────────

    /**
     * @notice Log an AI-detected alert on-chain.
     * @param marketId    CLOB token ID of the monitored market
     * @param probability probability × 1_000_000 (e.g. pass 650000 for 65%)
     * @param reason      LLM explanation (max ~500 chars recommended to keep gas low)
     */
    function logAlert(
        string calldata marketId,
        uint256 probability,
        string calldata reason
    ) external onlyOwner {
        emit AlertLogged(block.timestamp, marketId, probability, reason);
    }

    /**
     * @notice Transfer ownership to a new address.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "SnapshotRegistry: zero address");
        owner = newOwner;
    }
}
