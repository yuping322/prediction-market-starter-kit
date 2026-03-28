/**
 * Bot Daemon — single long-running process that orchestrates all scheduled tasks.
 *
 * Processes:
 *   1. Paper Trading   — every 5 minutes, scan markets & execute paper trades
 *   2. Position Scanner — every hour, mark-to-market & alert check
 *   3. Auto-Tune        — every 24 hours, adjust config based on performance
 *
 * Usage:
 *   pnpm bot:daemon          # run in foreground
 *   nohup pnpm bot:daemon &  # run in background
 *
 * Graceful shutdown: Ctrl+C (SIGINT) or SIGTERM
 */

import { runPaperTrading } from './paper/trader'
import { loadSession, saveSession } from './paper/persistence'
import { autotune } from './config/autotune'
import { loadConfig, resetConfigCache } from './config'
import { fetchRealTicks } from './integration/real-data'
import { PaperPortfolio } from './paper/portfolio'

// Intervals in ms
const TRADE_INTERVAL = 5 * 60 * 1000   // 5 minutes
const SCAN_INTERVAL = 60 * 60 * 1000   // 1 hour
const TUNE_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

let running = true
let privateKey: string | undefined

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

// --- Task 1: Paper Trading ---
async function tradeOnce(): Promise<void> {
  console.log(`\n[${ts()}] === TRADE CYCLE ===`)
  try {
    const result = await runPaperTrading({
      privateKey, // reuse same wallet across cycles
    })
    // Persist wallet key for next cycle
    if (!privateKey) {
      privateKey = result.wallet.address // we need the actual private key from session
      const session = loadSession()
      if (session) privateKey = session.wallet.privateKey
    }

    const trades = result.orders.filter((o) => o.status !== 'REJECTED').length
    const arb = result.portfolio.lockedArbProfit
    const slip = result.portfolio.totalSlippageCost
    console.log(
      `  Trades: ${trades} | Arb: $${arb.toFixed(4)} | Slip: $${slip.toFixed(4)} | Net: $${(arb - slip).toFixed(4)}`,
    )
  } catch (err) {
    console.error(`  [ERROR] Trade cycle failed:`, err instanceof Error ? err.message : err)
  }
}

// --- Task 2: Position Scanner ---
async function scanOnce(): Promise<void> {
  console.log(`\n[${ts()}] === POSITION SCAN ===`)
  try {
    const session = loadSession()
    if (!session) {
      console.log('  No session — skipping scan')
      return
    }

    const config = loadConfig()
    const portfolio = new PaperPortfolio(session.portfolio.initialEquity)
    portfolio.cashBalance = session.portfolio.cash
    portfolio.peakEquity = session.portfolio.peakEquity
    for (const pos of session.positions) {
      portfolio.positions.set(`${pos.marketId}:${pos.side}`, { ...pos })
    }

    const ticks = await fetchRealTicks(config.data.tickLimit)
    let updates = 0
    for (const tick of ticks) {
      if (portfolio.positions.has(`${tick.marketId}:YES`) || portfolio.positions.has(`${tick.marketId}:NO`)) {
        portfolio.markToMarket(tick.marketId, tick.yesBid, tick.noBid)
        updates += 1
      }
    }

    const snap = portfolio.snapshot()
    console.log(
      `  Equity: $${snap.equity.toFixed(2)} | DD: ${snap.drawdownPct.toFixed(2)}% | ` +
        `Positions: ${snap.positionCount} | Updates: ${updates}`,
    )

    // Alerts
    if (snap.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)) {
      console.log(`  [CRIT] Drawdown ${snap.drawdownPct.toFixed(2)}% exceeds max!`)
    } else if (snap.drawdownPct >= Math.abs(config.risk.intradayStopPct)) {
      console.log(`  [WARN] Drawdown ${snap.drawdownPct.toFixed(2)}% approaching limit`)
    }
  } catch (err) {
    console.error(`  [ERROR] Scan failed:`, err instanceof Error ? err.message : err)
  }
}

// --- Task 3: Auto-Tune ---
function tuneOnce(): void {
  console.log(`\n[${ts()}] === AUTO-TUNE ===`)
  try {
    resetConfigCache()
    const report = autotune()
    if (report.adjustments.length === 0) {
      console.log('  No adjustments needed')
    } else {
      for (const adj of report.adjustments) {
        console.log(`  ${adj.param}: ${adj.old} → ${adj.new} (${adj.reason})`)
      }
    }
    console.log(
      `  Market: spread=${(report.marketConditions.avgSpread * 10_000).toFixed(1)}bps ` +
        `hitRate=${(report.marketConditions.arbHitRate * 100).toFixed(0)}% ` +
        `avgEV=${report.marketConditions.avgEvBps.toFixed(1)}bps`,
    )
  } catch (err) {
    console.error(`  [ERROR] Tune failed:`, err instanceof Error ? err.message : err)
  }
}

// --- Scheduler ---
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  console.log(`[${ts()}] Bot Daemon starting`)
  console.log(`  Trade interval:  ${TRADE_INTERVAL / 1000}s (${TRADE_INTERVAL / 60000}min)`)
  console.log(`  Scan interval:   ${SCAN_INTERVAL / 1000}s (${SCAN_INTERVAL / 3600000}h)`)
  console.log(`  Tune interval:   ${TUNE_INTERVAL / 1000}s (${TUNE_INTERVAL / 86400000}d)`)
  console.log(`  Press Ctrl+C to stop\n`)

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n[${ts()}] Shutting down...`)
    running = false
  })
  process.on('SIGTERM', () => {
    console.log(`\n[${ts()}] Shutting down...`)
    running = false
  })

  // Run all tasks immediately on startup
  await tradeOnce()
  await scanOnce()
  tuneOnce()

  let lastTrade = Date.now()
  let lastScan = Date.now()
  let lastTune = Date.now()

  while (running) {
    await sleep(10_000) // check every 10 seconds
    const now = Date.now()

    if (now - lastTrade >= TRADE_INTERVAL) {
      await tradeOnce()
      lastTrade = now
    }

    if (now - lastScan >= SCAN_INTERVAL) {
      await scanOnce()
      lastScan = now
    }

    if (now - lastTune >= TUNE_INTERVAL) {
      tuneOnce()
      lastTune = now
    }
  }

  console.log(`[${ts()}] Daemon stopped`)
}

void main()
