# Signal Vault

> AI × Web3 hackathon project — 2026 FIFA World Cup Polymarket Signal Specialist
>
> Monitors World Cup prediction markets every 60 s. When the AI detects a genuine
> price anomaly it makes a **directional prediction on-chain**. Ten minutes later
> the worker settles the prediction with the actual market price — building a
> tamper-proof, publicly verifiable AI Track Record on Sepolia.

---

## What makes this different

Most "AI + blockchain" demos anchor a hash and call it done.
Signal Vault goes one step further:

```
AI detects anomaly
      │
      ▼
makePrediction(direction="UP", probAtAlert=4.90%)   ← PredictionMade event on Sepolia
      │
      │  ~10 minutes later, same worker cycle
      ▼
settlePrediction(actualProb=5.80%)                  ← PredictionSettled event on Sepolia
      │
      ▼
Dashboard: AI Track Record = 17/23 = 73.9%  (all verifiable on Etherscan)
```

The AI's confidence is **measurable and unforgeable**. Every prediction and its
outcome live permanently on-chain. Anyone can verify without trusting the operator.

---

## Architecture

```
Polymarket CLOB API
      │  axios (60 s)
      ▼
 worker/src/index.ts
      │
      ├─[Step 3]─► web/public/snapshot.json ──► /dashboard (recharts + alert feed)
      │
      ├─[Step 4]─► llm.ts (decide / alertOnAnomaly)
      │                  │  trigger_alert fired
      │                  ▼
      │             registry.ts (viem)
      │                  │  makePrediction()
      │                  ▼
      │             SignalVault.sol on Sepolia  ← PredictionMade event
      │
      └─[Step 5]─► settler.ts (checkSettlements)
                         │  deadline passed + current price fetched
                         ▼
                    registry.ts → settlePrediction()
                         │
                         ▼
                    SignalVault.sol            ← PredictionSettled event
                         │
                         ▼
                    notify.ts → Telegram Bot  ← "✅ CORRECT — Track Record: 73.9%"
```

No database. Persistence = `snapshot.json` (rolling 500 price readings + all alert records)
+ on-chain events (immutable prediction lifecycle).

---

## Smart Contract — SignalVault.sol

Two functions, two events:

| Function | When called | Event emitted |
|---|---|---|
| `makePrediction(dataHash, market, direction, probBps, deadline)` | AI triggers alert | `PredictionMade` |
| `settlePrediction(id, actualProbBps)` | ~10 min later, worker settles | `PredictionSettled` |

`direction` is `"UP"` or `"DOWN"`. Settlement checks whether the actual price
moved in the predicted direction vs. the price at alert time.

Deploy on **Sepolia testnet** with Remix. Copy the deployed address to
`CONTRACT_ADDRESS` in `worker/.env`.

---

## Quick Start

### 1 — Worker

```bash
cd worker
cp .env.example .env
# Fill in all required keys (see table below)
npm install
npm run dev
```

The worker polls immediately, then every 60 s:
1. Fetches Polymarket probability
2. Writes `../web/public/snapshot.json` (price history + alert records)
3. Runs `alertOnAnomaly()` — LLM decides `trigger_alert` vs `record_only`
4. On `trigger_alert`: writes `PredictionMade` event on-chain
5. After 10 min: writes `PredictionSettled` event + sends Telegram result

### 2 — Web

```bash
cd web
npm install
npm run dev   # http://localhost:3000/dashboard
```

The dashboard reads `snapshot.json` and auto-refreshes every 30 s.

---

## Environment Variables (`worker/.env`)

