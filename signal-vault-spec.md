# SignalVault — 项目全局规划 & 技术方案书

> 版本：v1.0  
> 日期：2026-06-11  
> 定位：Hackathon MVP（目标 48–72 小时可演示）

---

## 一、项目概述

### 1.1 一句话定义
**SignalVault** 是一个用 Polymarket 链上仓位作为"真金白银业绩公证"的量化信号订阅市场——信号提供者在 Polymarket 上下注留下不可篡改的 Track Record，订阅者按月付 USDC 获取信号提醒，AI 自动解析并展示每个提供者的风险收益特征。


Dashboard 下方加一个"Signal Feed"列表：每条告警显示时间、概率变化、AI 判断理由、Etherscan 链接
Dashboard 改成多条折线或卡片网格，"哪支队刚动了"一眼可见
"AI 实时监控 World Cup 预测市场，发现定价异常就上链留证 + 前端可查"

### 1.2 核心价值主张

| 角色 | 当前痛点 | SignalVault 解决方式 |
|------|----------|----------------------|
| 信号提供者（Quant） | 卖信号会暴露策略，不卖又无法变现 | 通过时间延迟（T+N分钟）推送，保护先发优势 |
| 信号消费者（投资者） | 付费信号无法验证历史真实性 | Polymarket 链上仓位即公证，不可造假 |
| 市场整体 | 量化 Alpha 被困在私募黑箱里 | 开放订阅市场，Alpha 流通而不泄露 |

### 1.3 MVP 核心功能范围

```
✅ IN SCOPE（Hackathon 必须有）
  - 信号提供者注册 + 钱包绑定
  - Dune 拉取钱包历史 Polymarket 仓位 + 盈亏
  - 业绩指标自动计算（胜率/ROI/夏普近似）
  - AI 生成信号风格分析摘要
  - 排行榜首页
  - 提供者主页（业绩展示 + 订阅按钮）
  - USDC 订阅支付（Polygon）
  - 订阅者信号 Feed（延时 N 分钟）

⏳ NICE TO HAVE（时间够再做）
  - EAS 链上业绩 Attestation NFT
  - Superfluid 流式订阅
  - 订阅者在平台内一键跟单（Polymarket 下注）
  - 移动端响应式优化
```

---

## 二、用户旅程

### 2.1 信号提供者（Signal Provider）

```
1. 连接钱包（MetaMask / Coinbase Wallet）
2. 注册成为提供者，填写：昵称、策略描述、信号延迟时长（15/30/60 min）、订阅月费（USDC）
3. 系统自动拉取该钱包在 Polymarket 的历史仓位并计算业绩
4. AI 生成"策略风格摘要"，提供者可编辑后发布
5. 每次在 Polymarket 下注后，登录 SignalVault 发布信号通知
   （或：未来通过链上事件监听自动触发）
6. 延时结束后，订阅者收到信号推送
```

### 2.2 信号订阅者（Subscriber）

```
1. 浏览首页排行榜，按胜率/ROI/订阅人数排序
2. 点击感兴趣的提供者，查看详情页（业绩图表 + AI 摘要 + 近期仓位）
3. 点击「Subscribe」，连接钱包
4. 授权 + 转账 USDC（月费）到合约
5. 进入个人 Feed 页面，实时轮询订阅信号
6. 收到信号后自行在 Polymarket 操作（MVP 阶段）
```

---

## 三、系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (Next.js)                  │
│  Landing / Leaderboard │ Provider Page │ Signal Feed     │
└──────────────┬──────────────────────────────────────────┘
               │ API Routes (Next.js Route Handlers)
┌──────────────▼──────────────────────────────────────────┐
│                    Backend Layer                          │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  Dune API   │  │ Polymarket  │  │   OpenAI API    │  │
│  │  Client     │  │ CLOB Client │  │   (GPT-4o)      │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                   │           │
│  ┌──────▼────────────────▼───────────────────▼────────┐  │
│  │              Business Logic Layer                   │  │
│  │  MetricsCalculator │ SignalDelayQueue │ AIAnalyzer  │  │
│  └──────────────────────────┬──────────────────────────┘  │
│                              │                            │
│  ┌───────────────────────────▼────────────────────────┐  │
│  │              Prisma ORM + SQLite                    │  │
│  │  Provider │ Subscription │ Signal │ Position        │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
               │ viem + wagmi
