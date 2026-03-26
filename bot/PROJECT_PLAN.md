# Arbitrage Bot 并行开发执行计划（MVP Sprint）

## 目标
在 2-4 周内并行完成一个可验证的 MVP：
- 机会识别：`YES + NO < 1 - c`
- 执行闭环：被动挂单 + 超时 IOC 补腿
- 风控兜底：单笔限额、日内亏损阈值、kill switch

## 子任务编排（并行）

| Agent | 目录 | 任务状态 | 依赖输入 | 输出交付 |
|---|---|---|---|---|
| A Data | `bot/ingest` | TODO | Polymarket WS/REST | `MarketEvent` 流 |
| B Feature | `bot/features` | TODO | `MarketEvent` | `FeatureSnapshot` |
| C Signal | `bot/signal` | TODO | `FeatureSnapshot` | `Opportunity` |
| D Execution | `bot/execution` | TODO | `Opportunity` + `RiskDecision` | `OrderIntent/OrderUpdate` |
| E Risk | `bot/risk` | TODO | `Opportunity` + 持仓/订单 | `RiskDecision` |
| F Research | `bot/backtest` + `bot/montecarlo` | TODO | 历史 Market/Feature 数据 | 参数与稳健性报告 |
| G Ops | `bot/metrics` | TODO | 全链路事件 | Dashboard + Alert |

## 并行执行规则
1. 先冻结 `bot/contracts/types.ts`，所有 Agent 按契约开发。
2. 每个 Agent 独立分支开发，按目录提交。
3. 每日两次同步：
   - 10:00 UTC：接口兼容检查
   - 18:00 UTC：E2E 冒烟状态

## MVP 验收 Gate
- 双腿完成率 >= 95%
- 平均净 EV（扣费后）> 0
- 风控穿透事故 = 0
- 最大回撤 <= 预算阈值
