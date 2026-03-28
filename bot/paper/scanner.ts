import { loadSession } from './persistence'
import { fetchRealTicks } from '../integration/real-data'
import { PaperPortfolio } from './portfolio'
import { loadConfig } from '../config'

/**
 * Hourly position scanner.
 *
 * Loads the persisted session, fetches latest market prices,
 * marks positions to market, and prints a summary with alerts.
 *
 * Usage:  pnpm bot:scan
 * Cron:   0 * * * *  (every hour)
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const session = loadSession()

  if (!session) {
    console.log('[SCANNER] No session file found. Run `pnpm bot:paper` first.')
    process.exit(0)
  }

  const now = new Date().toISOString()
  console.log(`=== Position Scan: ${now} ===\n`)

  // Restore portfolio from session
  const portfolio = new PaperPortfolio(session.portfolio.initialEquity)
  portfolio.cashBalance = session.portfolio.cash
  portfolio.peakEquity = session.portfolio.peakEquity
  for (const pos of session.positions) {
    portfolio.positions.set(`${pos.marketId}:${pos.side}`, { ...pos })
  }
  for (const order of session.orders) {
    portfolio.orders.push(order)
  }

  // Fetch latest prices and mark to market
  const ticks = await fetchRealTicks(config.data.tickLimit)
  const priceMap = new Map<string, { yes: number; no: number }>()
  for (const tick of ticks) {
    priceMap.set(tick.marketId, { yes: tick.yesBid, no: tick.noBid })
  }

  let priceUpdates = 0
  for (const pos of portfolio.positions.values()) {
    const prices = priceMap.get(pos.marketId)
    if (prices) {
      portfolio.markToMarket(pos.marketId, prices.yes, prices.no)
      priceUpdates += 1
    }
  }

  // Summary
  const snap = portfolio.snapshot()
  console.log('--- Portfolio ---')
  console.log(`  Wallet:          ${session.wallet.address}`)
  console.log(`  Safe:            ${session.wallet.safeAddress}`)
  console.log(`  Last updated:    ${session.updatedAt}`)
  console.log(`  Equity:          $${snap.equity.toFixed(2)}`)
  console.log(`  Cash:            $${snap.cash.toFixed(2)}`)
  console.log(`  Open notional:   $${snap.openNotional.toFixed(2)}`)
  console.log(`  Locked arb:      $${snap.lockedArbProfit.toFixed(4)}`)
  console.log(`  Drawdown:        ${snap.drawdownPct.toFixed(2)}% from peak`)
  console.log(`  Price updates:   ${priceUpdates}/${portfolio.positions.size} positions`)

  // Positions detail
  if (portfolio.positions.size > 0) {
    console.log(`\n--- Positions (${portfolio.positions.size}) ---`)
    const marketIds = new Set<string>()
    for (const pos of portfolio.positions.values()) {
      marketIds.add(pos.marketId)
    }
    for (const mid of marketIds) {
      const yesPos = portfolio.positions.get(`${mid}:YES`)
      const noPos = portfolio.positions.get(`${mid}:NO`)
      const yesStr = yesPos
        ? `YES ${yesPos.size.toFixed(2)}@${yesPos.avgEntry.toFixed(4)} mark=${yesPos.currentPrice.toFixed(4)} uPnL=$${yesPos.unrealizedPnl.toFixed(2)}`
        : ''
      const noStr = noPos
        ? `NO ${noPos.size.toFixed(2)}@${noPos.avgEntry.toFixed(4)} mark=${noPos.currentPrice.toFixed(4)} uPnL=$${noPos.unrealizedPnl.toFixed(2)}`
        : ''
      console.log(`  ${mid}`)
      if (yesStr) console.log(`    ${yesStr}`)
      if (noStr) console.log(`    ${noStr}`)
    }
  }

  // Alerts
  const alerts: string[] = []

  if (snap.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)) {
    alerts.push(`[CRIT] Drawdown ${snap.drawdownPct.toFixed(2)}% exceeds max ${config.risk.maxDrawdownPct}%`)
  } else if (snap.drawdownPct >= Math.abs(config.risk.intradayStopPct)) {
    alerts.push(`[WARN] Drawdown ${snap.drawdownPct.toFixed(2)}% approaching circuit breaker`)
  }

  // Concentration check
  for (const pos of portfolio.positions.values()) {
    const posWeight = ((pos.size * pos.currentPrice) / Math.max(1, snap.equity)) * 100
    if (posWeight > config.risk.maxPositionPct) {
      alerts.push(
        `[WARN] ${pos.marketId}:${pos.side} concentration ${posWeight.toFixed(1)}% > ${config.risk.maxPositionPct}% limit`,
      )
    }
  }

  // Stale session check
  const lastUpdate = new Date(session.updatedAt)
  const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60)
  if (hoursSinceUpdate > 24) {
    alerts.push(`[WARN] Session data is ${hoursSinceUpdate.toFixed(0)}h old — consider re-running paper trading`)
  }

  if (alerts.length > 0) {
    console.log('\n--- ALERTS ---')
    for (const alert of alerts) {
      console.log(`  ${alert}`)
    }
  } else {
    console.log('\n  No alerts.')
  }

  // Stats from session
  console.log('\n--- Session Stats ---')
  console.log(`  Total trades:    ${session.stats.totalTrades}`)
  console.log(`  Fill rate:       ${(session.stats.fillRate * 100).toFixed(1)}%`)
  console.log(`  Arb profit:      $${session.stats.totalArbProfit.toFixed(4)}`)
  console.log(`  Slippage cost:   $${session.stats.totalSlippageCost.toFixed(4)}`)
  console.log(`  Net after slip:  $${(session.stats.totalArbProfit - session.stats.totalSlippageCost).toFixed(4)}`)
}

void main()