┌──────────────▼──────────────────────────────────────────┐
│                  Polygon Mainnet                          │
│         USDC Contract (订阅费收付)                        │
│         Polymarket CTF Exchange (仓位验证)               │
└─────────────────────────────────────────────────────────┘
```

### 3.2 数据流说明

| 数据流 | 来源 | 去向 | 触发时机 |
|--------|------|------|----------|
| 历史仓位 | Dune Analytics REST API | SQLite Position 表 | 提供者注册 / 每日定时刷新 |
| 实时订单状态 | Polymarket CLOB API | 内存缓存 | 用户查看详情页时 |
| 业绩指标 | 本地计算（基于 Position 数据） | SQLite Provider 表 | 仓位数据更新后 |
| AI 摘要 | OpenAI GPT-4o | SQLite Provider 表 | 指标更新后（懒加载，缓存 24h）|
| 订阅关系 | 链上 USDC Transfer 事件 | SQLite Subscription 表 | 用户付款成功后 |
| 信号通知 | 提供者手动发布 | SQLite Signal 表 + 延时队列 | 提供者点击"发布信号" |

---

## 四、数据模型

### 4.1 ERD 概览

```
Provider ──< Position
    │
    └──< Signal ──< SignalView（记录谁看过）
    
Subscriber ──< Subscription >── Provider
```

### 4.2 详细 Schema（Prisma）

```prisma
model Provider {
  id              String   @id @default(cuid())
  walletAddress   String   @unique
  nickname        String
  bio             String?
  strategyDesc    String?
  delayMinutes    Int      @default(30)   // 信号延时分钟
  monthlyFeUsdc   Float    @default(10)   // 月费 USDC
  
  // 业绩指标（缓存）
  winRate         Float?
  totalRoi        Float?
  sharpeApprox    Float?
  totalTrades     Int      @default(0)
  
  // AI 摘要
  aiSummary       String?
  aiSummaryAt     DateTime?
  
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  positions       Position[]
  signals         Signal[]
  subscriptions   Subscription[]
}

model Position {
  id              String   @id @default(cuid())
  providerId      String
  provider        Provider @relation(fields: [providerId], references: [id])
  
  // Polymarket 数据
  marketId        String
  marketQuestion  String
  conditionId     String
  tokenId         String
  outcome         String   // "Yes" | "No"
  side            String   // "BUY" | "SELL"
  size            Float
  price           Float    // 入场价格 0-1
  
  // 结果（仓位结算后）
  resolved        Boolean  @default(false)
  resolvedOutcome String?  // "YES" | "NO"
  pnl             Float?   // 盈亏 USDC
  
  transactionHash String?
  openedAt        DateTime
  closedAt        DateTime?
  
  @@index([providerId])
}

model Signal {
  id              String   @id @default(cuid())
  providerId      String
  provider        Provider @relation(fields: [providerId], references: [id])
  
  marketId        String
  marketQuestion  String
  direction       String   // "YES" | "NO"
  confidence      Int?     // 1-5 主观置信度
  note            String?  // 提供者备注
  
  publishedAt     DateTime @default(now())
  visibleAt       DateTime // publishedAt + delayMinutes（订阅者可见时间）
  
  views           SignalView[]
  
  @@index([providerId, visibleAt])
}

model SignalView {
  id              String   @id @default(cuid())
  signalId        String
  signal          Signal   @relation(fields: [signalId], references: [id])
  subscriberAddr  String
  viewedAt        DateTime @default(now())
  
  @@unique([signalId, subscriberAddr])
}

