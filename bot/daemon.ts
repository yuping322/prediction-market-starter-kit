/**
 * Bot Daemon — single long-running process with a serial pipeline.
 *
 * Each cycle (every 5 minutes):
 *   Step 1. Fetch latest market data
 *   Step 2. Mark-to-market existing positions + alert check
 *   Step 3. Scan for arbitrage opportunities
 *   Step 4. Execute paper trades
 *   Step 5. Save session state
 *
 * Additionally:
 *   - Auto-tune runs every 12 cycles (~1 hour) to adjust config params
 *
 * Usage:
 *   pnpm bot:daemon          # run in foreground
 *   nohup pnpm bot:daemon &  # run in background
 */

import { fetchRealTicks } from './integration/real-data'
import { tickToMarketEvents, type SyntheticTick } from './ingest/adapter'
import { applyBookEvent, getDefaultBookState, getTopOfBook, type BookState } from './ingest/orderbook'
import { FeatureEngine } from './features/engine'
import { generateOpportunity } from './signal'
import { preTradeCheck, type PreTradeContext } from './risk/pre_trade'
import { kellySize } from './execution/kelly'
import { stoikovPriceAdjust } from './execution/stoikov'
import { monteCarloPnl } from './montecarlo/sim'
import { PaperPortfolio } from './paper/portfolio'
import { generateWallet } from './paper/wallet'
import { saveSession, loadSession } from './paper/persistence'
import { loadConfig, resetConfigCache, type BotConfig } from './config'
import { autotune } from './config/autotune'
import type { RiskState } from './contracts/types'

const CYCLE_INTERVAL = 5 * 60 * 1000 // 5 minutes
const TUNE_EVERY_N_CYCLES = 12        // auto-tune every ~1 hour

let running = true

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One complete pipeline cycle: fetch → scan → trade → save
 */
async function runCycle(
  portfolio: PaperPortfolio,
  featureEngine: FeatureEngine,
  config: BotConfig,
): Promise<{ trades: number; skips: number; blocks: number; alerts: string[] }> {
  const ticks = await fetchRealTicks(config.data.tickLimit)
  if (ticks.length === 0) return { trades: 0, skips: 0, blocks: 0, alerts: [] }

  let book: BookState = getDefaultBookState()
  let trades = 0
  let skips = 0
  let blocks = 0
  const alerts: string[] = []

  // --- Step 1 & 2: Fetch data + Mark-to-market ---
  for (const tick of ticks) {
    portfolio.markToMarket(tick.marketId, tick.yesBid, tick.noBid)
  }

  // Drawdown alert check
  const snap = portfolio.snapshot()
  if (snap.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)) {
    alerts.push(`[CRIT] Drawdown ${snap.drawdownPct.toFixed(2)}% exceeds ${config.risk.maxDrawdownPct}% limit!`)
  } else if (snap.drawdownPct >= Math.abs(config.risk.intradayStopPct)) {
    alerts.push(`[WARN] Drawdown ${snap.drawdownPct.toFixed(2)}% approaching limit`)
  }

  // Concentration check
  for (const pos of portfolio.positions.values()) {
    const weight = ((pos.size * pos.currentPrice) / Math.max(1, snap.equity)) * 100
    if (weight > config.risk.maxPositionPct) {
      alerts.push(`[WARN] ${pos.marketId}:${pos.side} concentration ${weight.toFixed(1)}% > ${config.risk.maxPositionPct}%`)
    }
  }

  // --- Step 3 & 4: Scan opportunities + Execute trades ---
  for (const tick of ticks) {
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }

    const feature = featureEngine.build(tick.marketId, tick.ts, book, events)
    const opp = generateOpportunity(feature, book, tick.ts)

    if (!opp || opp.confidence < config.signal.confidenceThreshold) {
      skips += 1
      continue
    }

    const riskState: RiskState = {
      equity: portfolio.equity,
      peakEquity: portfolio.peakEquity,
      intradayPnl: portfolio.totalPnl,
      drawdownPct: portfolio.drawdownPct,
      openNotional: portfolio.openNotional,
      pendingNotional: 0,
      failCount: 0,
      lastLatencyMs: 10,
      killSwitchEnabled: false,
      onlyReduce: false,
      maxOpenNotional: config.portfolio.maxOpenNotional,
      maxDrawdownPct: config.risk.maxDrawdownPct,
      maxDailyLossPct: config.risk.intradayStopPct,
    }
    const preTradeCtx: PreTradeContext = {
      riskState,
      requestedSize: portfolio.equity * 0.05,
      availableDepthSize: 1_000,
      latencyMs: 10,
    }
    const decision = preTradeCheck(opp, preTradeCtx)
    if (!decision.allow) {
      blocks += 1
      continue
    }

    const pnlPct = (portfolio.totalPnl / Math.max(1, portfolio.equity)) * 100
    if (pnlPct <= config.risk.intradayStopPct || portfolio.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)) {
      blocks += 1
      alerts.push(`[STOP] Circuit breaker active — no new trades`)
      break
    }

    const size = kellySize(opp.evBps, opp.confidence, portfolio.equity)
    if (size < 0.01) { skips += 1; continue }

    const inventory = Array.from(portfolio.positions.values()).reduce(
      (acc, p) => acc + (p.side === 'YES' ? p.size : -p.size), 0,
    )
    const top = getTopOfBook(book)
    const adjYes = stoikovPriceAdjust(top.yesAsk, inventory, config.execution.stoikovRiskAversion)
    const adjNo = stoikovPriceAdjust(top.noAsk, -inventory, config.execution.stoikovRiskAversion)

    portfolio.executeTrade(tick.marketId, 'YES', adjYes, size / 2, tick.ts,
      config.execution.slippageBps, config.execution.partialFillBaseRate, config.execution.partialFillSizeDecay)
    portfolio.executeTrade(tick.marketId, 'NO', adjNo, size / 2, tick.ts,
      config.execution.slippageBps, config.execution.partialFillBaseRate, config.execution.partialFillSizeDecay)

    trades += 1
  }

  return { trades, skips, blocks, alerts }
}

