# Signal Vault Narrative Assets

Role perspective: Senior Product Manager + Hackathon Judge

Current project understanding:

- Current product name: Signal Vault
- Core loop: Polymarket market monitoring -> LLM anomaly decision -> on-chain directional prediction -> 10-minute settlement -> public AI track record
- Core chain action: `makePrediction()` before outcome, then `settlePrediction()` after the deadline
- Current weak points:
  - Niche 1: 3 / 5, user persona is not sharp enough
  - Niche 6: 0 / 5, pitch video is not recorded yet

---

## Candidate 1 - Angle A: Pain First

### Product Name

ProofSignal

### Tagline

先预测，后验真  
Predict, then prove

### One-liner

中文：ProofSignal 让 AI 市场信号先公开下注，再用链上结果验证它有没有说对。

EN: ProofSignal makes AI market calls before outcomes, then verifies their accuracy on-chain.

### Pitch 60s

中文：

前 10 秒：你看到一个市场突然波动，但你不知道这是噪音、内幕，还是一次真正值得行动的信号。更糟的是，大多数“聪明提醒”事后都能说自己早就看到了。

接下来：ProofSignal 做一件简单但重要的事：当 AI 发现 Polymarket World Cup 概率异常时，它必须先给出方向判断，比如 UP 或 DOWN。这个判断会立刻写入链上，带着当时价格和结算时间。10 分钟后，系统自动读取真实价格并结算这次判断是否正确。最后，Dashboard 展示的不是“AI 很聪明”的口号，而是一个公开、可查、无法篡改的 AI Track Record。

EN:

First 10 seconds: You see a market suddenly move, but you do not know if it is noise, insider information, or a real signal worth acting on. Worse, most “smart alerts” can always claim they saw it coming afterward.

Then: ProofSignal forces the AI to commit first. When it detects an anomaly in a Polymarket World Cup market, it must predict UP or DOWN before the result is known. That prediction is recorded on-chain with the current price and settlement time. Ten minutes later, the system checks the real price and settles whether the AI was right. The dashboard shows not a claim, but a public AI track record.

### Core Narrative Path

从“不可信的 AI 提醒”切入，把项目定位成 AI signal accountability layer.

---

## Candidate 2 - Angle B: Role First

### Product Name

Signal Scout

### Tagline

你的链上球探  
Your on-chain scout

### One-liner

中文：Signal Scout 是一个盯盘球探，专门发现 World Cup 预测市场里的异常信号并公开记录战绩。

EN: Signal Scout watches World Cup prediction markets, flags unusual moves, and builds a public record of its calls.

### Pitch 60s

中文：

前 10 秒：想象你有一个球探，不看比赛集锦，只盯着市场情绪。他每天帮你发现：哪支球队的预期正在悄悄变化。

接下来：Signal Scout 是一个 World Cup Polymarket 专家。它持续监控概率变化，把最近一小时的走势交给 AI 判断：这是普通波动，还是值得提醒的异常？如果只是噪音，它记录下来；如果值得行动，它会触发 alert，给出方向、原因和目标概率，并把这次预测写到 Sepolia 上。之后系统自动结算它是否判断正确。最后你看到的是一个球探的公开战绩表：它提醒了几次，对了几次，链上都能查。

EN:

First 10 seconds: Imagine having a scout who does not watch highlight reels, but watches market belief. Every day, it tells you which team’s expectations are quietly shifting.

Then: Signal Scout is a World Cup Polymarket specialist. It monitors probability changes, gives the last hour of movement to an AI decision engine, and asks: is this noise or a real anomaly? If it is noise, it records only. If it matters, it sends an alert with direction, reason, and target probability, then writes the prediction to Sepolia. Later, it settles the result. What you get is a scout’s public scoreboard: alerts, wins, losses, and proof.

### Core Narrative Path

把产品人格化成“球探”，降低理解门槛，适合 World Cup 场景。

---

## Candidate 3 - Angle C: Analogy First（类比优先）

### Product Name

AI Blackbox

### Tagline

AI 的飞行记录仪  
Flight recorder for AI

### One-liner

中文：AI Blackbox 像飞行记录仪一样记录每次 AI 市场判断，让预测在结果前留下证据。

EN: AI Blackbox records every AI market call before the outcome, like a flight recorder for predictions.

### Pitch 60s

中文：

前 10 秒：当一次判断出错时，最重要的问题不是“谁说的”，而是“当时它到底看到了什么、决定了什么”。

接下来：AI Blackbox 把这个思路用在预测市场里。每当 AI 发现 Polymarket World Cup 概率异常，它不能只发一句提醒，它必须留下记录：当时的市场、价格、方向判断和结算时间。这个记录会写到链上。10 分钟后，系统再用真实价格自动结算这次判断是否正确。这样评委不需要相信我们的模型，也不需要相信我们的截图，只需要打开 Dashboard 或 Etherscan，就能看到 AI 每一次判断的黑匣子记录。

EN:

First 10 seconds: When a decision goes wrong, the real question is not just who said it. It is what they saw, what they decided, and whether that record can be trusted.

Then: AI Blackbox applies that idea to prediction markets. When the AI detects an unusual move in a Polymarket World Cup market, it cannot just send an alert. It must leave a record: market, price, direction, and settlement time. That record goes on-chain. Ten minutes later, the system checks the actual price and settles whether the call was right. Judges do not need to trust our model or our screenshots. They can open the dashboard or Etherscan and inspect the AI’s blackbox.

### Core Narrative Path

用“黑匣子”类比解释链上验证，非技术评委最快能懂。

---

## Evaluation

### Strongest “judge gets it in one second”

Candidate 3: AI Blackbox.

Reason: “AI 的飞行记录仪 / Flight recorder for AI” is the strongest analogy. Judges do not need to understand Polymarket, Viem, or Sepolia to immediately understand the value: record the decision before the outcome, then make it auditable.

### Most differentiated from existing projects

Candidate 3: AI Blackbox.

Reason: Candidate 1 still sounds like a signal product. Candidate 2 still sounds like a market assistant. Candidate 3 reframes the project as AI accountability infrastructure, which is sharper for CROO’s Data & Verification / Agent Commerce narrative.

### Recommendation

Use AI Blackbox as the external narrative, while keeping Signal Vault as the system or protocol name.

Suggested format:

> AI Blackbox by Signal Vault

This keeps the existing codebase and brand continuity, while making the pitch sharper and easier for judges to remember.
