import { getApprovedRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import { executeOpportunity } from '../execution/orchestrator'
import { FeatureEngine } from '../features/engine'
import { applyEventToBooks, createBookState, getTopOfBook, type BookStore } from '../ingest/orderbook'
import { getTokenMap, tickToMarketEvents, type SyntheticTick } from '../ingest/adapter'
import { collectMetrics, type SimMetrics } from '../metrics/collector'
import { monteCarloPnl } from '../montecarlo/sim'
import { createRiskState, updateRiskStateAfterExecution } from '../risk/realtime'
import { preTradeCheck } from '../risk/pre_trade'
import { generateOpportunity } from '../signal'
import type { MetricEvent } from '../contracts/types'

export type EngineResult = SimMetrics & {
  mcMean: number
  mcP05: number
  configVersion: string
}

export function runEngine(ticks: SyntheticTick[], overrides?: Partial<RuntimeConfig>): EngineResult {
  const config = getApprovedRuntimeConfig(overrides)
  const featureEngine = new FeatureEngine()
  let books: BookStore = {}
  let riskState = createRiskState(config)
  let opportunities = 0
  let executed = 0
  let totalPnl = 0
  const metricEvents: MetricEvent[] = []

  for (const tick of ticks) {
    const tokenMap = getTokenMap(tick.marketId, tick.tokenMap)
    const events = tickToMarketEvents({ ...tick, tokenMap })
    for (const event of events) {
      books = applyEventToBooks(books, event, tokenMap)
    }

    const book = books[tick.marketId] ?? createBookState(tick.marketId, tokenMap)
    const top = getTopOfBook(book)
    const feature = featureEngine.build(tick.marketId, tick.ts, book, events)
    const opportunity = generateOpportunity(feature, book, tick.ts, config)
    if (!opportunity) continue

    opportunities += 1
    metricEvents.push({
      opportunityId: opportunity.id,
      marketId: opportunity.marketId,
      stage: 'opportunity',
      ts: tick.ts,
    })

    const requestedSize = Math.min(config.risk.maxSize, riskState.equity * config.models.kelly.maxFraction)
    const decision = preTradeCheck(
      opportunity,
      {
        riskState,
        requestedSize,
        availableDepthSize: Math.min(book.yes.asks[0]?.size ?? 0, book.no.asks[0]?.size ?? 0),
        latencyMs: Math.max(10, Math.round((1 - opportunity.confidence) * 100)),
      },
      config,
    )

    if (!decision.allow) {
      metricEvents.push({
        opportunityId: opportunity.id,
        marketId: opportunity.marketId,
        stage: 'risk_reject',
        ts: tick.ts,
        reason: decision.reason,
      })
      continue
    }

    const execResult = executeOpportunity(
      opportunity,
      {
        equity: riskState.equity,
        inventory: riskState.openNotional / Math.max(1, top.totalAskNotional),
        riskDecision: decision,
        now: tick.ts,
        volatility1s: feature.volatility1s,
      },
      config,
    )

    if (execResult.updates.length === 0) continue

    executed += 1
    totalPnl += execResult.pnl
    metricEvents.push(...execResult.metrics)
    riskState = updateRiskStateAfterExecution(riskState, {
      pnl: execResult.pnl,
      realizedNotional: execResult.realizedNotional,
      completed: execResult.completed,
      latencyMs: 15,
    })
  }

  const metrics = collectMetrics({
    opportunities,
    executed,
    totalPnl,
    metricEvents,
    riskState,
  })
  const mc = monteCarloPnl(totalPnl, config.models.monteCarlo.runs, config)

  return {
    ...metrics,
    mcMean: mc.mean,
    mcP05: mc.p05,
    configVersion: config.version,
  }
}
