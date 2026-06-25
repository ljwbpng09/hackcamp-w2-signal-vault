# AI Blackbox

> **Commit first. Score later.**

Built for live traders and market researchers — AI Blackbox acts as a Matchday Scout that auto-discovers tonight's World Cup markets, commits each directional call **on-chain before the result**, and auto-grades it 10 minutes later. The outcome: a tamper-proof, publicly auditable AI track record.

**If an AI won't sign first, accuracy means nothing.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-ai--blackbox.vercel.app-6366f1?style=flat-square)](https://ai-blackbox.vercel.app)
[![Contract](https://img.shields.io/badge/Contract-Sepolia_Etherscan-3b82f6?style=flat-square)](https://sepolia.etherscan.io/address/0xb894f59EE1531FA17cebb90D6d80E0A0fb597191)
[![GitHub](https://img.shields.io/badge/GitHub-ai--blackbox-24292e?style=flat-square&logo=github)](https://github.com/ljwbpng09/ai-blackbox)
[![Hackathon](https://img.shields.io/badge/CROO_Agent_Hackathon-DoraHacks-f97316?style=flat-square)](https://dorahacks.io/hackathon/croo-hackathon/detail)

---

## Screenshots

| Landing Page | Telegram Bot — 16 markets live |
|---|---|
| ![Landing](docs/screenshots/landing.png) | ![Telegram](docs/screenshots/telegram.png) |

---

## What makes this different

Most AI alert tools send signals. Then they rewrite history later.
AI Blackbox does one thing differently — it **commits before results**:

```
AI detects price anomaly
      │
      ▼
makePrediction(direction="UP", probAtAlert=4.90%)   ← PredictionMade event on Sepolia
      │
      │  ~10 minutes later, same worker cycle
      ▼
settlePrediction(actualProb=5.80%)                  ← PredictionSettled event on Sepolia
      │
      ▼
Dashboard: AI Track Record updated — all verifiable on Etherscan, no account needed
```

> Web2 can log. Only a blockchain can **prove** — no trusted operator, no central edit, no takebacks.

---

## Live Contract

- **SignalVault.sol** deployed on Sepolia:
  [`0xb894f59EE1531FA17cebb90D6d80E0A0fb597191`](https://sepolia.etherscan.io/address/0xb894f59EE1531FA17cebb90D6d80E0A0fb597191)
- Filter `PredictionMade` + `PredictionSettled` events to audit the full AI track record independently.

---

## Architecture

```
Polymarket Gamma API                     Polymarket CLOB API
      │  (every cycle)                        │  (per market)
      │  matchday.ts                          │  axios
      ▼                                       ▼
 Auto-detect today's match            fetchMarketProbability(tokenId)
 "Will X win on YYYY-MM-DD?"
      │  merge into live market set
      ▼
 worker/src/index.ts  ─────────────► per-market snapshots Map
      │                                       │
      ├─► web/public/snapshot.json ───────────┘  markets[] schema
      │    └─► /dashboard  (tabs per market, AI Track Record)
      │
      ├─► llm.ts  alertOnAnomaly()  (per market)
      │                │  trigger_alert fired
      │                ▼
      │           registry.ts (viem)
      │                │  makePrediction()
      │                ▼
      │           SignalVault.sol on Sepolia  ← PredictionMade event
      │
      └─► settler.ts  checkSettlements()
                      │  settlePrediction()
                      ▼
               SignalVault.sol            ← PredictionSettled event
                      │
                      ▼
               notify.ts → Telegram Bot  ← "✅ CORRECT · Track Record updated"
```

**Two-layer market discovery:**

| Layer | Source | Cadence |
|---|---|---|
| Static | `POLYMARKET_MARKETS` in `.env` — tournament winner odds (France, Argentina, …) | Always on; slow-moving; accumulates Track Record over weeks |
| Dynamic (Plan B) | `matchday.ts` queries Gamma API each cycle for today's `"Will X win on YYYY-MM-DD?"` markets | Auto-added at kick-off; auto-retired on resolution; high volatility |

**Interactive add** — send `/add england` in Telegram; bot searches Polymarket, returns inline buttons; confirmed market appears in the next poll cycle (~60 s). No restart needed.

No database. Persistence = `snapshot.json` (rolling 500 price readings per market + all alert records) + on-chain events (immutable prediction lifecycle).

---

## Smart Contract — SignalVault.sol

Two functions, two events. That's the whole blackbox:

| Function | When called | Event emitted |
|---|---|---|
| `makePrediction(dataHash, market, direction, probBps, deadline)` | AI triggers alert | `PredictionMade` |
| `settlePrediction(id, actualProbBps)` | ~10 min later | `PredictionSettled` |

`direction` is `"UP"` or `"DOWN"`. Settlement checks whether actual price moved in the predicted direction. Heavy data (reason, full market name) is stored off-chain in `snapshot.json` and referenced on-chain only via a `keccak256` dataHash — keeping gas low.

---

## Quick Start

### 1 — Worker

```bash
cd worker
cp .env.example .env
# Fill in all keys (see table below)
npm install
npm run dev
```

On startup the worker:
1. Loads any existing `snapshot.json` history back into memory
2. Calls `syncMatchDayMarkets()` — auto-detects today's live World Cup match markets
3. Polls every 60 s: fetch probability → run LLM anomaly check → write `PredictionMade` on alert → settle after 10 min → Telegram push

### 2 — Web dashboard

```bash
cd web
npm install
npm run dev   # http://localhost:3000
```

Dashboard reads `snapshot.json` and auto-refreshes every 30 s.

### 3 — Deploy

```bash
# Web
cd web && vercel --prod

# After each worker run, push the snapshot to keep Vercel up-to-date:
git add web/public/snapshot.json && git commit -m "chore: update snapshot" && git push
```

---

## Environment Variables (`worker/.env`)

| Key | Required | Description |
|---|---|---|
| `POLYMARKET_MARKETS` | ✅ | JSON array of markets to monitor statically, e.g. `[{"tokenId":"<id>","question":"Will France win..."}]` |
| `LLM_API_KEY` | ✅ | API key — works with MiniMax, DeepSeek, OpenAI, or any OpenAI-compatible provider |
| `LLM_BASE_URL` | ✅ | e.g. `https://api.minimaxi.com/v1` |
| `LLM_MODEL` | ✅ | e.g. `MiniMax-Text-01` |
| `SEPOLIA_RPC` | ✅ | Sepolia RPC — public fallback: `https://ethereum-sepolia-rpc.publicnode.com` |
| `WALLET_PRIVATE_KEY` | ✅ | Sepolia test wallet — **testnet only, never mainnet** |
| `CONTRACT_ADDRESS` | ✅ | Deployed `SignalVault` address on Sepolia |
| `TELEGRAM_BOT_TOKEN` | optional | Telegram bot token for push alerts |
| `TELEGRAM_CHAT_ID` | optional | Target chat/channel ID |
| `SNAPSHOT_OUTPUT_PATH` | optional | Defaults to `../web/public/snapshot.json` |
| `POLL_INTERVAL_MS` | optional | Defaults to `60000` (min `10000` for testing) |

---

## snapshot.json Schema (multi-market)

```jsonc
{
  "markets": [
    {
      "tokenId": "...",
      "question": "Will Mexico win the 2026 FIFA World Cup?",
      "snapshots": [
        { "timestamp": "2026-06-21T10:00:00Z", "probability": 0.0155 }
        // ...up to 500 entries per market
      ],
      "alerts": [
        {
          "localId": "alert-1-...",
          "onChainId": 3,
          "market": "Will Mexico win the 2026 FIFA World Cup?",
          "probAtAlert": 0.049,
          "direction": "UP",
          "urgency": "medium",
          "reason": "Mexico probability spiked 3.4 pp, likely lineup news.",
          "alertedAt": "2026-06-21T10:05:00Z",
          "settleAfter": "2026-06-21T10:15:00Z",
          "settled": true,
          "probAtSettle": 0.058,
          "correct": true,
          "txHashSettle": "0xabc...",
          "settledAt": "2026-06-21T10:15:42Z"
        }
      ]
    }
    // ...one entry per monitored market
  ],
  "lastUpdated": "2026-06-21T10:15:42Z"
}
```

---

## Telegram Bot Commands

| Command | Description |
|---|---|
| `/status` | Worker stats — decisions made, alerts triggered, last on-chain TX, mute state |
| `/snapshot` | Latest probability + AI Track Record for every monitored market |
| `/markets` | List all currently monitored markets (static + auto-detected) |
| `/add <keyword>` | **Add a market live** — search by team name, pick from inline buttons, no restart. Active in ~60 s. |
| `/mute` | Mute push alerts for 1 hour |

```
# Example — add England's World Cup winner market:
/add england
→ Bot searches Polymarket, returns matching markets as buttons
→ Tap to confirm — no tokenId needed
```

---

## Roadmap

| Phase | Status | Task |
|---|---|---|
| W2-D1 | ✅ | Polymarket polling, snapshot.json, dashboard chart |
| W2-D2 | ✅ | LLM alert detection + on-chain anchoring (Sepolia) |
| W2-D3 | ✅ | `decide()` generic tool-calling engine + `alertOnAnomaly` |
| W2-D4 | ✅ | Two-step prediction lifecycle: `PredictionMade` + `PredictionSettled` |
| W3-P0 | ✅ | Deploy `web/` to Vercel — live public URL |
| W3-P1 | ✅ | Dashboard: AI Track Record accuracy stat + on-chain prediction feed |
| W3-P2 | ✅ | Multi-market monitoring — `POLYMARKET_MARKETS` config, market tab switcher |
| W3-P3 | ✅ | Telegram Bot: real push notifications + settlement results |
| W3-P4 | ✅ | **Plan B — Auto match-day detection**: `matchday.ts` queries Gamma API each cycle, auto-adds today's match markets, auto-retires on resolution. Zero-config. |
| W3-P4b | ✅ | **Telegram `/add` command**: keyword search → inline market picker → live monitoring. No restart needed. |
| W3-P5 | 🔜 | **CROO CAP integration**: wrap `alertOnAnomaly` as a callable, paid A2A agent endpoint on CROO Agent Store |

---

## CROO Agent Hackathon

Submitted to the [CROO Agent Hackathon](https://dorahacks.io/hackathon/croo-hackathon/detail) on DoraHacks.

**Tracks:** DeFi / On-chain Ops Agents · Data & Verification Agents

**Why AI Blackbox fits CROO:**
- Every alert is already an on-chain transaction — `makePrediction()` + `settlePrediction()` are native A2A-composable calls
- The AI track record is the product: other agents can query it to decide whether to trust AI Blackbox's signals before paying for them
- W3-P5 wraps `alertOnAnomaly` as a CAP-callable endpoint — any agent in the CROO ecosystem can hire AI Blackbox to watch a market and receive a verified, accountable prediction

---

## Security

- `WALLET_PRIVATE_KEY` is Sepolia **testnet only**. Never point `SEPOLIA_RPC` at a mainnet endpoint.
- `.env` is in `.gitignore` and is never committed.
- `SignalVault.sol` has no `onlyOwner` — any wallet can call `makePrediction()`. For production, add access control. For this demo, the on-chain reporter address is the proof of authorship.

---

## License

MIT
