---
name: deliver-practical-arbitrage-bot-roadmap
overview: 围绕当前套利机器人原型，整理一份面向“实际可用版本”的工作文档，明确从模拟骨架走向真实可运行系统所需的模块、优先级、里程碑与验收重点。
todos:
  - id: freeze-p0-contracts
    content: 冻结P0范围，更新 bot/PROJECT_PLAN.md 与 bot/contracts/types.ts
    status: completed
  - id: build-live-adapter
    content: 用 [subagent:code-explorer] 补齐 bot/ingest 与 bot/integration 真 CLOB 链路
    status: completed
    dependencies:
      - freeze-p0-contracts
  - id: ship-execution
    content: 重构 bot/execution/orchestrator.ts 实现双腿撤单补腿闭环
    status: completed
    dependencies:
      - freeze-p0-contracts
      - build-live-adapter
  - id: enforce-risk
    content: 打通 bot/risk 与 bot/core/run-engine.ts 强制风控闭环
    status: completed
    dependencies:
      - freeze-p0-contracts
      - ship-execution
  - id: validate-gates
    content: 完善回放、指标、蒙特卡洛并建立上线 Gate
    status: completed
    dependencies:
      - build-live-adapter
      - ship-execution
      - enforce-risk
  - id: paper-rollout
    content: 补齐 bot/tests 与 bot/README.md 纸交易灰度手册
    status: completed
    dependencies:
      - validate-gates
---

## User Requirements

- 基于现有 `ARBITRAGE_BOT_IMPLEMENTATION_TECHNICAL_DESIGN.md` 和当前 `bot/` MVP，实现一份把系统推进到“实际可用版本”的工作文档。
- 文档需要明确“实际可用版本”的边界：真实市场接入、真实订单执行、强制风控、结果记录、回放验证、纸交易和小资金灰度流程都要形成闭环。
- 文档需要分阶段说明必须先做的工作、可延后的工作、依赖关系、主要风险、验收标准和上线前 Gate。

## Product Overview

- 当前版本先围绕单策略闭环推进：同市场静态套利，要求从机会识别到双腿执行、风控拦截、结果归档形成完整流程。
- 运行结果需要能清晰查看机会数量、成交状态、补腿结果、滑点、完成率、回撤、暂停状态和验证结论。

## Core Features

- 真实订单簿和账户事件接入
- 真实双腿下单、撤单、补腿与订单状态跟踪
- 强制 pre-trade 和 in-trade 风控
- 可回放验证、稳健性评估和上线参数白名单
- 关键指标、告警规则、纸交易与灰度验收流程

## Tech Stack Selection

- 复用当前仓库的 Next.js + TypeScript 代码基座，以及 `package.json` 中已存在的 `tsx` 运行脚本体系。
- `bot/` 继续作为独立 TypeScript 运行时推进，保持现有 `pnpm bot:simulate`、`pnpm bot:test`、`pnpm bot:example:real`、`pnpm bot:test:all` 的回归能力。
- 交易接入复用仓库已安装的 Polymarket 依赖与现有参数模型认知，但机器人运行时不要直接依赖浏览器侧会话存储逻辑；`/Users/fengzhi/Downloads/git/prediction-market-starter-kit/lib/polymarket/session.ts` 已标记 `"use client"`，只适合前端会话，不适合作为 bot 运行时状态源。

## Model split: offline vs online

### Offline research responsibilities

- 离线程序负责生成一份版本化默认配置文件，集中固化各模型参数、市场白名单、风险阈值和启停开关；在线模块只消费该配置，不在热路径内做重训练或重校准。
- **Bayesian**：训练先验概率、特征权重，产出先验参数、置信度阈值和可选过滤开关。
- **Edge**：校准成本参数、手续费结构、滑点和补腿失败成本，产出净优势参数版本。
- **Spread**：海选市场、确定关注列表或候选配对，控制在线扫描范围。
- **Stoikov**：校准风险系数 `γ`、流动性评分和库存惩罚曲线，产出报价调整参数表。
- **Kelly**：通过回测确定安全分数区间，先固化 `0.1x-0.25x` 白名单范围。
- **Monte Carlo**：运行一万次级别稳健性模拟，输出 CVaR、MDD、上线白名单和禁止上线条件。
- 离线任务按固定周期更新配置，并附带版本号、生成时间、输入样本窗口和审批状态；未审批的新配置不能自动进入 live 模式。