| Key | Required | Description |
|---|---|---|
| `POLYMARKET_TOKEN_ID` | ✅ | CLOB token ID — find it in the Polymarket URL |
| `MARKET_QUESTION` | ✅ | Human-readable question shown on the dashboard |
| `HTTPS_PROXY` | optional | HTTP proxy (axios auto-detects) |
| `LLM_API_KEY` | ✅ | DeepSeek / MiniMax / OpenAI API key |
| `LLM_BASE_URL` | ✅ | e.g. `https://api.minimaxi.com/v1` |
| `LLM_MODEL` | ✅ | e.g. `MiniMax-Text-01` |
| `SEPOLIA_RPC` | ✅ | Sepolia RPC — public fallback: `https://ethereum-sepolia-rpc.publicnode.com` |
| `WALLET_PRIVATE_KEY` | ✅ | Sepolia test wallet key — **never mainnet** |
| `CONTRACT_ADDRESS` | ✅ | Deployed `SignalVault` address on Sepolia |
| `TELEGRAM_BOT_TOKEN` | D4 | Telegram bot token |
| `TELEGRAM_CHAT_ID` | D4 | Target chat ID |
| `SNAPSHOT_OUTPUT_PATH` | optional | Defaults to `../web/public/snapshot.json` |
| `POLL_INTERVAL_MS` | optional | Defaults to `60000` (min `10000` for testing) |

---

## snapshot.json Schema

```jsonc
{
  "market": { "tokenId": "...", "question": "Will Mexico win the 2026 FIFA World Cup?" },
  "snapshots": [
    { "timestamp": "2026-06-21T10:00:00Z", "probability": 0.0155 }
    // ...up to 500 entries
  ],
  "alerts": [
    {
      "localId": "alert-1-...",
      "onChainId": 3,               // matches PredictionMade event id
      "market": "Will Mexico win...",
      "probAtAlert": 0.049,
      "direction": "UP",
      "targetProbPct": 5.5,
      "urgency": "medium",
      "reason": "Mexico probability spiked 3.4 pp, likely lineup news.",
      "alertedAt": "2026-06-21T10:05:00Z",
      "settleAfter": "2026-06-21T10:15:00Z",
      "settled": true,
      "probAtSettle": 0.058,        // filled after 10 min
      "correct": true,              // price moved UP as predicted
      "txHashSettle": "0xabc...",   // PredictionSettled TX
      "settledAt": "2026-06-21T10:15:42Z"
    }
  ],
  "lastUpdated": "2026-06-21T10:15:42Z"
}
```

---

## Finding a Polymarket Token ID

```bash
# Fetch top World Cup markets by 24h volume
curl "https://gamma-api.polymarket.com/markets?limit=20&active=true&closed=false\
&order=volume24hr&ascending=false&tag=soccer" | jq '.[].conditionId'

# Get token IDs for a specific condition
curl "https://clob.polymarket.com/markets/<conditionId>" | jq '.tokens[].token_id'
```

---

## Roadmap

| Phase | Status | Task |
|---|---|---|
| W2-D1 | ✅ | Polymarket polling, snapshot.json, dashboard chart |
| W2-D2 | ✅ | LLM alert detection + on-chain anchoring (Sepolia) |
| W2-D3 | ✅ | `decide()` generic tool-calling engine + `alertOnAnomaly` scenario |
| W2-D4 | ✅ | Two-step prediction lifecycle: `PredictionMade` + `PredictionSettled` |
| W3-P0 | 🔜 | Deploy `web/` to Vercel — live public URL |
| W3-P1 | 🔜 | Dashboard Signal Feed: alert list + AI Track Record accuracy stat |
| W3-P2 | 🔜 | Multi-market monitoring (3+ World Cup markets) |
| W3-P3 | 🔜 | Telegram Bot real push: prediction issued → 10-min result |

---

## Deployment

- **Worker**: run locally (`npm run dev` in `worker/`) or on any VPS / Cloud Run.
- **Web**: `cd web && vercel --prod`
  After each worker run, commit `web/public/snapshot.json` and push to keep Vercel's
  static file up to date.
- **Contract**: deploy `contracts/SignalVault.sol` on Sepolia via Remix.
  Compiler: `0.8.20`. Optimisation: off (demo). Copy address to `worker/.env`.

---

## Security

- `WALLET_PRIVATE_KEY` is Sepolia **testnet only** — `.cursorrules` and `registry.ts`
  both enforce this. Never point `SEPOLIA_RPC` at a mainnet endpoint.
- `.env` is in `.gitignore` and must never be committed.
- The contract has no `onlyOwner` modifier — any wallet can call `makePrediction()`.
  For production add access control; for this demo the on-chain ID verifies the
  reporter address.
