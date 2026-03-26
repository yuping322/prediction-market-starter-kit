# Agent C - Signal

## Scope
- Bayesian + Edge + Spread 信号组合
- 仅输出 `EV > threshold` 的 `Opportunity`

## Deliverables
- `bot/signal/bayesian.ts`
- `bot/signal/edge.ts`
- `bot/signal/spread.ts`
- `bot/signal/index.ts`

## DoD
- 同一输入具备确定性输出
- 阈值配置可热更新