### Online runtime responsibilities

- 在线模块统一读取最新“已批准”的默认配置文件，作为各模块的默认参数来源；允许在运行时做轻量状态更新，但不做训练、校准和参数搜索。
- **Bayesian**：读取离线产出的先验和阈值，在热路径中只做轻量 posterior 更新或直接做置信度过滤，目标延迟 `<10ms`；P0 允许降级或禁用。
- **Edge**：读取成本模型和费用配置，实时计算 `EV = 收益 - 成本`，作为是否触发机会的硬门槛，目标延迟 `<5ms`。
- **Spread**：仅对离线筛出的关注列表计算 `Z-Score` 或偏离度，目标延迟 `<10ms`；P0 可不启用跨市场版本。
- **Stoikov**：读取离线校准好的 `γ` 和库存参数，根据实时持仓、库存偏移和流动性评分调整报价，目标延迟 `<5ms`；P0 可先只用于首腿报价偏移，不要求完整做市化。
- **Kelly**：读取离线固化的分数系数和约束上限，按实时净优势和风控上限计算仓位大小，目标延迟 `<1ms`。
- **Monte Carlo**：在线不运行模拟，只执行离线固化后的参数白名单、阈值和禁止交易规则。

### Planning implication

- P0 必须先建立“离线产参 -> 配置文件 -> 在线读取”的参数流，再做真实执行闭环，避免模型参数散落在代码常量里。
- P0 必须在线闭环的是 `Edge + Kelly + 强制 Risk`，并保留 `Bayesian` 可降级能力。
- `Spread` 与完整 `Stoikov` 更适合放到 P1/P2，在真实执行和风控闭环稳定后再扩展。
- `Monte Carlo` 明确归为离线研究与上线审批工具，不进入在线热路径。

## Implementation Approach

先把当前“模拟可跑通骨架”升级为“单策略实际可用闭环”，P0 只保留同市场静态套利，不同时推进统计套利和微观结构策略。实现路径是：先冻结真实交易契约和运行边界，再补齐真实 CLOB 接入、双腿执行和强制风控，最后用统一事件流打通回放、指标、纸交易和灰度 Gate。

### Key technical decisions

1. **以 `bot/contracts/types.ts` 为唯一运行契约**

- 当前 `OrderIntent` 只有 `marketId/side/price/size/tif`，与 `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/lib/polymarket/trading.ts` 的 `tokenId`、`side: yes|no`、`action: buy|sell` 并不对齐。
- P0 必须先把机会、订单、成交、风控拒绝理由统一建模，否则后续真实下单会反复返工。

2. **新增 bot 专用交易适配层，不直接把前端交易文件硬接进来**

- 当前 `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/lib/polymarket/trading.ts` 和 `session.ts` 都偏前端使用场景。
- 更稳妥的做法是在 `bot/integration/` 下新增服务端可用适配层，复用依赖与参数约束，但隔离前端会话、副作用和运行模式差异。

3. **P0 只做一条真实闭环**

- 保持 `bot/signal/index.ts` 以 `static_arb` 为主，不在 P0 扩大到 `stat_arb` 和 `microstructure`。
- 先保证真实接入、双腿完成率、风控闭环、回放一致性都达标，再扩策略，避免技术债扩散。

4. **风控必须变成执行前和执行中的强约束**

- 当前 `preTradeCheck` 返回了 `maxSize`、`maxSlippageBps`，但 `bot/core/run-engine.ts` 只用了 `allow`。
- P0 要让 `RiskDecision` 真正参与尺寸裁剪、开仓阻断、只减仓、熔断恢复和 kill switch，不再只是占位接口。

5. **离线参数生成与在线默认配置读取要解耦**

