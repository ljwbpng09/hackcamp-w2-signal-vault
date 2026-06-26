Polymarket 是预测市场，每个 "Market" 是一个事件（"2026 年世界杯德国夺冠？"），每个 Market 由若干个 "Outcome Token"（"是" / "否"）组成。
你需要知道的几个 ID：
- conditionId：一个事件的 ID（每个 Market 都有）。
- tokenId：每个 Outcome Token 的 ID（一个 Market 通常有 2 个 tokenId，对应"是 / 否"）。这是读价格时最常用的 ID。
- marketId：和 conditionId 类似（API 不同 endpoint 用的字段名不同）。
“
拿 tokenId 最稳的方式是用发现接口（无需鉴权）：
# 按 conditionId 查一个 market 的元数据（含两个 outcome 的 tokenId）
curl "https://gamma-api.polymarket.com/markets?condition_ids=<conditionId>"
”
也可以在 Polymarket 网站上找事件，从 URL / 页面拿到 conditionId 再用上面接口换 tokenId。

内存数组 + snapshot.json
D1 讲过本周架构没有数据库。worker 的"存储"就两层：
1. 内存数组：轮询到的每条 { tokenId, price, timestamp } push 进数组。
2. snapshot.json：每轮轮询后，把最近 N 条整体覆写到 web/public/snapshot.json，web 端直接 fetch 这个文件画图。
核心就这几行（worker 在 worker/ 目录下跑，所以是相对路径 ../web/public/）：
“
import { writeFileSync } from 'node:fs'

snapshots.push({ tokenId, price, timestamp: Date.now() })
writeFileSync('../web/public/snapshot.json', JSON.stringify(snapshots.slice(-500), null, 2))
”
为什么这样就够了？Demo 阶段你要的不是"数据库"，是"前端能画出真实历史曲线"。snapshot.json 同时解决了三件事：本地开发时 web 直接读；部署时跟着 git push 一起上 Vercel；评委 clone 仓库就能看到真实数据样本。进程重启丢内存数据没关系——文件里的历史还在，worker 启动时把文件读回数组即可（这个需求写进生成 Prompt）。


错误处理 3 个工程模式（写进 Prompt，不手写）
这一节适用于所有方向。Week 2 任何 API 调用都建议套这三层：
- 模式 1：超时 + 重试 + 退避。 请求失败别立刻放弃，等一两秒重试，再失败就跳过本轮；重试时加随机抖动，避免一堆请求同时重试。axios 的超时要显式传（timeout: 10_000）。
- 模式 2：限流。 Polymarket / Etherscan / Alchemy 都有速率限制（rate limit）。轮询间隔别低于 60 秒；收到 429 时退避更久。
- 模式 3：失败兜底（别让一次失败弄崩整个 demo）。 重试用完还失败的请求，别默默吞掉、也别 throw 到最外层把进程弄崩——catch 住、记一条日志，让主流程带着上一次的好数据继续跑。
重点：这三层不需要你手写一套"重试框架"。 你的工作是把需求写清楚、写进生成 Prompt（4.2 有可复制版本），让 AI 在每个外部调用处直接生成对应处理，然后你验收：故意断网 / 填错 URL 跑一轮，看进程是不是"打了日志、跳过本轮、没崩"。
这三层的价值在于：评委在跑你的 demo 时，某个 API 抽风也不会让你的项目崩屏 / 白屏。能顺利演示完，比任何工程细节都加分。


知识点速查
- Function Calling 是 LLM 调用"工具"的能力：你给 LLM 一组工具描述（schema），LLM 在回答时可以选择"调哪个工具、传什么参数"。整个判断由 LLM 自主完成。
- LLM 的决策是由 prompt + tools schema 设计出来的。Prompt 写得越具体，决策越稳；Tools schema 越精确，"调错工具"越少。
- 每一次 LLM 决策都要留痕：支付方向每次决策调 issueReceipt 写成链上事件；数据方向只在告警时调 anchor 上链（常规轮次留在控制台日志 / snapshot.json 里）。评委查的是链上 TX，不是你的表结构。
- 轮询适合：数据源没 Push 能力 / 每分钟级别更新 / Demo 需要可控时序。Webhook / 事件流适合：链上事件 / 高频数据 / 生产级低延迟。Week 2 优先用轮询，简单且容易演示。
- Function Calling 用 tools 参数定义工具、tool_choice 控制策略。tool_choice 默认让 LLM 自己决定是否用工具（OpenAI / DeepSeek 写 'auto'；Claude 原生写 { type: 'auto' }，对比见 4.1.1）。

