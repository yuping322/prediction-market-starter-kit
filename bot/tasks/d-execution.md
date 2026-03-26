# Agent D - Execution

## Scope
- 根据机会单生成双腿下单计划
- 被动挂单 + IOC 补腿

## Deliverables
- `bot/execution/stoikov.ts`
- `bot/execution/kelly.ts`
- `bot/execution/orchestrator.ts`

## DoD
- 超时撤单可生效
- 部分成交补腿流程闭环