model Subscription {
  id              String   @id @default(cuid())
  subscriberAddr  String
  providerId      String
  provider        Provider @relation(fields: [providerId], references: [id])
  
  // 支付记录
  txHash          String
  amountUsdc      Float
  paidAt          DateTime
  expiresAt       DateTime // paidAt + 30 days
  
  isActive        Boolean  @default(true)
  
  @@unique([subscriberAddr, providerId])
  @@index([subscriberAddr])
}
```

---

## 五、API 设计

### 5.1 Route 列表

```
GET    /api/providers                    # 排行榜，支持 sort=winRate|roi|subscribers
GET    /api/providers/[address]          # 提供者详情 + 业绩 + AI 摘要
GET    /api/providers/[address]/positions # 历史仓位（分页）
GET    /api/providers/[address]/signals  # 信号历史（需验证订阅）
POST   /api/providers/register           # 注册提供者
POST   /api/providers/[address]/refresh  # 手动刷新 Dune 数据
POST   /api/signals                      # 提供者发布新信号
GET    /api/signals/feed                 # 订阅者获取 feed（需验证订阅）
POST   /api/subscribe/verify             # 验证链上付款 → 写入 Subscription
GET    /api/subscribe/status/[address]   # 查询订阅状态
GET    /api/health                       # 服务健康检查
```

### 5.2 关键 Response 格式

```typescript
// GET /api/providers
{
  providers: [{
    id: string
    walletAddress: string
    nickname: string
    strategyDesc: string
    winRate: number          // 0-1
    totalRoi: number         // e.g. 0.42 = +42%
    sharpeApprox: number
    totalTrades: number
    monthlyFeeUsdc: number
    subscriberCount: number
    aiSummary: string
  }]
  total: number
}

// GET /api/providers/[address]
{
  provider: ProviderDetail
  recentPositions: Position[]   // 最近 10 笔，resolved 的才展示
  performanceChart: {           // 按时间累计 ROI
    date: string
    cumulativeRoi: number
  }[]
  signals: Signal[]             // 仅返回已过延时期的，订阅者才能看
}

// POST /api/subscribe/verify
// Body: { txHash: string, providerAddress: string, subscriberAddress: string }
// 后端用 viem 验证 txHash 确实是一笔正确金额的 USDC transfer
{
  success: boolean
  subscription: Subscription
  expiresAt: string
}
```

---

## 六、前端页面规划

### 6.1 页面列表

```
/                    Landing + 排行榜（Leaderboard）
/provider/[address]  提供者主页
/dashboard           订阅者 Dashboard（需连接钱包）
/publish             提供者发布信号（需连接钱包 + 已注册）
/register            提供者注册
```

### 6.2 组件树

```
app/
├── layout.tsx                    # WagmiProvider + 全局 Header
├── page.tsx                      # Landing / Leaderboard
│
├── provider/[address]/
│   └── page.tsx                  # 提供者主页
│
├── dashboard/
│   └── page.tsx                  # 订阅者信号 Feed
│
├── publish/
│   └── page.tsx                  # 发布信号表单
│
└── register/
    └── page.tsx                  # 提供者注册表单

components/
├── layout/
│   ├── Header.tsx                # 导航 + 钱包连接按钮
│   └── Footer.tsx
├── leaderboard/
│   ├── LeaderboardTable.tsx      # 排行榜主体
│   ├── ProviderCard.tsx          # 单行卡片
│   └── SortFilter.tsx            # 排序筛选
├── provider/
│   ├── HeroStats.tsx             # 胜率/ROI/夏普 大字展示
│   ├── PerformanceChart.tsx      # 累计 ROI 折线图（recharts）
│   ├── PositionHistory.tsx       # 历史仓位表格
│   ├── AISummaryCard.tsx         # AI 摘要卡片
│   └── SubscribeButton.tsx       # 订阅按钮 + 付款流程
├── feed/
│   ├── SignalCard.tsx            # 单个信号卡片
│   └── FeedList.tsx              # 信号列表 + 轮询
└── ui/                           # shadcn/ui 组件
```

### 6.3 关键 UI 状态说明

```
SubscribeButton 状态机：
  IDLE → CONNECTING_WALLET → APPROVING_USDC → TRANSFERRING → VERIFYING → SUBSCRIBED

FeedList 轮询逻辑：
  - 已订阅 → 每 30 秒 fetch /api/signals/feed
  - 未订阅 → 展示模糊遮罩 + "Subscribe to unlock"

ProviderPage 数据加载：
  - 静态部分（业绩/摘要）：SSG + ISR（每 1 小时重新生成）
  - 动态部分（最新信号）：Client-side fetch
```

---

## 七、核心业务逻辑

### 7.1 Dune 查询设计

针对 Polymarket 的仓位数据，使用以下 Dune SQL 逻辑（通过 REST API 参数化传入钱包地址）：

```sql
-- 查询指定钱包在 Polymarket 的历史仓位和盈亏
-- 使用 Dune 已有的 polymarket.* 数据集

