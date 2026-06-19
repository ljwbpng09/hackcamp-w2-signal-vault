# Signal Vault

> AI × Web3 hackathon project — Week 2
>
> Monitors Polymarket prediction markets every 60 s, uses an LLM to detect
> significant probability shifts, and logs immutable alerts on Sepolia testnet.

---

## Architecture

```
Polymarket CLOB API
      │  axios (60 s)
      ▼
 worker/src/index.ts ──► web/public/snapshot.json ──► /dashboard (recharts)
      │
      ▼ (D2)
 llm.ts (DeepSeek)
      │  alert detected
      ▼
 registry.ts (viem) ──► SnapshotRegistry.sol on Sepolia
      │
      ▼ (D4)
 notify.ts (Telegram)
```

No database. Persistence = `snapshot.json` (rolling 500 readings) + on-chain events (alerts).

---

## Quick Start

### 1 — Worker

```bash
cd worker
cp .env.example .env
# Fill in POLYMARKET_TOKEN_ID and other values
npm install
npm run dev
```

The worker polls immediately and then every 60 s, writing results to
`../web/public/snapshot.json`.

### 2 — Web

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

Open `/dashboard` to see the probability line chart.
The chart auto-refreshes every 30 s from `snapshot.json`.

---

## Environment Variables (worker/.env)

| Key | Required | Description |
|---|---|---|
| `POLYMARKET_TOKEN_ID` | ✅ D1 | CLOB token ID — find it in the Polymarket URL |
| `MARKET_QUESTION` | ✅ D1 | Human-readable question shown on the dashboard |
| `HTTPS_PROXY` | optional | HTTP proxy (axios auto-detects) |
| `LLM_API_KEY` | D2 | DeepSeek / OpenAI API key |
| `LLM_BASE_URL` | D2 | `https://api.deepseek.com/v1` or any OpenAI-compatible URL |
| `LLM_MODEL` | D2 | e.g. `deepseek-chat` |
| `RPC_URL` | D2 | Sepolia RPC (Infura / Alchemy) |
| `WALLET_PRIVATE_KEY` | D2 | Sepolia test wallet key — **never mainnet** |
| `CONTRACT_ADDRESS` | D2 | Deployed `SnapshotRegistry` address |
| `TELEGRAM_BOT_TOKEN` | D4 | Telegram bot token |
| `TELEGRAM_CHAT_ID` | D4 | Target chat ID |
| `SNAPSHOT_OUTPUT_PATH` | optional | Defaults to `../web/public/snapshot.json` |

---

## Finding a Polymarket Token ID

1. Go to [polymarket.com](https://polymarket.com) and open any market.
2. Click the **"Prices"** tab or open DevTools → Network.
3. Look for requests to `clob.polymarket.com` — the `token_id` query param is what you need.

Alternatively use the CLOB REST API directly:

```bash
# List recent markets
curl "https://gamma-api.polymarket.com/markets?limit=5&active=true" | jq '.[].conditionId'

# Get token IDs for a condition
curl "https://clob.polymarket.com/markets/<conditionId>" | jq '.tokens[].token_id'
```

---

## Roadmap

| Day | Status | Task |
|---|---|---|
| D1 | ✅ | Polymarket polling, snapshot.json, dashboard chart |
| D2 | 🔜 | LLM alert detection + SnapshotRegistry on Sepolia |
| D3 | 🔜 | Dashboard reads on-chain AlertLogged events via viem |
| D4 | 🔜 | Telegram notifications + signal confidence scoring |

---

## Deployment

- **Worker**: run locally (`npm run dev` in `worker/`) or on any VPS / Cloud Run.
- **Web**: `cd web && vercel --prod` — Vercel serves `public/snapshot.json` statically.
  After each worker run, `git add web/public/snapshot.json && git push` to update
  the deployed snapshot.

---

## Security

- `WALLET_PRIVATE_KEY` is Sepolia **testnet only** — the `.cursorrules` and `registry.ts`
  both enforce this. Never point `RPC_URL` at a mainnet endpoint.
- `.env` is in `.gitignore` and must never be committed.
