// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  SignalVault
 * @notice Two-step on-chain prediction lifecycle for AI-detected Polymarket anomalies.
 *
 * Flow:
 *   1. Worker detects a price anomaly → calls makePrediction()
 *      Emits PredictionMade with direction ("UP"/"DOWN") and probability at alert time.
 *
 *   2. Worker checks the market price ~10 minutes later → calls settlePrediction()
 *      Emits PredictionSettled with actual price and whether the prediction was correct.
 *
 * Both events are permanently on-chain. Anyone can verify the AI's Track Record
 * by filtering events on Sepolia Etherscan — no trust required.
 *
 * Deploy on Sepolia with Remix. Copy the deployed address to CONTRACT_ADDRESS in worker/.env.
 *
 * Gas note: all heavy data (reason, market name) is stored off-chain in snapshot.json
 * and referenced here only via a keccak256 dataHash. This keeps gas costs low.
 */
contract SignalVault {

    // ─── Storage ─────────────────────────────────────────────────────────────────

    struct Prediction {
        address reporter;
        string  market;          // short market label (≤ 64 chars recommended)
        string  direction;       // "UP" | "DOWN"
        uint256 probAtAlertBps;  // probability at alert time in basis points (490 = 4.90%)
        uint256 deadline;        // unix timestamp: settlePrediction allowed after this
        bool    settled;
    }

    mapping(uint256 => Prediction) public predictions;
    uint256 public predictionCount;

    // ─── Events ──────────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when the AI triggers an alert and makes a directional prediction.
     * @param id             Auto-incremented prediction ID (use as reference for settlement)
     * @param reporter       Wallet address that submitted the prediction
     * @param dataHash       keccak256 of the full alert JSON stored in snapshot.json
     * @param market         Human-readable market label
     * @param direction      "UP" or "DOWN" — predicted price movement direction
     * @param probAtAlertBps Market probability at alert time (basis points: 490 = 4.90%)
     * @param deadline       Unix timestamp after which settlePrediction() is valid
     */
    event PredictionMade(
        uint256 indexed id,
        address indexed reporter,
        bytes32         dataHash,
        string          market,
        string          direction,
        uint256         probAtAlertBps,
        uint256         deadline
    );

    /**
     * @notice Emitted when the worker settles a prediction with the actual market price.
     * @param id            Prediction ID (matches a prior PredictionMade event)
     * @param correct       true if the actual price moved in the predicted direction
     * @param actualProbBps Actual market probability at settlement time (basis points)
     */
    event PredictionSettled(
        uint256 indexed id,
        bool            correct,
        uint256         actualProbBps
    );

    // ─── Write functions ─────────────────────────────────────────────────────────

    /**
     * @notice Register an AI-detected prediction on-chain.
     * @param dataHash       keccak256 fingerprint of the alert JSON
     * @param market         Short market label (used for readability in Etherscan)
     * @param direction      "UP" or "DOWN"
     * @param probAtAlertBps Probability at alert time × 10 000 (490 = 4.90%)
     * @param deadline       Unix timestamp (seconds) after which settlement is allowed
     * @return id            On-chain prediction ID — store this to call settlePrediction()
     */
    function makePrediction(
        bytes32        dataHash,
        string calldata market,
        string calldata direction,
        uint256         probAtAlertBps,
        uint256         deadline
    ) external returns (uint256 id) {
        id = ++predictionCount;
        predictions[id] = Prediction({
            reporter:       msg.sender,
            market:         market,
            direction:      direction,
            probAtAlertBps: probAtAlertBps,
            deadline:       deadline,
            settled:        false
        });
        emit PredictionMade(
            id, msg.sender, dataHash, market, direction, probAtAlertBps, deadline
        );
    }

    /**
     * @notice Settle a prediction once the deadline has passed.
     *         "Correct" = actual price moved in the predicted direction vs probAtAlert.
     * @param id            Prediction ID from a prior makePrediction() call
     * @param actualProbBps Actual market probability at settlement time (basis points)
     */
    function settlePrediction(uint256 id, uint256 actualProbBps) external {
        Prediction storage p = predictions[id];
        require(!p.settled,                    "SignalVault: already settled");
        require(block.timestamp >= p.deadline, "SignalVault: deadline not reached");

        bool correct;
        if (keccak256(bytes(p.direction)) == keccak256(bytes("UP"))) {
            correct = actualProbBps > p.probAtAlertBps;
        } else {
            correct = actualProbBps < p.probAtAlertBps;
        }

        p.settled = true;
        emit PredictionSettled(id, correct, actualProbBps);
    }
}
