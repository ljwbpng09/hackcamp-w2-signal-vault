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