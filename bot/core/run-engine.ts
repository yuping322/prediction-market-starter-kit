import { tickToMarketEvents, type SyntheticTick } from '../ingest/adapter'
import { applyBookEvent, getDefaultBookState } from '../ingest/orderbook'
import { FeatureEngine } from '../features/engine'
import { generateOpportunity } from '../signal'
import { preTradeCheck } from '../risk/pre_trade'
import { shouldTriggerDrawdownStop } from '../risk/realtime'
import { executeOpportunity } from '../execution/orchestrator'
import { collectMetrics, type SimMetrics } from '../metrics/collector'
import { monteCarloPnl } from '../montecarlo/sim'

export type EngineResult = SimMetrics & {
  mcMean: number
  mcP05: number
}

export function runEngine(ticks: SyntheticTick[]): EngineResult {
  const featureEngine = new FeatureEngine()
  let book = getDefaultBookState()
  let equity = 10_000
  let inventory = 0
  let opportunities = 0
  let executed = 0
  let totalPnl = 0

  for (const tick of ticks) {
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }

    const feature = featureEngine.build(tick.marketId, tick.ts, book, events)
    const opp = generateOpportunity(feature, book, tick.ts)
    if (!opp) continue

    opportunities += 1
    const decision = preTradeCheck(opp, Math.abs(inventory), 1_000)
    if (!decision.allow) continue

    const pnlPct = (totalPnl / Math.max(1, equity)) * 100
    if (shouldTriggerDrawdownStop(pnlPct, pnlPct)) continue

    const execResult = executeOpportunity(opp, equity, inventory)
    if (execResult.updates.length === 0) continue

    executed += 1
    totalPnl += execResult.pnl
    equity += execResult.pnl
    inventory += execResult.updates[0].filledSize
  }

  const metrics = collectMetrics(opportunities, executed, totalPnl)
  const mc = monteCarloPnl(totalPnl)

  return {
    ...metrics,
    mcMean: mc.mean,
    mcP05: mc.p05,
  }
}
