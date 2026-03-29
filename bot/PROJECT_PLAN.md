# Arbitrage Bot 实际可用版本工作计划

## 目标边界

P0 目标不是“做出所有策略”，而是把当前 `bot/` 的模拟骨架推进成一条**实际可用的单策略闭环**：

- 策略只保留同市场静态套利：`YES + NO < 1 - 成本`
- 行情输入从合成 tick 升级为标准化事件流，支持真实接入与验证模式共存
- 执行从公式模拟升级为“双腿执行计划 + TTL + IOC 补腿 + 订单状态跟踪”
- 风控从占位接口升级为强制约束：尺寸裁剪、只减仓、日内亏损、回撤、kill switch
- 研究与线上共享同一口径：默认参数由离线任务生成，在线模块统一读取已批准配置

## 路线图

| 阶段 | 目标 | 必做项 | 可延后项 | 验收输出 |
|---|---|---|---|---|
| P0 | 单策略真实闭环 | 契约冻结、默认配置、事件流、双腿执行、强制风控、核心指标、paper 入口 | 统计套利、微观结构、复杂库存模型 | `bot/` 可运行、Paper 方案、Gate 文档 |
| P1 | 小资金灰度 | 监控、告警、参数版本审计、回滚流程、连续稳定运行 | 自动调参、更多市场扩容 | 灰度运行记录、告警规则、回滚手册 |
| P2 | 策略扩展 | `Spread`、完整 `Stoikov`、多市场配对、更细库存控制 | 更复杂组合优化 | 扩展策略设计与回测结果 |

## 离线 / 在线职责划分

### 离线程序

- 定期生成 `bot/config/generated/runtime-defaults.json`
- 汇总 Bayesian / Edge / Spread / Stoikov / Kelly / Monte Carlo 的默认参数
- 产出市场白名单、风险阈值、版本号、样本窗口、审批状态
- 未批准的配置不得直接进入 `paper` / `live-safe`

### 在线模块

- 统一从 `bot/config/runtime.ts` 读取最新已批准默认参数
- 热路径只做轻量实时计算：`Edge + Kelly + 强制 Risk`
- `Bayesian` 可以降级或禁用
- `Monte Carlo` 不进入在线热路径，只消费固化后的白名单和禁止上线规则

## 模块拆解

### 1. Contracts

- 冻结 `bot/contracts/types.ts` 为唯一运行契约
- 补足：`MarketTokenMap`、`OpportunityLeg`、`ExecutionPlan`、`RiskState`、`OrderIntent`、`OrderUpdate`
- 统一表达 `GTC/IOC/FOK`、`yes/no`、`buy/sell`、TTL、风险拒绝原因

### 2. Config

- 新增 `bot/config/runtime.ts`：在线读取默认配置的唯一入口
- 新增 `bot/config/generated/runtime-defaults.json`：离线定期生成的版本化默认参数
- 新增 `bot/offline/update-runtime-config.ts`：离线更新任务

### 3. Ingest / Integration

- 保留 `SyntheticTick` 用于 simulation
- 新增标准化事件结构，统一 `snapshot / book_update / trade_print / order_ack / fill`
- `bot/integration/real-data.ts` 降级为验证入口，负责把 Gamma 数据映射到标准化市场描述与验证 tick
- 预留 `bot/integration/exchange.ts` 作为 bot 专用交易适配层

### 4. Signal / Execution / Risk

- `Signal` 只保留 `static_arb`
- `Execution` 实现被动首腿、TTL 到期、IOC 补腿、部分成交、撤单与失败记账
- `Risk` 强制参与尺寸裁剪、开仓阻断、只减仓、熔断与恢复

### 5. Metrics / Research / Rollout

- 指标统一统计：机会数、双腿完成率、滑点、回撤、拒单原因、连续失败次数
- `Monte Carlo` 输出 CVaR / MDD / 上线白名单
- `README` 需要说明 simulation、paper、配置刷新、灰度与回滚步骤

## 当前 P0 必做清单

1. 冻结契约与 P0 范围
2. 建立离线产参 -> 默认配置 -> 在线读取链路
3. 标准化事件流与市场元信息
4. 执行器支持双腿与补腿
5. 风控接入真实状态对象
6. 指标 / Gate / Paper 手册补齐

## P0 Gate

- 双腿完成率 `>= 95%`
- 扣费和执行成本后平均净 EV `> 0`
- 风控穿透事故 `= 0`
- 最大回撤 `<= 预算阈值`
- 回放口径与在线记录一致

## 回滚规则

- 新配置未审批：不得启用
- 连续失败超阈值：进入 only-reduce 或 kill switch
- Drawdown / 日内亏损超阈值：停止新开仓
- 发现订单状态无法对齐：回退到上一版已批准配置

## 交付物

- `bot/PROJECT_PLAN.md`：路线图与 Gate
- `bot/README.md`：运行、paper、离线参数更新、灰度手册
- `bot/config/generated/runtime-defaults.json`：默认参数模板
- `bot/metrics/dashboard.md`：指标口径
- `bot/metrics/alerts.md`：告警规则
- `bot/montecarlo/report.md`：上线白名单与禁止上线条件
