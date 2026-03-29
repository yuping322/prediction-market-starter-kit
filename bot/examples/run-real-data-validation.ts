import { fetchRealTicks } from '../integration/real-data'
import { tickToMarketEvents } from '../ingest/adapter'
import { applyBookEvent, getDefaultBookState } from '../ingest/orderbook'
import { FeatureEngine } from '../features/engine'
import { generateOpportunity } from '../signal'
import { preTradeCheck, type PreTradeContext } from '../risk/pre_trade'
import { shouldTriggerDrawdownStop } from '../risk/realtime'
import { executeOpportunity, type ExecutionContext } from '../execution/orchestrator'
import { collectMetrics } from '../metrics/collector'
import { monteCarloPnl } from '../montecarlo/sim'
import type { RiskState } from '../contracts/types'

async function main(): Promise<void> {
  console.log('=== Polymarket Arbitrage Bot — Real Data Validation ===\n')

  const ticks = await fetchRealTicks(30)
  if (ticks.length === 0) {
    throw new Error('No real ticks fetched from Polymarket Gamma API')
  }

  console.log(`Loaded ${ticks.length} market ticks\n`)

  // Show market overview
  console.log('--- Market Overview ---')
  for (const tick of ticks) {
    const sum = tick.yesAsk + tick.noAsk
    const grossBps = Math.round((1 - sum) * 10_000)
    console.log(
      `  ${tick.marketId.padEnd(25)} YES=${tick.yesAsk.toFixed(2)} NO=${tick.noAsk.toFixed(2)} ` +
        `Sum=${sum.toFixed(4)} GrossEV=${grossBps}bps Vol24h=${tick.volume.toLocaleString()}`,
    )
  }

  // Run full pipeline with per-tick logging
  console.log('\n--- Pipeline Execution ---')
  const featureEngine = new FeatureEngine()
  let book = getDefaultBookState()
  let equity = 10_000
  let inventory = 0
  let opportunities = 0
  let executed = 0
  let totalPnl = 0
  let blocked = 0
  const metricEvents: import('../contracts/types').MetricEvent[] = []
  const riskState: RiskState = {
    equity,
    peakEquity: equity,
    intradayPnl: totalPnl,
    drawdownPct: 0,
    openNotional: 0,
    pendingNotional: 0,
    failCount: 0,
    lastLatencyMs: 10,
    killSwitchEnabled: false,
    onlyReduce: false,
    maxOpenNotional: 1_000,
    maxDrawdownPct: -20,
    maxDailyLossPct: -10,
  }

  for (const tick of ticks) {
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }

    const feature = featureEngine.build(tick.marketId, tick.ts, book, events)
    const opp = generateOpportunity(feature, book, tick.ts)

    if (!opp) continue

    opportunities += 1
    const preTradeCtx: PreTradeContext = {
      riskState,
      requestedSize: equity * 0.05,
      availableDepthSize: 1_000,
      latencyMs: 10,
    }
    const decision = preTradeCheck(opp, preTradeCtx)
    if (!decision.allow) {
      blocked += 1
      console.log(`  [BLOCKED] ${tick.marketId} — ${decision.reason}`)
      continue
    }

    const pnlPct = (totalPnl / Math.max(1, equity)) * 100
    if (shouldTriggerDrawdownStop(pnlPct, pnlPct)) {
      blocked += 1
      console.log(`  [STOPPED] ${tick.marketId} — Drawdown circuit breaker`)
      continue
    }

    const execCtx: ExecutionContext = {
      equity,
      inventory,
      riskDecision: decision,
      now: tick.ts,
    }
    const execResult = executeOpportunity(opp, execCtx)
    if (execResult.updates.length === 0) continue

    executed += 1
    totalPnl += execResult.pnl
    equity += execResult.pnl
    inventory += execResult.updates[0].filledSize
    metricEvents.push(...execResult.metrics)

    const fill = execResult.updates[0]
    console.log(
      `  [EXEC] ${tick.marketId.padEnd(25)} ` +
        `EV=${opp.evBps.toFixed(1)}bps conf=${opp.confidence.toFixed(3)} ` +
        `fill=${fill.filledSize.toFixed(2)}@${fill.avgPrice?.toFixed(4)} ` +
        `PnL=$${execResult.pnl.toFixed(4)}`,
    )
  }

  // Summary
  const metrics = collectMetrics({ opportunities, executed, totalPnl, metricEvents, riskState })
  const mc = monteCarloPnl(totalPnl)

  console.log('\n--- Results Summary ---')
  console.log(`  Ticks scanned:      ${ticks.length}`)
  console.log(`  Opportunities:      ${opportunities}`)
  console.log(`  Blocked by risk:    ${blocked}`)
  console.log(`  Executed:           ${executed}`)
  console.log(`  Completion rate:    ${(metrics.completionRate * 100).toFixed(1)}%`)
  console.log(`  Total PnL:         $${totalPnl.toFixed(4)}`)
  console.log(`  Final equity:      $${equity.toFixed(2)}`)
  console.log(`  Inventory:         ${inventory.toFixed(2)} contracts`)
  console.log(`  MC mean PnL:       $${mc.mean.toFixed(4)}`)
  console.log(`  MC P05 (worst 5%): $${mc.p05.toFixed(4)}`)
}

void main()
