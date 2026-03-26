# 套利机器人实现技术设计文档（v0.1）

> 基于 `ARBITRAGE_BOT_TECHNICAL_DESIGN.md` 的“数学模型方案”，本文给出可工程落地的系统设计，覆盖模块边界、数据流、风控门槛、部署与迭代计划。

---

## 1. 文档目标

本文目标是把六模型框架（`Bayesian + Edge + Spread + Stoikov + Kelly + Monte Carlo`）转化为可开发、可测试、可上线的一体化套利系统，并与当前仓库的 Polymarket 能力对齐。

**核心产出：**

1. 明确在线与离线模块拆分。
2. 给出交易决策链路与风控拦截点。
3. 定义最小可上线版本（MVP）与后续迭代路线。
4. 定义关键指标（收益、风险、执行质量）与验收标准。

---

## 2. 设计范围

### 2.1 In Scope（本期）

- Polymarket 二元市场（YES/NO）套利。
- 三类机会：
  - 同市场静态套利（`YES + NO < 1 - 成本阈值`）
  - 相关市场统计套利（价差回归）
  - 盘口失衡短线套利（微观结构）
- 以限价单为主，必要时 IOC/FOK 补腿。
- 统一风控：仓位限额、日内亏损、回撤熔断、异常行情暂停。

### 2.2 Out of Scope（本期不做）

- 高频跨交易所套利（多 venue 路由）。
- 杠杆与借贷策略。
- 自动资金划转与多链再平衡。
- 事件语义大模型预测（仅预留接口）。

---

## 3. 系统总体架构

```text
[Market Data Ingest]
    -> [Feature Engine]
    -> [Signal Engine]
        - Bayesian
        - Edge
        - Spread
    -> [Execution Engine]
        - Stoikov Quote Adjust
        - Kelly Sizing
        - Order Orchestrator
    -> [Risk Engine]
        - Pre-Trade Checks
        - Real-time Limits
        - Kill Switch
    -> [Exchange Adapter: Polymarket CLOB]

Parallel:
[Backtest + Monte Carlo + Parameter Calibration]
[Metrics / Logs / Alerts]
```

### 3.1 部署形态

- **online-trader（常驻进程）**：实时行情、信号、下单、风控。
- **research-worker（批处理）**：回测、蒙特卡洛、参数重估。
- **ops-monitor（监控）**：指标面板、告警、交易日报。

建议初期单机多进程；稳定后可拆分为容器化服务。

---

## 4. 模块设计

## 4.1 Data Ingest（行情接入）

### 责任

- 统一接入订单簿、成交、行情快照、账户订单回报。
- 维护本地有序事件流（event-time + sequence）。

### 输入

- CLOB websocket（盘口增量、成交）
- REST 补齐（快照校准、断线重连）

### 输出

- 标准化事件：`BookUpdate / TradePrint / Snapshot / OrderAck / Fill`

### 关键设计

- 本地 order book 重建与校验。
- 时钟统一（本地接收时间 + 交易所时间双字段）。
- 断线回放窗口（例如最近 30s 快照恢复）。

## 4.2 Feature Engine（特征工程）

### 责任

滚动计算模型输入特征：

- 深度失衡（L1/L5/L10）
- 成交主动买卖比
- 微价格偏移与短时动量
- 价差 z-score（跨市场）
- 成交稀疏度与冲击成本估计

### 关键设计

- 固定时间窗 + 成交驱动双视角（例如 100ms / 1s / 10s）。
- 特征延迟预算：P99 < 30ms。
- 特征质量守卫（缺失值、跳点、异常值截断）。

## 4.3 Signal Engine（信号引擎）

### A) Bayesian 子模块

- 输入：盘口失衡、成交动量、波动状态。
- 输出：`p_up, p_down, regime, confidence`。
- 工程策略：
  - 初版用离散状态 + 条件似然表（可解释）。
  - 后续可升级在线贝叶斯网络或粒子滤波。

### B) Edge 子模块

- 统一计算净优势：

\[
EV = \mathbb{E}[payoff] - fees - slippage - latency\_loss - leg\_risk\_cost
\]

- 仅当 `EV > min_ev_threshold` 且 `confidence > min_confidence` 时放行。

### C) Spread 子模块

- 同市场：检测 `YES + NO` 偏离。
- 跨市场：维护配对 spread 的均值/方差/半衰期。
- 输出建议：`entry_price, take_profit, stop_loss, ttl`。

## 4.4 Execution Engine（执行引擎）

### A) Stoikov 报价修正

- 根据库存偏离调整 reservation price 与挂单宽度。
- 避免单边库存持续累积。

### B) Kelly 仓位控制

- 基于 edge 概率优势给出理论仓位，再做风险折扣：

\[
size = clip(kelly\_fraction \times equity \times risk\_multiplier, min, max)
\]

