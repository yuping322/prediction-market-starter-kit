# Monte Carlo Rollout Report

## 用途

- 离线评估参数稳健性
- 输出上线白名单和禁止上线条件
- 为 `paper` / `live-safe` 提供审批依据

## 关注指标

- Mean PnL
- P05 / CVaR
- Max Drawdown
- Completion sensitivity
- Slippage sensitivity

## 禁止上线条件

- `P05 < 0`
- `Max Drawdown > budget`
- 完成率压力测试明显低于 P0 Gate
- 对延迟或滑点冲击过度敏感