- 新增离线参数生成程序，定期产出一份版本化默认配置文件，集中承载 Bayesian/Edge/Spread/Stoikov/Kelly/Monte Carlo 的可运行参数。
- 在线模块统一从该配置读取默认参数，只做轻量实时计算与状态更新，不在热路径内重新训练或搜索参数。
- 配置切换必须带版本号、审批状态和回滚目标，避免未经验证的参数直接进入 paper/live。

### Performance and reliability

- P0 热路径以“每个市场增量更新本地状态”为主，避免每条事件全量重算；静态套利链路目标是接近 O(1) 的单事件更新复杂度。
- 回放链路允许先排序后处理，复杂度可接受为 O(n log n)；关键是保证事件顺序、订单更新和风控结论可复现。
- 主要瓶颈是 websocket 断档、快照恢复、订单回报同步和补腿失败。缓解方式是：序列校验、快照重建、幂等订单映射、TTL 超时撤单、补腿次数上限和只减仓兜底。

## Implementation Notes

- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/integration/real-data.ts` 当前只是 Gamma 驱动的验证入口，只能保留为验证工具，不能继续承担生产行情输入职责。
- 不要为了接实盘而破坏现有模拟链路；应保留 simulation 入口，新增 paper 或 live-safe 入口，降低回归范围。
- 指标优先补齐双腿完成率、成交延迟、滑点、拒单原因、回撤和连续失败次数；不要继续只依赖当前 `completionRate`。
- 日志统一记录机会 ID、订单 ID、腿状态、风控拒绝原因和恢复动作，避免输出密钥、凭证和大体积原始 payload。
- 配置建议集中到 `bot/config/`，用运行模式和版本号管理阈值，避免把关键参数散落在各模块常量中。
- 默认参数文件建议由离线任务生成到 `bot/config/generated/`，在线只读取最新已批准版本；生成任务需支持定期刷新、审计记录和快速回滚。

## Architecture Design

### P0 target structure

- **Exchange Adapter**
- 负责真实行情、订单回报、成交回报和撤单结果的标准化输出。
- **Ingest**
- 维护按市场隔离的本地订单簿、事件顺序和断线恢复。
- **Feature / Signal**
- 先支撑静态套利最小特征与净优势计算，输出确定性 `Opportunity`。
- **Risk**
- 对每次机会和每次订单动作给出可执行约束，支持全局禁止开仓和只减仓。
- **Execution**
- 实现被动首腿、TTL、部分成交补腿、IOC 兜底、失败熔断。
- **Research / Metrics**
- 与在线链路共享标准化事件，保证回放、蒙特卡洛和上线 Gate 使用同一口径。

### Runtime evolution

- **P0**：单进程单账户，先做 simulation 和 paper，验证闭环。
- **P1**：小资金灰度，增强监控、告警和参数版本管理。
- **P2**：在 P0 Gate 稳定后，再扩多市场配对、统计套利和更复杂库存控制。

## Directory Structure

### Directory Structure Summary

本次推进应尽量把改动集中在 `bot/`，先不扩散到 `app/` 和 `components/`。优先补齐真实接入、执行、风控、研究和运行文档。

- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/PROJECT_PLAN.md` [MODIFY] 将当前 TODO 骨架改成 P0/P1/P2 路线图、依赖、Gate、回滚条件和验收结果记录。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/README.md` [MODIFY] 补充 simulation、paper、灰度运行方式、风险开关、故障恢复、离线参数刷新和验收步骤。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/config/runtime.ts` [NEW] 统一运行模式、阈值版本、参数加载与默认值，作为在线读取默认配置的入口。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/config/generated/runtime-defaults.json` [NEW] 由离线程序定期生成的版本化默认参数文件，承载模型参数、风险阈值、市场白名单和启停开关。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/offline/update-runtime-config.ts` [NEW] 定期离线任务入口，负责重跑研究、汇总参数并生成可审批的默认配置。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/contracts/types.ts` [MODIFY] 对齐真实交易契约，补足 token、outcome、订单生命周期、风险拒绝理由和腿级状态。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/integration/exchange.ts` [NEW] bot 专用交易适配层，负责真实 Polymarket 行情、订单、成交和撤单标准化。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/integration/real-data.ts` [MODIFY] 明确降级为验证入口，避免与生产接入职责混用。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/ingest/adapter.ts` [MODIFY] 从仅支持 `SyntheticTick` 扩展为统一真实事件映射和验证模式兼容层。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/ingest/orderbook.ts` [MODIFY] 改为按市场维护状态，支持序列校验、快照对齐和恢复后重建。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/ingest/recovery.ts` [MODIFY] 实现快照恢复、增量回放和断线补偿，而不是当前简单时间过滤。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/features/engine.ts` [MODIFY] 按市场隔离滚动状态，补齐缺失值守卫和生产链路所需最小特征。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/features/windows.ts` [MODIFY] 支撑多市场窗口和可重放计算，避免状态串扰。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/signal/edge.ts` [MODIFY] 把费用、滑点、延迟和补腿成本纳入净优势模型。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/signal/bayesian.ts` [MODIFY] 作为可选置信度过滤器保留，P0 需要支持降级或禁用。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/signal/index.ts` [MODIFY] 只保留 P0 静态套利主路径，输出真实可执行的 `Opportunity`。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/execution/orchestrator.ts` [MODIFY] 实现首腿挂单、TTL、部分成交补腿、撤单、失败退出和订单状态跟踪。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/risk/pre_trade.ts` [MODIFY] 增加名义金额、市场敞口、余额、延迟、盘口深度和尺寸裁剪检查。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/risk/realtime.ts` [MODIFY] 增加连续失败、回撤、日内亏损、只减仓和恢复条件。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/risk/killswitch.ts` [MODIFY] 让 kill switch 成为全链路硬阻断，并保留审计信息。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/core/run-engine.ts` [MODIFY] 从纯模拟循环升级为可复用的统一运行主链路，打通真实事件、风险和执行结果。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/backtest/replay.ts` [MODIFY] 让历史回放复用标准化事件和订单更新，而不只是排序 tick。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/montecarlo/sim.ts` [MODIFY] 用滑点、延迟、成交率和相关扰动替代当前单一随机 shock。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/montecarlo/report.md` [NEW] 固化 CVaR、MDD、参数白名单和禁止上线条件。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/metrics/collector.ts` [MODIFY] 增加腿级完成率、延迟、滑点、拒单、熔断和恢复指标。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/metrics/dashboard.md` [NEW] 定义运行面板展示口径和关键指标。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/metrics/alerts.md` [NEW] 定义断连、连续失败、风控熔断和恢复告警规则。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/examples/run-paper-trading.ts` [NEW] 提供 paper 运行入口，和当前 simulation、real validation 分离。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/tests/pipeline.test.ts` [MODIFY] 覆盖真实契约下的主链路集成。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/tests/real-data.test.ts` [MODIFY] 明确真实验证入口的边界与降级行为。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/tests/risk.test.ts` [MODIFY] 补齐 kill switch、只减仓、连续失败和回撤触发。
- `/Users/fengzhi/Downloads/git/prediction-market-starter-kit/bot/tests/execution-orchestrator.test.ts` [NEW] 覆盖双腿补腿、TTL、撤单和失败兜底流程。

## Acceptance and rollout gates

### P0 Gate

- 真实或纸交易链路可稳定接收标准化行情和订单回报
- 双腿完成率达到设计文档门槛
- 净优势扣除费用和执行成本后仍为正
- kill switch、只减仓、日内亏损和回撤限制可复现触发
- 回放结果与在线记录在同一口径下可对齐

### P1 Gate

- 连续纸交易运行稳定，无未解释的订单状态丢失
- 告警规则覆盖断连、拒单激增、补腿失败和风控熔断
- 参数版本、回滚和审计记录可用

### P2 Gate

- P0 与 P1 连续通过后，才允许扩展统计套利、微观结构策略和更复杂库存控制

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在实施每个阶段前后复核 `bot/`、`lib/polymarket/` 和测试文件的真实依赖、接口变化与调用链影响。
- Expected outcome: 产出受影响文件清单、关键契约差异、回归检查点和风险边界，降低遗漏与误改。