- `risk_multiplier` 由波动、流动性、回撤状态动态调整。

### C) Order Orchestrator（双腿编排）

- 先挂流动性较好的一腿。
- 若部分成交：
  - 超时未补齐则降价补腿（受最大滑点约束）。
  - 到达最大补腿次数后强制平衡或止损退出。
- 所有订单有 TTL，过期自动撤单。

## 4.5 Risk Engine（风险引擎）

### 交易前检查（Pre-trade）

- 单笔最大名义金额。
- 市场最大总敞口。
- 账户可用保证金与 USDC 余额。
- 当前延迟与盘口深度是否满足执行条件。

### 实时风控（In-trade）

- 日内亏损阈值（例如 `-2%`）触发降频。
- 峰值回撤阈值（例如 `-4%`）触发熔断。
- 连续失败交易计数（如 5 次）触发暂停并告警。

### 应急控制

- 全局 Kill Switch：撤单 + 禁止新开仓。
- “只减仓模式”：异常时仅允许平仓。

## 4.6 Research & Monte Carlo（离线研究）

### 责任

- 回放历史逐笔数据，评估信号在不同成本假设下的稳健性。
- 对参数做蒙特卡洛扰动：滑点、延迟、成交率、相关性漂移。

### 产出

- 参数建议区间（不是单点最优）。
- 极端情景下的 CVaR / 最大回撤分布。
- 上线参数白名单（可灰度切换）。

---

## 5. 数据模型（建议）

```ts
type Opportunity = {
  id: string
  marketPair: string[]
  strategyType: 'static_arb' | 'stat_arb' | 'microstructure'
  evBps: number
  confidence: number
  expectedHoldSec: number
  createdAt: number
}

type ExecutionPlan = {
  opportunityId: string
  legs: Array<{ market: string; side: 'buy' | 'sell'; price: number; size: number }>
  ttlMs: number
  maxSlippageBps: number
  hedgePolicy: 'ioc_hedge' | 'passive_then_ioc'
}

type RiskState = {
  equity: number
  intradayPnl: number
  peakToTroughDrawdown: number
  openNotional: number
  killSwitch: boolean
}
```

---

## 6. 与当前仓库的对齐方案

### 6.1 可复用能力

- 已有 `lib/polymarket/*` 交易会话、签名与 relayer 集成能力。
- 已有前端交易链路可用于策略可视化（机会列表、风控状态、PnL）。

### 6.2 新增目录建议

```text
bot/
  config/
  ingest/
  features/
  signal/
  execution/
  risk/
  backtest/
  montecarlo/
  metrics/
```

### 6.3 集成边界

- 策略进程与前端解耦：通过数据库或事件总线共享状态。
- 初期可用 SQLite/Postgres 记录订单与机会，再接可视化页。

---

## 7. 关键指标与验收标准

## 7.1 收益与风险

- 日均净收益（扣费后）
- Sharpe / Sortino
- 最大回撤（MDD）
- CVaR(95%)

## 7.2 执行质量

- 订单成交率
- 双腿完成率
- 平均滑点（bps）
- 机会到下单延迟（p50/p95/p99）

## 7.3 稳定性

- 数据流中断恢复时间
- 进程可用性（uptime）
- 告警误报率/漏报率

**MVP 验收（建议）：**

1. 回测 3 个月，扣费后收益为正，MDD 在预算内。
2. 纸交易 2 周，执行指标稳定且无重大风控事故。
3. 小资金灰度 1 周，通过后逐步放量。

---

## 8. 参数管理与配置

- 参数分层：
  - `global`：全局风控（max drawdown, kill switch）
  - `strategy`：不同套利子策略阈值
  - `market`：按市场流动性差异调节
- 配置热更新：变更需版本号、审计日志、回滚能力。
- 所有关键阈值必须可观测（看板实时展示当前值）。

---

## 9. 开发里程碑（建议 4 阶段）

### Phase 1（1-2 周）

- 搭建 ingest + feature + 基础 edge 检测。
- 完成纸交易的单腿下单闭环。

### Phase 2（2-3 周）

- 实现双腿编排、补腿策略、实时风控。
- 上线监控与告警。

### Phase 3（2 周）

- 回测框架 + Monte Carlo + 参数校准。
- 建立上线参数白名单。

### Phase 4（持续）

- 小资金实盘灰度。
- 复盘迭代 Bayesian/Spread 模型与执行策略。

---

## 9.1 可并行子任务拆解（Sub-Agent 协作）

> 目标：将任务拆分为可并行推进的工作流，每个子任务都有清晰输入/输出与验收标准，保证 MVP 在 2~4 周内可验证。

### 并行分工建议