SELECT
    maker AS wallet,
    condition_id,
    token_id,
    SUM(CASE WHEN side = 'BUY' THEN size ELSE -size END) AS net_size,
    AVG(CASE WHEN side = 'BUY' THEN price END) AS avg_entry_price,
    MAX(block_time) AS last_activity
FROM polymarket.trades
WHERE maker = {{wallet_address}}
  AND block_time >= NOW() - INTERVAL '180' DAY
GROUP BY 1, 2, 3
HAVING net_size > 0
ORDER BY last_activity DESC
LIMIT 100
```

**实现方式：**
1. 在 Dune 后台预先创建参数化查询，获取 `query_id`
2. 后端通过 Dune REST API `POST /api/v1/query/{query_id}/execute` 传入钱包地址
3. 轮询 `GET /api/v1/execution/{execution_id}/results` 获取结果
4. 结果写入本地 SQLite 缓存（有效期 24h）

### 7.2 指标计算公式

```typescript
// 胜率：已解决的仓位中盈利的比例
winRate = resolvedPositions.filter(p => p.pnl > 0).length / resolvedPositions.length

// 总 ROI：基于已解决仓位的总投入
totalRoi = totalPnl / totalCost

// 夏普近似值（用每笔交易 ROI 的均值/标准差近似）
const returns = resolvedPositions.map(p => p.pnl / (p.size * p.price))
sharpeApprox = mean(returns) / stdDev(returns)

// 累计 ROI 时间序列（用于图表）
// 按 closedAt 排序，逐笔累加 pnl / totalCost
```

### 7.3 AI 摘要 Prompt 设计

```
System: 你是一个专业的量化基金分析师，擅长从交易记录中提炼策略特征。

User:
以下是一个 Polymarket 交易者的历史数据摘要，请用 2-3 段话分析其信号风格：

- 总交易次数：{totalTrades}
- 胜率：{winRate}%
- 总 ROI：{totalRoi}%
- 夏普近似值：{sharpeApprox}
- 平均持仓天数：{avgHoldDays}
- 偏好市场类型：{topCategories}（如：加密货币价格、政治事件、体育）
- 近期 5 笔交易方向分布：{recentDirections}

请分析：
1. 该交易者的核心优势（例如：擅长逆势、高概率短期事件等）
2. 风险偏好特征（保守/激进，集中/分散）
3. 适合跟单的投资者类型

输出格式：纯文本，不要使用 Markdown，控制在 150 字以内。
```

### 7.4 订阅验证逻辑

```typescript
// POST /api/subscribe/verify
async function verifySubscription(txHash, providerAddress, subscriberAddress) {
  // 1. 用 viem 查 Transaction Receipt
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
  
  // 2. 解析 USDC Transfer 事件
  const transferLog = receipt.logs.find(log => 
    log.address.toLowerCase() === USDC_POLYGON_ADDRESS.toLowerCase() &&
    log.topics[0] === TRANSFER_EVENT_TOPIC
  )
  
  // 3. 验证：from = subscriber, to = provider treasury, amount >= monthlyFee
  const { from, to, value } = decodeTransferLog(transferLog)
  assert(from.toLowerCase() === subscriberAddress.toLowerCase())
  assert(to.toLowerCase() === TREASURY_ADDRESS.toLowerCase())  // 收款地址
  assert(value >= provider.monthlyFeeUsdc * 1e6)  // USDC 6 decimals
  
  // 4. 写入 Subscription 记录
  return prisma.subscription.create({
    data: {
      subscriberAddr: subscriberAddress,
      providerId: provider.id,
      txHash,
      amountUsdc: Number(value) / 1e6,
      paidAt: new Date(),
      expiresAt: addDays(new Date(), 30)
    }
  })
}
```

---

## 八、技术栈清单

### 8.1 完整依赖列表

```
Frontend / Full-stack Framework
  next@14.x                    App Router, API Routes, ISR
  react@18.x
  typescript@5.x               strict mode

Styling
  tailwindcss@3.x
  @shadcn/ui                   组件库
  recharts@2.x                 业绩折线图

Web3
  wagmi@2.x                    React hooks for Ethereum
  viem@2.x                     底层链交互
  @rainbow-me/rainbowkit@2.x   钱包连接 UI

