import { fetchRealTicks } from '../integration/real-data'
import { tickToMarketEvents } from '../ingest/adapter'
import { applyBookEvent, getDefaultBookState } from '../ingest/orderbook'
import { FeatureEngine } from '../features/engine'
import { generateOpportunity } from '../signal'
import { preTradeCheck } from '../risk/pre_trade'
import { shouldTriggerDrawdownStop } from '../risk/realtime'
import { kellySize } from '../execution/kelly'
import { stoikovPriceAdjust } from '../execution/stoikov'
import { monteCarloPnl } from '../montecarlo/sim'
import { generateWallet, type PaperWallet } from './wallet'
import { PaperPortfolio, type PaperOrder } from './portfolio'

export type PaperTradeLog = {
  tick: number
  marketId: string
  action: string
  detail: string
}

export type PaperTradingResult = {
  wallet: {
    address: string
    safeAddress: string
    mnemonic: string
  }
  portfolio: ReturnType<PaperPortfolio['snapshot']>
  positions: Array<{
    marketId: string
    side: string
    size: number
    avgEntry: number
    currentPrice: number
    unrealizedPnl: number
  }>
  orders: PaperOrder[]
  logs: PaperTradeLog[]
  monteCarlo: { mean: number; p05: number }
}

export async function runPaperTrading(opts?: {
  initialEquity?: number
  maxOpenNotional?: number
  tickLimit?: number
  privateKey?: string
}): Promise<PaperTradingResult> {
  const initialEquity = opts?.initialEquity ?? 10_000
  const maxOpenNotional = opts?.maxOpenNotional ?? 2_000
  const tickLimit = opts?.tickLimit ?? 50

  // 1. Generate or restore wallet
  let wallet: PaperWallet
  if (opts?.privateKey) {
    const { restoreWallet } = await import('./wallet')
    wallet = restoreWallet(opts.privateKey)
  } else {
    wallet = generateWallet()
  }

  // 2. Fetch real market data
  const ticks = await fetchRealTicks(tickLimit)
  if (ticks.length === 0) {
    throw new Error('No market data available')
  }

  // 3. Initialize portfolio and pipeline
  const portfolio = new PaperPortfolio(initialEquity)
  const featureEngine = new FeatureEngine()
  let book = getDefaultBookState()
  const logs: PaperTradeLog[] = []

  // 4. Run through each tick
  for (const tick of ticks) {
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }

    // Mark existing positions to market
    portfolio.markToMarket(tick.marketId, tick.yesBid, tick.noBid)

    // Feature extraction
    const feature = featureEngine.build(tick.marketId, tick.ts, book, events)
    const opp = generateOpportunity(feature, book, tick.ts)

    if (!opp) {
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'SKIP',
        detail: `No arb opportunity (yesAsk+noAsk=${(book.yesAsk + book.noAsk).toFixed(4)})`,
      })
      continue
    }

    // Pre-trade risk check
    const decision = preTradeCheck(opp, portfolio.openNotional, maxOpenNotional)
    if (!decision.allow) {
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'BLOCKED',
        detail: `Risk: ${decision.reason}`,
      })
      continue
    }

    // Drawdown circuit breaker
    const pnlPct = (portfolio.totalPnl / Math.max(1, portfolio.equity)) * 100
    if (shouldTriggerDrawdownStop(pnlPct, portfolio.drawdownPct)) {
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'STOPPED',
        detail: `Drawdown breaker: PnL=${pnlPct.toFixed(2)}% DD=${portfolio.drawdownPct.toFixed(2)}%`,
      })
      continue
    }

    // Kelly sizing
    const size = kellySize(opp.evBps, opp.confidence, portfolio.equity)
    if (size < 0.01) {
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'SKIP',
        detail: `Size too small: ${size.toFixed(4)}`,
      })
      continue
    }

    // Stoikov inventory adjustment
    const inventory = Array.from(portfolio.positions.values()).reduce(
      (acc, p) => acc + (p.side === 'YES' ? p.size : -p.size),
      0,
    )
    const adjYesPrice = stoikovPriceAdjust(book.yesAsk, inventory)
    const adjNoPrice = stoikovPriceAdjust(book.noAsk, -inventory)

    // Execute dual-leg paper trade (buy YES + buy NO = lock in arb)
    const yesOrder = portfolio.executeTrade(tick.marketId, 'YES', adjYesPrice, size / 2, tick.ts)
    const noOrder = portfolio.executeTrade(tick.marketId, 'NO', adjNoPrice, size / 2, tick.ts)

    const legDetail = (o: PaperOrder) =>
      o.status === 'FILLED'
        ? `${o.filledSize.toFixed(2)}@${o.price.toFixed(4)}`
        : o.status

    logs.push({
      tick: tick.ts,
      marketId: tick.marketId,
      action: 'TRADE',
      detail:
        `EV=${opp.evBps.toFixed(1)}bps conf=${opp.confidence.toFixed(3)} ` +
        `YES=${legDetail(yesOrder)} NO=${legDetail(noOrder)}`,
    })
  }

  // 5. Monte Carlo on locked arb profit (guaranteed at settlement)
  const arbProfit = portfolio.lockedArbProfit
  const mc = monteCarloPnl(arbProfit)

  return {
    wallet: {
      address: wallet.address,
      safeAddress: wallet.safeAddress,
      mnemonic: wallet.mnemonic,
    },
    portfolio: portfolio.snapshot(),
    positions: Array.from(portfolio.positions.values()),
    orders: portfolio.orders,
    logs,
    monteCarlo: { mean: mc.mean, p05: mc.p05 },
  }
}