| Sub-Agent | 负责模块 | 关键交付物 | 依赖 | 预计周期 |
|---|---|---|---|---|
| A: Data Agent | `ingest/` | 统一行情事件流、orderbook 重建、断线恢复 | 无（最先启动） | 4-6 天 |
| B: Feature Agent | `features/` | 深度失衡、微价格、z-score 特征计算器 | A 的标准化事件 | 3-5 天 |
| C: Signal Agent | `signal/` | Bayesian + Edge + Spread 信号决策 | B 的特征输出 | 4-6 天 |
| D: Execution Agent | `execution/` | Stoikov 报价修正、Kelly 仓位、双腿编排器 | C 的机会信号 | 5-7 天 |
| E: Risk Agent | `risk/` | pre-trade 检查、实时限额、kill switch | D 下单状态流 | 3-5 天 |
| F: Research Agent | `backtest/` `montecarlo/` | 回测框架、参数扰动报告、上线参数白名单 | A/B/C 的历史接口 | 5-7 天 |
| G: Ops Agent | `metrics/` | 指标看板、告警规则、日报模板 | A~F 产生的事件与指标 | 3-4 天 |

### 并行接口契约（先定义，后开发）

为减少阻塞，第一天先冻结以下接口：

1. `MarketEvent`（A -> B/F/G）
2. `FeatureSnapshot`（B -> C/F/G）
3. `Opportunity`（C -> D/E/G）
4. `OrderIntent / OrderUpdate / FillUpdate`（D -> E/G/F）
5. `RiskDecision`（E -> D/G）

建议用 `schema/*.json` 或 `zod` 类型在仓库中统一定义，所有 Sub-Agent 按契约并行开发。

### 并行节奏（建议）

- **Day 1-2**：A/E/G 先行（数据、风控壳、监控壳）；同时冻结 schema。
- **Day 3-6**：B/C/F 并行（特征、信号、回测数据管线）。
- **Day 7-10**：D 与 E 联调执行风控；G 接入全链路指标。
- **Day 11-14**：端到端纸交易 + 缺陷修复 + MVP 验收。

### 落地工件（已初始化）

- 并行开发总控：`bot/PROJECT_PLAN.md`
- 接口契约：`bot/contracts/types.ts`
- 子任务拆解：
  - `bot/tasks/a-ingest.md`
  - `bot/tasks/b-feature.md`
  - `bot/tasks/c-signal.md`
  - `bot/tasks/d-execution.md`
  - `bot/tasks/e-risk.md`
  - `bot/tasks/f-research.md`
  - `bot/tasks/g-ops.md`

---

## 9.2 MVP 可验证方案（必须可量化）

### MVP 最小范围

仅保留一条“可闭环套利链路”：

1. 单一策略：同市场静态套利（`YES + NO < 1 - c`）。
2. 单一执行策略：被动挂单 + 超时 IOC 补腿。
3. 单一风控策略：单笔限额 + 日内亏损阈值 + kill switch。

### MVP 验证环境

- **阶段 1：历史回放**（至少 1 个月数据）
  - 验证机会识别准确率、理论 EV 与成交后 EV 偏差。
- **阶段 2：纸交易**（连续 7-14 天）
  - 验证双腿完成率、滑点、失败补腿率。
- **阶段 3：小资金灰度**
  - 验证真实网络延迟与流动性冲击下的稳定性。

### MVP 通过门槛（建议）

1. 纸交易阶段：`双腿完成率 >= 95%`。
2. 纸交易阶段：`平均净 EV（扣费后） > 0`。
3. 灰度阶段：`无风控穿透事故（0 次）`。
4. 灰度阶段：`最大回撤 <= 预设预算`。

若任一指标未达标，禁止进入放量阶段，需回到对应模块（Signal / Execution / Risk）重标定。

---

## 10. 主要风险与缓解

1. **假优势风险（信号失效）**
   - 缓解：滚动再训练 + online drift 监控 + 自动降权。

2. **补腿失败风险（执行不对称）**
   - 缓解：严格 TTL、IOC 兜底、限滑点、失败熔断。

3. **流动性瞬时蒸发**
   - 缓解：按盘口深度动态限仓，低流动性时只被动挂单。

4. **基础设施故障**
   - 缓解：断线重连、快照恢复、幂等订单管理、灾备节点。

---

## 11. 后续扩展

- 增加“事件语义信号”（新闻/社媒）作为 Bayesian 先验输入。
- 增加跨到期结构套利（term structure）。
- 引入组合层风险预算（多策略统一 VaR / CVaR）。

---

## 12. 结论

该设计把“模型正确性”与“执行可兑现性”同等对待：

- 六模型负责识别并量化优势；
- 执行编排负责把优势转为可成交利润；
- 风控与蒙特卡洛负责保证系统在坏场景下可生存。

建议先以 **MVP + 纸交易 + 小资金灰度** 路径推进，优先验证执行质量与风险可控性，再追求规模化收益。
