import type { MetricEvent, RiskState } from '../contracts/types'

export type SimMetrics = {
  opportunities: number
  executed: number
  totalPnl: number
  completionRate: number
  avgSlippageBps: number
  riskRejects: number
  maxDrawdownPct: number
  failCount: number
}

export function collectMetrics(input: {
  opportunities: number
  executed: number
  totalPnl: number
  metricEvents: MetricEvent[]
  riskState: RiskState
}): SimMetrics {
  const executionEvents = input.metricEvents.filter((event) => event.stage === 'execution')
  const completionRate =
    executionEvents.length > 0
      ? executionEvents.reduce((acc, event) => acc + (event.completion ?? 0), 0) / executionEvents.length
      : input.opportunities > 0
        ? input.executed / input.opportunities
        : 0
  const slippageEvents = executionEvents.filter((event) => typeof event.slippageBps === 'number')
  const avgSlippageBps =
    slippageEvents.length > 0
      ? slippageEvents.reduce((acc, event) => acc + (event.slippageBps ?? 0), 0) / slippageEvents.length
      : 0

  return {
    opportunities: input.opportunities,
    executed: input.executed,
    totalPnl: input.totalPnl,
    completionRate,
    avgSlippageBps,
    riskRejects: input.metricEvents.filter((event) => event.stage === 'risk_reject').length,
    maxDrawdownPct: Math.abs(input.riskState.drawdownPct),
    failCount: input.riskState.failCount,
  }
}