Function Calling 是什么
最简化版的理解：
普通调 LLM：
- 你发一段 prompt 给 LLM。
- LLM 回一段文本。
Function Calling：
- 你发一段 prompt 和一组工具描述（tools schema） 给 LLM。
- LLM 看完后，要么返回文本（不需要用工具），要么返回 { tool: "xxx", args: {...} }（要用某个工具，参数是这些）。
- 你的代码收到 LLM 的"工具调用请求"后，真正执行那个函数，把结果再传回给 LLM。
- LLM 拿到结果后，决定继续调工具还是输出最终答案。

决策prompt
“
你是一个负责 [具体场景] 的 AI Agent。
你的目标是：[一句话目标]。
你可以使用的工具：[列出 tools 名 + 1 行说明]。

下面是当前的数据和上下文：
- 当前数据：[结构化数据]
- 历史数据（最近 N 条）：[结构化数据]
- 当前预算 / 状态：[结构化数据]

请基于上面信息判断：
1. 当前情况是否需要采取行动？
2. 如果需要，调用哪个工具，参数是什么？
3. 如果不需要，输出一段 ≤ 50 字的判断理由。

注意事项：
- [明确告诉它什么时候不要触发，避免误报]
- [明确告诉它边界条件]
- [明确告诉它优先级]
”



# AI Blackbox · Demo Video Script (3 min)

> 录制前准备：
> 1. worker 已跑至少 30 分钟，snapshot.json 有数据
> 2. 把 POLL_INTERVAL_MS 临时改成 15000、把告警阈值调低，确保录制中能触发一次真实 trigger_alert
> 3. 手机开屏，Telegram @Hackcamp_bot 聊天界面准备好
> 4. 浏览器标签页提前打开：Dashboard / Etherscan 合约页 / 终端
> 5. 录制分辨率 1920×1080，录完后剪辑拼接

---

## 0:00 - 0:30 · Hook（不出现任何技术词）

**[Screen]**
全黑屏，缓慢淡入：手机屏幕特写，显示五场世界杯比赛的实时比分画面。
0:08 时切到：盘口数字大幅跳动的 GIF / 截图（可用 Polymarket 网页录屏）。
0:18 时切到：AI Blackbox Dashboard 全屏（浏览器无地址栏，纯内容）。

**[Voice]**
（0:00）"今晚有五场世界杯。赔率在跳。你只有几秒钟决定跟不跟。"
（0:08）"大多数工具会给你发提醒。然后赛后改口说'我早就知道'。"
（0:18）"AI Blackbox 只做一件事：在结果出来之前，先签字。"

**[Action]**
- 0:00 黑屏淡入手机特写，慢推镜头
- 0:08 硬切到盘口跳动画面（快速剪辑，2-3 帧）
- 0:18 硬切到 Dashboard 全屏，停留到 0:30

---

## 0:30 - 0:50 · 产品全貌

**[Screen]**
Dashboard 全屏。顶部标题 "AI Blackbox"、副标题 "Commit first. Score later." 清晰可见。
鼠标缓慢滑过市场标签页，展示 16 个市场标签。

**[Voice]**
（0:30）"这是今晚的监控面板。16 个世界杯市场同时在跑。"
（0:38）"它是怎么知道今晚有哪些比赛的？自动发现的——每轮轮询直接去 Polymarket 查今天的赛程。"

**[Action]**
- 0:30 鼠标从左往右慢速滑过市场标签，停在"Will England win on 2026-06-26?"
- 0:42 点击该标签，切换到 England 市场视图，价格折线图出现在屏幕中央
- 0:48 停留，等待下一段

---

## 0:50 - 1:10 · AI 正在思考（视觉化）

