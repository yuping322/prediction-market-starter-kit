import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadConfig, type BotConfig } from '../config'
import { loadSession } from '../paper/persistence'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, 'default.json')

export type TuningReport = {
  adjustments: Array<{ param: string; old: number; new: number; reason: string }>
  marketConditions: {
    avgSpread: number
    avgVolume: number
    arbHitRate: number
    avgEvBps: number
  }
}

/**
 * Analyze recent session data and market conditions,
 * then auto-adjust config parameters.
 *
 * Rules:
 * 1. If net-after-slippage is negative, reduce slippage tolerance
 *    (meaning we're being too aggressive — tighten the estimate)
 * 2. If fill rate < 30%, increase partialFillBaseRate (we're underestimating)
 * 3. If no trades executed, lower minEvBps threshold
 * 4. If drawdown exceeded 50% of limit, reduce kellyCap
 * 5. If arb opportunities are sparse, widen the spread override
 */
export function autotune(configPath?: string): TuningReport {
  const config = loadConfig(configPath)
  const session = loadSession()

  const adjustments: TuningReport['adjustments'] = []

  // Gather market conditions from session
  let avgSpread = 0.01
  let avgVolume = 0
  let arbHitRate = 0
  let avgEvBps = 0

  if (session) {
    const totalOrders = session.orders.length
    const filledOrders = session.orders.filter((o) => o.status !== 'REJECTED').length
    arbHitRate = totalOrders > 0 ? filledOrders / totalOrders : 0

    // Compute average spread from positions
    const marketIds = new Set(session.positions.map((p) => p.marketId))
    const spreads: number[] = []
    for (const mid of marketIds) {
      const yes = session.positions.find((p) => p.marketId === mid && p.side === 'YES')
      const no = session.positions.find((p) => p.marketId === mid && p.side === 'NO')
      if (yes && no) {
        spreads.push(yes.avgEntry + no.avgEntry - 1)
      }
    }
    if (spreads.length > 0) {
      avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length
    }

    avgVolume = session.orders.reduce((acc, o) => acc + o.filledSize, 0) / Math.max(1, totalOrders)

    // Average EV from the gross spread
    if (spreads.length > 0) {
      avgEvBps = Math.abs(avgSpread) * 10_000
    }

    // Rule 1: Net-after-slippage negative → increase slippage estimate
    const netAfterSlip = session.stats.totalArbProfit - session.stats.totalSlippageCost
    if (netAfterSlip < 0 && config.execution.slippageBps < 150) {
      const newSlippage = Math.min(150, config.execution.slippageBps + 10)
      adjustments.push({
        param: 'execution.slippageBps',
        old: config.execution.slippageBps,
        new: newSlippage,
        reason: `Net after slippage is negative ($${netAfterSlip.toFixed(2)}), raising slippage estimate`,
      })
      config.execution.slippageBps = newSlippage
    } else if (netAfterSlip > session.stats.totalArbProfit * 0.5 && config.execution.slippageBps > 20) {
      // Slippage is eating less than 50% of profit — can afford to lower estimate
      const newSlippage = Math.max(20, config.execution.slippageBps - 5)
      adjustments.push({
        param: 'execution.slippageBps',
        old: config.execution.slippageBps,
        new: newSlippage,
        reason: `Slippage cost is low relative to profit, lowering estimate`,
      })
      config.execution.slippageBps = newSlippage
    }

    // Rule 2: Low fill rate → increase base rate (we're too conservative)
    if (arbHitRate < 0.3 && config.execution.partialFillBaseRate < 0.8) {
      const newRate = Math.min(0.8, config.execution.partialFillBaseRate + 0.1)
      adjustments.push({
        param: 'execution.partialFillBaseRate',
        old: config.execution.partialFillBaseRate,
        new: newRate,
        reason: `Fill rate ${(arbHitRate * 100).toFixed(0)}% is low, increasing base fill rate`,
      })
      config.execution.partialFillBaseRate = newRate
    }

    // Rule 3: No trades at all → lower minEvBps to find more opportunities
    if (filledOrders === 0 && config.signal.minEvBps > 1) {
      const newMinEv = Math.max(1, config.signal.minEvBps - 2)
      adjustments.push({
        param: 'signal.minEvBps',
        old: config.signal.minEvBps,
        new: newMinEv,
        reason: `No trades executed, lowering min EV threshold`,
      })
      config.signal.minEvBps = newMinEv
    }

    // Rule 4: Drawdown risk → reduce kelly cap
    const drawdown = ((session.portfolio.peakEquity - session.portfolio.equity) / session.portfolio.peakEquity) * 100
    const drawdownLimit = Math.abs(config.risk.maxDrawdownPct)
    if (drawdown > drawdownLimit * 0.5 && config.execution.kellyCap > 0.005) {
      const newCap = Math.max(0.005, config.execution.kellyCap * 0.75)
      adjustments.push({
        param: 'execution.kellyCap',
        old: config.execution.kellyCap,
        new: Number(newCap.toFixed(4)),
        reason: `Drawdown ${drawdown.toFixed(1)}% is >50% of limit, reducing position size`,
      })
      config.execution.kellyCap = Number(newCap.toFixed(4))
    }

    // Rule 5: Few arb opportunities → widen spread override for more sensitivity
    if (marketIds.size > 0 && filledOrders < marketIds.size * 0.2 && config.data.spreadOverride < 0.03) {
      const newSpread = Math.min(0.03, config.data.spreadOverride + 0.005)
      adjustments.push({
        param: 'data.spreadOverride',
        old: config.data.spreadOverride,
        new: newSpread,
        reason: `Only ${filledOrders}/${marketIds.size} markets traded, widening spread`,
      })
      config.data.spreadOverride = newSpread
    }
  }

  // Write updated config
  if (adjustments.length > 0) {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8')
  }

  return {
    adjustments,
    marketConditions: { avgSpread, avgVolume, arbHitRate, avgEvBps },
  }
}

// CLI entry point
if (process.argv[1]?.includes('autotune')) {
  const report = autotune()

  console.log('=== Auto-Tune Report ===\n')

  console.log('--- Market Conditions ---')
  console.log(`  Avg spread:    ${(report.marketConditions.avgSpread * 10_000).toFixed(1)} bps`)
  console.log(`  Avg volume:    ${report.marketConditions.avgVolume.toFixed(2)} per order`)
  console.log(`  Arb hit rate:  ${(report.marketConditions.arbHitRate * 100).toFixed(1)}%`)
  console.log(`  Avg EV:        ${report.marketConditions.avgEvBps.toFixed(1)} bps`)

  if (report.adjustments.length === 0) {
    console.log('\n  No adjustments needed. Config is optimal for current conditions.')
  } else {
    console.log(`\n--- Adjustments (${report.adjustments.length}) ---`)
    for (const adj of report.adjustments) {
      console.log(`  ${adj.param}: ${adj.old} → ${adj.new}`)
      console.log(`    Reason: ${adj.reason}`)
    }
    console.log('\n  Config updated: bot/config/default.json')
  }
}