async function main(): Promise<void> {
  console.log(`[${ts()}] Bot Daemon starting`)
  console.log(`  Cycle interval:  ${CYCLE_INTERVAL / 1000}s (${CYCLE_INTERVAL / 60000}min)`)
  console.log(`  Auto-tune every: ${TUNE_EVERY_N_CYCLES} cycles (~${TUNE_EVERY_N_CYCLES * 5}min)`)
  console.log(`  Press Ctrl+C to stop\n`)

  process.on('SIGINT', () => { console.log(`\n[${ts()}] Shutting down...`); running = false })
  process.on('SIGTERM', () => { console.log(`\n[${ts()}] Shutting down...`); running = false })

  // Restore or create wallet + portfolio
  let config = loadConfig()
  const session = loadSession()
  let privateKey: string
  let walletAddress: string
  let safeAddress: string

  const portfolio = new PaperPortfolio(config.portfolio.initialEquity)

  if (session) {
    privateKey = session.wallet.privateKey
    walletAddress = session.wallet.address
    safeAddress = session.wallet.safeAddress
    portfolio.cashBalance = session.portfolio.cash
    portfolio.peakEquity = session.portfolio.peakEquity
    for (const pos of session.positions) {
      portfolio.positions.set(`${pos.marketId}:${pos.side}`, { ...pos })
    }
    for (const order of session.orders) {
      portfolio.orders.push(order)
    }
    console.log(`  Restored session: ${walletAddress} (${portfolio.positions.size} positions)`)
  } else {
    const wallet = generateWallet()
    privateKey = wallet.privateKey
    walletAddress = wallet.address
    safeAddress = wallet.safeAddress
    console.log(`  New wallet: ${walletAddress}`)
  }

  const featureEngine = new FeatureEngine()
  let cycleCount = 0

  // Main loop
  while (running) {
    cycleCount += 1
    console.log(`\n[${ts()}] ── Cycle #${cycleCount} ──`)

    // Step 1-4: Full pipeline
    const result = await runCycle(portfolio, featureEngine, config)
    const snap = portfolio.snapshot()

    console.log(
      `  Market: ${result.trades} trades, ${result.skips} skips, ${result.blocks} blocks`,
    )
    console.log(
      `  Portfolio: equity=$${snap.equity.toFixed(2)} cash=$${snap.cash.toFixed(2)} ` +
      `arb=$${snap.lockedArbProfit.toFixed(4)} slip=$${snap.totalSlippageCost.toFixed(4)} ` +
      `DD=${snap.drawdownPct.toFixed(2)}%`,
    )

    if (result.alerts.length > 0) {
      for (const alert of result.alerts) {
        console.log(`  ${alert}`)
      }
    }

    // Step 5: Save state
    const filledOrders = portfolio.orders.filter((o) => o.status !== 'REJECTED')
    saveSession({
      wallet: { address: walletAddress, safeAddress, privateKey },
      updatedAt: new Date().toISOString(),
      portfolio: {
        initialEquity: config.portfolio.initialEquity,
        cash: portfolio.cashBalance,
        equity: portfolio.equity,
        peakEquity: portfolio.peakEquity,
      },
      positions: Array.from(portfolio.positions.values()),
      orders: portfolio.orders,
      stats: {
        totalTrades: portfolio.orders.length,
        fillRate: filledOrders.length / Math.max(1, portfolio.orders.length),
        totalArbProfit: portfolio.lockedArbProfit,
        totalSlippageCost: portfolio.totalSlippageCost,
        sessionsRun: cycleCount,
      },
    })

    // Auto-tune periodically
    if (cycleCount % TUNE_EVERY_N_CYCLES === 0) {
      console.log(`\n[${ts()}] ── Auto-Tune ──`)
      resetConfigCache()
      const report = autotune()
      if (report.adjustments.length === 0) {
        console.log('  No adjustments needed')
      } else {
        for (const adj of report.adjustments) {
          console.log(`  ${adj.param}: ${adj.old} → ${adj.new}`)
        }
      }
      resetConfigCache()
      config = loadConfig()
    }

    // Wait for next cycle
    if (running) {
      console.log(`  Next cycle in ${CYCLE_INTERVAL / 1000}s...`)
      const deadline = Date.now() + CYCLE_INTERVAL
      while (running && Date.now() < deadline) {
        await sleep(1000)
      }
    }
  }

  console.log(`[${ts()}] Daemon stopped after ${cycleCount} cycles`)
}

void main()
