# Agent B - Feature

## Scope
- 从 `MarketEvent` 生成 `FeatureSnapshot`
- 提供 100ms/1s/10s 窗口聚合

## Deliverables
- `bot/features/engine.ts`
- `bot/features/windows.ts`

## DoD
- P99 特征计算延迟 < 30ms（本地）
- 缺失/异常值有保护逻辑
