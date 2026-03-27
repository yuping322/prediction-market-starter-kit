import { runPaperTrading } from '../paper/trader'

async function main(): Promise<void> {
  console.log('=== Polymarket Arbitrage Bot — Paper Trading ===\n')

  const result = await runPaperTrading({
    initialEquity: 10_000,
    maxOpenNotional: 2_000,
    tickLimit: 50,
  })

  // Wallet info
  console.log('--- Wallet (generated on-chain identity) ---')
  console.log(`  EOA Address:  ${result.wallet.address}`)
  console.log(`  Safe Address: ${result.wallet.safeAddress}`)
  console.log(`  Mnemonic:     ${result.wallet.mnemonic}`)

  // Trade log
  console.log(`\n--- Trade Log (${result.logs.length} events) ---`)
  for (const log of result.logs) {
    const tag =
      log.action === 'TRADE'
        ? '\x1b[32m TRADE \x1b[0m'
        : log.action === 'BLOCKED'
          ? '\x1b[31mBLOCKED\x1b[0m'
          : log.action === 'STOPPED'
            ? '\x1b[31mSTOPPED\x1b[0m'
            : '\x1b[90m  SKIP \x1b[0m'
    console.log(`  [${tag}] t=${String(log.tick).padStart(3)} ${log.marketId.padEnd(25)} ${log.detail}`)
  }

  // Positions
  if (result.positions.length > 0) {
    console.log(`\n--- Open Positions (${result.positions.length}) ---`)
    for (const p of result.positions) {
      console.log(
        `  ${p.marketId.padEnd(25)} ${p.side.padEnd(3)} ` +
          `size=${p.size.toFixed(2)} entry=${p.avgEntry.toFixed(4)} ` +
          `mark=${p.currentPrice.toFixed(4)} uPnL=$${p.unrealizedPnl.toFixed(4)}`,
      )
    }
  }

  // Orders
  const filled = result.orders.filter((o) => o.status === 'FILLED')
  const rejected = result.orders.filter((o) => o.status === 'REJECTED')
  console.log(`\n--- Order Summary ---`)
  console.log(`  Total orders:  ${result.orders.length}`)
  console.log(`  Filled:        ${filled.length}`)
  console.log(`  Rejected:      ${rejected.length}`)

  // Portfolio
  console.log(`\n--- Portfolio ---`)
  console.log(`  Initial equity:    $${10_000}`)
  console.log(`  Cash balance:      $${result.portfolio.cash.toFixed(2)}`)
  console.log(`  Position value:    $${result.portfolio.openNotional.toFixed(2)}`)
  console.log(`  Total equity:      $${result.portfolio.equity.toFixed(2)}`)
  console.log(`  Locked arb profit: $${result.portfolio.lockedArbProfit.toFixed(4)} (realized at settlement)`)
  console.log(`  Max drawdown:      ${result.portfolio.drawdownPct.toFixed(2)}%`)

  // Monte Carlo
  console.log(`\n--- Monte Carlo Stress Test ---`)
  console.log(`  Mean PnL:        $${result.monteCarlo.mean.toFixed(4)}`)
  console.log(`  P05 (worst 5%):  $${result.monteCarlo.p05.toFixed(4)}`)

  console.log('\n=== Paper trading session complete ===')
}

void main()