**[Screen]**
左右分屏：
- 左半屏：Dashboard 价格折线图，曲线出现一个小幅上涨波动
- 右半屏：终端窗口（字体放大到 18px），实时滚动 worker 日志

终端输出逐行出现，重点行用高亮颜色（可事后剪辑加色块）：
```
[index] poll #47 — England  prob=12.40% (+4.2pp in 3 readings)
[llm]   evaluating anomaly...
[llm]   CoT: 连续上涨 +4.2pp，偏离近1小时均值 2.1σ — 触发阈值
[llm]   → trigger_alert  direction=UP  urgency=high
[alert] filing on-chain prediction...
```

**[Voice]**
（0:50）"价格在最近三次读取里连续上涨了 4 个百分点。"
（0:57）"LLM 拿到最近 60 条价格记录，开始判断：这是信号，还是噪音？"
（1:04）"它的结论：上涨方向，紧急程度高。"
（1:08）"然后它做了一件普通告警工具不会做的事——"

**[Action]**
- 0:50 折线图上用动效圆圈标出最近 3 个上涨点
- 0:57 右侧终端开始逐行滚动，每行 0.5 秒出现
- 1:05 `trigger_alert direction=UP` 那行用红色高亮框住，停留 3 秒

---

## 1:10 - 1:30 · 链上签字

**[Screen]**
全屏切到 Sepolia Etherscan，合约地址页面：
`https://sepolia.etherscan.io/address/0xb894f59EE1531FA17cebb90D6d80E0A0fb597191`
滚动到 Events 标签，最新一条 `PredictionMade` 事件高亮。

1:20 展开事件详情，展示字段：
- `direction`: "UP"
- `probAtAlertBps`: 1240（即 12.40%）
- `deadline`: （unix 时间戳）
- `reporter`: 钱包地址

**[Voice]**
（1:08 接续）"——它把这次判断写进了区块链。"
（1:12）"这是 Sepolia 上的合约，刚刚生成的 PredictionMade 事件。"
（1:20）"方向：UP。概率：12.40%。时间戳锁死。一字不能改。"
（1:26）"任何人现在就能来这里验证，不需要信任我们一个字。"

**[Action]**
- 1:10 硬切到 Etherscan，鼠标直接点 Events 标签
- 1:16 缓慢滚动到最新 PredictionMade 行，用鼠标悬停高亮
- 1:20 点击展开，逐字段用鼠标划过
- 1:28 缩小页面，让合约地址 `0xb894...7191` 和事件同时在屏幕上可见

---

## 1:30 - 1:50 · Telegram 推送

**[Screen]**
切到手机录屏（竖屏，居中放置在画面中）。
Telegram 聊天界面，@Hackcamp_bot，新消息弹出：

```
🔔 Alert · England
Direction : UP
Prob now  : 12.40%  (+4.2pp)
Urgency   : HIGH
On-chain  : 0xb894...7191 · id=12
```

1:42 在手机上手动输入 `/add france`，bot 返回搜索结果和内联按钮。

**[Voice]**
（1:30）"同一时刻，Telegram 收到推送。"
（1:36）"现在我现场加一个市场——"
（1:40）"发送 /add france，bot 搜索 Polymarket，返回匹配的市场。"
（1:46）"点一下，60 秒后 France 出现在监控列表里。评委可以自己试。"

**[Action]**
- 1:30 切到手机录屏，消息已在屏幕上，停留 4 秒
- 1:38 手动在 Telegram 输入 `/add france`
- 1:44 镜头停在 bot 返回的内联按钮画面，点击确认
- 1:48 bot 回复 "Market queued · Will appear in ~60s"

---

## 1:50 - 2:00 · Dashboard 战绩更新

**[Screen]**
切回 Dashboard，滚动到 "AI Track Record" 卡片。
显示：胜率数字、已结算次数，以及最新一条决策记录（展开，含 Etherscan TX 链接）。

**[Voice]**
（1:50）"10 分钟后系统自动结算，战绩实时更新在这里。"
（1:56）"每一条记录都链着 Etherscan TX，这不是展示数据，是可验证的证据。"

