# Agent E - Risk

## Scope
- pre-trade 检查
- 实时限额和 kill switch

## Deliverables
- `bot/risk/pre_trade.ts`
- `bot/risk/realtime.ts`
- `bot/risk/killswitch.ts`

## DoD
- 任意时刻可全局禁止新开仓
- 风控拒单理由可追踪
