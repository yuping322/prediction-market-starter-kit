# Agent A - Ingest

## Scope
- 接入 WS/REST，输出统一 `MarketEvent`
- 本地订单簿重建 + 快照校验
- 断线恢复（快照 + 增量回放）

## Deliverables
- `bot/ingest/adapter.ts`
- `bot/ingest/orderbook.ts`
- `bot/ingest/recovery.ts`

## DoD
- 能稳定输出事件流（无乱序崩溃）
- 断线恢复后与最新快照一致