Data
  @prisma/client               ORM
  prisma                       Schema + Migration CLI
  better-sqlite3               SQLite driver

External APIs
  dune-client（通过 REST，不用 Python 包，直接 fetch）
  @polymarket/clob-client-v2   Polymarket 数据读取
  openai@4.x                   GPT-4o

Utilities
  date-fns                     日期计算
  zod                          API 入参校验
  swr                          Client-side 数据获取 + 轮询
```

### 8.2 环境变量

```env
# Dune Analytics
DUNE_API_KEY=

# OpenAI
OPENAI_API_KEY=

# Polymarket
POLYMARKET_CLOB_HOST=https://clob.polymarket.com

# Chain
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/...
USDC_POLYGON_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
TREASURY_ADDRESS=      # 收款钱包地址（演示用）

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=file:./dev.db

# Dune Query IDs（预先创建好的参数化查询）
DUNE_POLYMARKET_POSITIONS_QUERY_ID=
DUNE_POLYMARKET_PNL_QUERY_ID=
```

---

## 九、目录结构

```
signal-vault/
├── .cursorrules
├── .env                        # gitignored
├── .env.example
├── README.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
│
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                 # Demo 数据填充
│
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Landing / Leaderboard
│   │   ├── provider/[address]/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── publish/page.tsx
│   │   ├── register/page.tsx
│   │   └── api/
│   │       ├── providers/
│   │       │   ├── route.ts                 # GET list
│   │       │   ├── register/route.ts        # POST
│   │       │   └── [address]/
│   │       │       ├── route.ts             # GET detail
│   │       │       ├── positions/route.ts
│   │       │       ├── signals/route.ts
│   │       │       └── refresh/route.ts     # POST
│   │       ├── signals/
│   │       │   ├── route.ts                 # POST publish
│   │       │   └── feed/route.ts            # GET feed
│   │       └── subscribe/
│   │           ├── verify/route.ts          # POST
│   │           └── status/[address]/route.ts
│   │
│   ├── components/             # React 组件
│   │   ├── layout/
│   │   ├── leaderboard/
│   │   ├── provider/
│   │   ├── feed/
│   │   └── ui/                 # shadcn/ui
│   │
│   ├── lib/                    # 工具函数 / 客户端
│   │   ├── dune.ts             # Dune REST API client
│   │   ├── polymarket.ts       # Polymarket CLOB wrapper
│   │   ├── openai.ts           # AI 摘要生成
│   │   ├── metrics.ts          # 业绩指标计算
│   │   ├── viem.ts             # publicClient + 工具函数
│   │   ├── wagmi.ts            # wagmi config
│   │   └── db.ts               # Prisma client singleton
│   │
│   └── types/
│       └── index.ts            # 全局 TypeScript 类型
```

---

## 十、开发阶段规划

### 10.1 时间轴（按 48h Hackathon 节奏）

```
Hour 0–4   Phase 1: 脚手架
  - Next.js 初始化 + 依赖安装
  - Prisma schema + migrate
  - .env 配置

Hour 4–12  Phase 2: 数据层（最核心）
  - Dune client 实现 + 测试查询
  - Polymarket CLOB wrapper
  - 指标计算器
  - AI 摘要生成器

Hour 12–20 Phase 3: API Routes
  - 全部 API 路由实现
  - 订阅验证逻辑
  - Seed 数据

Hour 20–36 Phase 4: 前端
  - 排行榜首页
  - 提供者主页 + 图表
  - 订阅支付流程
  - 信号 Feed

Hour 36–42 Phase 5: 集成 & 调试
  - 端到端流程打通
  - Mock 数据完善

Hour 42–48 Phase 6: 打磨
  - UI 细节
  - README + Demo 脚本
  - 部署（Vercel）