**[Action]**
- 1:50 切回 Dashboard，鼠标慢速滚到 AI Track Record 区域
- 1:54 点击展开最新一条决策记录，Etherscan 链接可见
- 1:58 停留在这个画面，过渡到下一段

---

## 2:00 - 2:30 · 技术深度（15 秒架构 + 15 秒关键代码）

**[Screen · 2:00-2:15]**
切到 GitHub README 页面，滚动到 Mermaid 架构图位置，图已渲染。
用鼠标沿主数据流路径（Polymarket → Worker → LLM → Sepolia → Telegram）缓慢划过。

**[Voice · 2:00-2:15]**
（2:00）"整个系统链下和链上各司其职。"
（2:06）"Polymarket 提供数据，LLM 做判断，Sepolia 做存证，Telegram 做通知。"
（2:12）"没有数据库，没有中心化存储，持久化靠链上事件。"

**[Action · 2:00-2:15]**
- 2:00 切到 GitHub README，架构图已渲染可见
- 2:04 鼠标从 Polymarket 节点缓慢沿箭头划到 SignalVault.sol 节点
- 2:12 用矩形框短暂框住 On-chain subgraph 区域

---

**[Screen · 2:15-2:30]**
切到代码编辑器（VS Code），打开 `worker/src/alert.ts`，
聚焦到 `trigger_alert` 工具定义和 `makePrediction` 调用那几行。
字体放大，背景暗色主题。

**[Voice · 2:15-2:30]**
（2:15）"这是 AI 触发告警时的调用链。"
（2:20）"trigger_alert 被调用，方向和概率立刻写进 SignalVault 合约。"
（2:26）"合约地址是死的，结果是链上的，我们不持有任何可修改的状态。"

**[Action · 2:15-2:30]**
- 2:15 切到 VS Code，`alert.ts` 已打开在 trigger_alert 附近
- 2:18 鼠标高亮 `makePrediction()` 调用行
- 2:24 切到 `registry.ts`，高亮 `simulateContract` 和 `writeContract` 两行
- 2:28 停留

---

## 2:30 - 2:55 · 结尾收场

**[Screen · 2:30-2:45]**
切到 README Roadmap 章节，三段（Done / Next 4 weeks / 3-6 months）静止可见。

**[Voice · 2:30-2:45]**
（2:30）"三周内从零到 16 个市场同时在跑。"
（2:35）"下一步，把这个告警引擎封装成 CROO CAP 的可付费端点。"
（2:40）"其他 Agent 付费调用之前，先查链上战绩，再决定值不值得信。"
（2:44）"这才是 AI 信号商业化的正确路径。"

**[Action · 2:30-2:45]**
- 2:30 缓慢滚动 Roadmap，"Done" 行逐条出现
- 2:38 停在 "CROO CAP 端点" 那一行，鼠标高亮

---

**[Screen · 2:45-2:55]**
全屏切到 ai-blackbox.vercel.app 落地页，完整可见：标题 "AI Blackbox"、Tagline "Commit first. Score later."、两个按钮（Open Dashboard / GitHub）。

**[Voice · 2:45-2:55]**
（2:45）"代码开源，合约在 Sepolia 上，任何人现在就能去验证。"
（2:50）"如果一个 AI 不能在结果前签字，它就不配谈准确率。"

**[Action · 2:45-2:55]**
- 2:45 浏览器全屏展示落地页，无地址栏
- 2:50 缓慢放大标题和 Tagline，停在画面中央

---

**[Screen · 2:55-3:00]**
静止画面：白字黑底，居中三行——
```
AI Blackbox
ai-blackbox.vercel.app
Commit first. Score later.
```
持续 5 秒不动。

**[Voice · 2:55-3:00]**
（静音，或轻音乐淡出）

**[Action]**
- 硬切到静止画面，保持 5 秒
- 结束

---

> 录制 Tips：
> - 用 OBS 或 QuickTime 录制，分段录再剪辑，不要一镜到底
> - 手机录屏用 iPhone 镜像或 QuickTime → iPhone，避免竖屏变形
> - "AI 思考"那段终端日志如果触发时机不确定，提前把那段 console 输出录好备用
> - Etherscan 页面提前刷新，确保最新 TX 在第一屏