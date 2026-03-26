export type SimMetrics = {
  opportunities: number
  executed: number
  totalPnl: number
  completionRate: number
}

export function collectMetrics(opportunities: number, executed: number, totalPnl: number): SimMetrics {
  return {
    opportunities,
    executed,
    totalPnl,
    completionRate: opportunities > 0 ? executed / opportunities : 0,
  }
}