```

### 10.2 优先级矩阵

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 业绩展示（Dune 数据 + 图表） | P0 | 核心 WOW 点，演示必须有 |
| AI 摘要 | P0 | 差异化亮点，5 分钟内可实现 |
| 排行榜 | P0 | 首屏，必须有 |
| USDC 订阅支付 | P1 | 演示时可以 mock txHash |
| 信号延时推送 | P1 | 核心逻辑，需要 |
| 链上订阅验证 | P2 | 演示可以简化为信任用户输入 |
| 提供者注册流程 | P1 | 用 Seed 数据 + 简单表单 |

---

## 十一、风险与应对方案

| 风险 | 概率 | 影响 | 应对方案 |
|------|------|------|----------|
| Dune API 无 Polymarket 链上数据 | 低 | 高 | 改用 Polymarket 官方 API `/data-api/v2/positions` |
| Dune 查询执行慢（30s+） | 中 | 中 | 结果缓存 24h，首次展示 loading 状态 |
| Polymarket CLOB 速率限制 | 中 | 低 | 本地缓存 + 降低刷新频率 |
| USDC 授权流程复杂 | 中 | 中 | 演示时预置测试钱包 + mock verify |
| Polygon RPC 不稳定 | 低 | 中 | 备用 RPC（Infura / QuickNode） |
| OpenAI API 响应慢 | 低 | 低 | 摘要结果缓存 24h，异步生成 |

---

## 十二、演示脚本（Demo Day 用）

```
[0:00] 打开首页
  "这是 SignalVault，量化信号订阅市场。
   你看到的每一个提供者，他们的业绩来自 Polymarket 的链上记录——不可造假。"

[0:30] 点击排名第一的提供者
  "这位提供者过去 90 天胜率 68%，累计 ROI 42%，
   这条折线图里每一个点都对应一笔 Polymarket 链上仓位。"

[1:00] 展示 AI 摘要卡片
  "AI 根据他的交易记录，自动归纳了他的策略风格——
   他擅长在政治事件发生前 48 小时建仓，属于信息敏感型选手。"

[1:30] 点击 Subscribe
  "我现在用 10 USDC / 月订阅他。钱包确认，支付完成。"

[2:00] 切换到 Dashboard
  "进入信号 Feed。这里显示的是订阅者能看到的信号——
   提供者下注后 30 分钟才推送，保护他的先发优势。"

[2:30] 展示信号卡片
  "他刚刚在 Polymarket 押注了'以太坊 ETF 在 6 月通过'方向为 YES，
   置信度 4/5。我们收到了延时提醒，可以自行跟单。"

[3:00] 总结
  "链上公证 + AI 解析 + 订阅支付，SignalVault 让量化 Alpha 流动起来，
   但不泄露。"
```

---

*文档状态：草稿，随开发进展持续更新*


import TelegramBot from 'node-telegram-bot-api'
import { readFileSync } from 'node:fs'

const BOT_TOKEN = process.env.TG_BOT_TOKEN!
const CHAT_ID = process.env.TG_CHAT_ID!
const PROXY = process.env.HTTPS_PROXY  // 国内必填，例：http://127.0.0.1:7890

if (!BOT_TOKEN || !CHAT_ID) {
  console.warn('[telegram] TG_BOT_TOKEN or TG_CHAT_ID missing, alerts will be no-op')
}

// 底层 request 库其实会自动读 HTTPS_PROXY；这里再显式传一遍 request.proxy，
// 是为了不依赖运行环境是否带着环境变量（比如 pm2 / launchd 里漏配）
const botOpts: any = { polling: false }
if (PROXY) botOpts.request = { proxy: PROXY }

// 推送专用 bot：永远 polling:false。可以在多个进程里 import，互不冲突。
export const pushBot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, botOpts) : null

// /status、/snapshot 用的轻量内存状态：主循环每轮决策后更新它
export const botState = {
  totalDecisions: 0,
  alertsTriggered: 0,     // 支付方向：自动支付次数
  lastTxUrl: '',          // 最近一笔链上动作的 basescan 链接
}

// In-memory dedupe map
const recentAlerts = new Map<string, number>()

// Mute state
let muteUntil = 0

export function isMuted() {
  return Date.now() < muteUntil
}

export function muteAlertsFor(ms: number) {
  muteUntil = Date.now() + ms
}

export async function sendTGAlert(
  text: string,
  opts: {
    dedupeKey?: string
    dedupeWindowMs?: number
    extra?: TelegramBot.SendMessageOptions
  } = {}
) {
  if (!pushBot) {
    console.log('[telegram-noop]', text)
    return
  }

  if (isMuted()) {
    console.log('[telegram-muted]', text)
    return
  }

  if (opts.dedupeKey) {
    const last = recentAlerts.get(opts.dedupeKey)
    const win = opts.dedupeWindowMs ?? 30 * 60 * 1000
    if (last && Date.now() - last < win) {
      console.log(`[telegram-dedupe] ${opts.dedupeKey}`)
      return
    }
    recentAlerts.set(opts.dedupeKey, Date.now())
  }

  try {
    await pushBot.sendMessage(CHAT_ID, text, {
      parse_mode: 'Markdown',
      ...opts.extra,
    })
  } catch (err) {
    console.error('[telegram] sendMessage failed', err)
  }
}

// 交互模式：内部新建一个 polling:true 的本地 bot，整个项目中只能调一次。
// 通常只在 worker / agent 二选一的入口里调；千万不要在两个进程里都调。
export async function setupCommands() {
  if (!BOT_TOKEN) return

  const interactiveOpts: any = { polling: true }
  if (PROXY) interactiveOpts.request = { proxy: PROXY }
  const interactiveBot = new TelegramBot(BOT_TOKEN, interactiveOpts)

  await interactiveBot.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'status', description: 'Show current monitoring status' },
    { command: 'snapshot', description: 'Get the latest data snapshot' },
    { command: 'mute', description: 'Mute alerts for 1 hour' },
    { command: 'help', description: 'Show all available commands' },
  ])

  interactiveBot.onText(/\/start/, (msg) => {
    interactiveBot.sendMessage(msg.chat.id, 'Hackcamp Alert Bot started ✅\nSend /help to see commands.')
  })

  interactiveBot.onText(/\/help/, (msg) => {
    const text = `
*Available commands:*
/status - stats since start
/snapshot - latest snapshot
/mute - mute for 1 hour
    `.trim()
    interactiveBot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
  })

  interactiveBot.onText(/\/status/, async (msg) => {
    const text = `
*📊 Stats (since start)*
- Total decisions: ${botState.totalDecisions}
- Triggered alerts: ${botState.alertsTriggered}
- Last TX: ${botState.lastTxUrl || '—'}
- Mute status: ${isMuted() ? '🔇 muted' : '🔔 active'}
    `.trim()
    interactiveBot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
  })

  interactiveBot.onText(/\/snapshot/, async (msg) => {
    // 数据方向：读 snapshot.json 的最后一条
    // 支付方向：没有 snapshot.json，回 botState.lastTxUrl（最近一笔 receipt 的链上链接）
    let formatted = 'No snapshot yet.'
    try {
      const arr = JSON.parse(readFileSync('../web/public/snapshot.json', 'utf8'))
      if (arr.length) formatted = '```json\n' + JSON.stringify(arr[arr.length - 1], null, 2) + '\n```'
    } catch { /* 支付方向没有这个文件，走下面的兜底 */ }
    if (formatted === 'No snapshot yet.' && botState.lastTxUrl) formatted = `Latest receipt TX: ${botState.lastTxUrl}`
    interactiveBot.sendMessage(msg.chat.id, formatted, { parse_mode: 'Markdown' })
  })

  interactiveBot.onText(/\/mute/, (msg) => {
    muteAlertsFor(60 * 60 * 1000)
    interactiveBot.sendMessage(msg.chat.id, '🔇 Alerts muted for 1 hour.')
  })

  interactiveBot.on('callback_query', async (query) => {
    if (query.data === 'mute_60') {
      muteAlertsFor(60 * 60 * 1000)
      await interactiveBot.answerCallbackQuery(query.id, { text: 'Muted for 1 hour ✅' })
    }
  })
}


import { sendTGAlert } from './notify'

const msg = `
*🚨 ${urgency.toUpperCase()} Market Alert*
*Token:* \`${tokenId}\`
*Change:* ${changeStr}% in 1h
*Current:* ${currentPrice}
*Reason:* ${reason}

[View on Polymarket](https://polymarket.com/...)
`.trim()

await sendTGAlert(msg, {
  dedupeKey: `alert:${tokenId}:${direction}`,
  dedupeWindowMs: 30 * 60 * 1000,
  extra: {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊 Dashboard', url: 'https://your-vercel.app' },
          { text: '🔇 Mute 1h', callback_data: 'mute_60' },
        ],
      ],
    },
  },
})