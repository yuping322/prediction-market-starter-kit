import { fetchRealTicks } from '../integration/real-data'
import { tickToMarketEvents } from '../ingest/adapter'
import { applyBookEvent, getDefaultBookState, getTopOfBook } from '../ingest/orderbook'
import { FeatureEngine } from '../features/engine'
import { generateOpportunity } from '../signal'
import { preTradeCheck, type PreTradeContext } from '../risk/pre_trade'
import { shouldTriggerDrawdownStop } from '../risk/realtime'
import { kellySize } from '../execution/kelly'
import { stoikovPriceAdjust } from '../execution/stoikov'
import { monteCarloPnl } from '../montecarlo/sim'
import { generateWallet, type PaperWallet } from './wallet'
import { PaperPortfolio, type PaperOrder } from './portfolio'
import type { RiskState } from '../contracts/types'
import { loadConfig, type BotConfig } from '../config'

import { saveSession } from './persistence'

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
  config: BotConfig
}

export async function runPaperTrading(opts?: {
  initialEquity?: number
  maxOpenNotional?: number
  tickLimit?: number
  privateKey?: string
  configPath?: string
}): Promise<PaperTradingResult> {
  const config = loadConfig(opts?.configPath)

  const initialEquity = opts?.initialEquity ?? config.portfolio.initialEquity
  const maxOpenNotional = opts?.maxOpenNotional ?? config.portfolio.maxOpenNotional
  const tickLimit = opts?.tickLimit ?? config.data.tickLimit

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
    const top = getTopOfBook(book)
    const opp = generateOpportunity(
      feature,
      book,
      tick.ts,
    )

    if (!opp) {
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'SKIP',
        detail: `No arb opportunity (yesAsk+noAsk=${(top.yesAsk + top.noAsk).toFixed(4)})`,
      })
      continue
    }

    if (opp.confidence < config.signal.confidenceThreshold) {
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'SKIP',
        detail: `Low confidence: ${opp.confidence.toFixed(3)} < ${config.signal.confidenceThreshold}`,
      })
      continue
    }

    // Pre-trade risk check
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
      maxOpenNotional: maxOpenNotional,
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
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'BLOCKED',
        detail: `Risk: ${decision.reason}`,
      })
      continue
    }

    // Drawdown circuit breaker (configurable thresholds)
    const pnlPct = (portfolio.totalPnl / Math.max(1, portfolio.equity)) * 100
    if (
      pnlPct <= config.risk.intradayStopPct ||
      portfolio.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)
    ) {
      logs.push({
        tick: tick.ts,
        marketId: tick.marketId,
        action: 'STOPPED',
        detail: `Drawdown breaker: PnL=${pnlPct.toFixed(2)}% DD=${portfolio.drawdownPct.toFixed(2)}%`,
      })
      continue
    }

    // Kelly sizing (configurable cap)
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

    // Stoikov inventory adjustment (configurable risk aversion)
    const inventory = Array.from(portfolio.positions.values()).reduce(
      (acc, p) => acc + (p.side === 'YES' ? p.size : -p.size),
      0,
    )
    const adjYesPrice = stoikovPriceAdjust(
      top.yesAsk,
      inventory,
      config.execution.stoikovRiskAversion,
    )
    const adjNoPrice = stoikovPriceAdjust(
      top.noAsk,
      -inventory,
      config.execution.stoikovRiskAversion,
    )

    // Execute dual-leg paper trade with slippage + partial fill
    const yesOrder = portfolio.executeTrade(
      tick.marketId,
      'YES',
      adjYesPrice,
      size / 2,
      tick.ts,
      config.execution.slippageBps,
      config.execution.partialFillBaseRate,
      config.execution.partialFillSizeDecay,
    )
    const noOrder = portfolio.executeTrade(
      tick.marketId,
      'NO',
      adjNoPrice,
      size / 2,
      tick.ts,
      config.execution.slippageBps,
      config.execution.partialFillBaseRate,
      config.execution.partialFillSizeDecay,
    )

    const legDetail = (o: PaperOrder) =>
      o.status === 'REJECTED'
        ? 'REJECTED'
        : `${o.filledSize.toFixed(2)}@${o.price.toFixed(4)}${o.status === 'PARTIAL' ? '(P)' : ''}`

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

  // 6. Persist session for scanner
  const filledOrders = portfolio.orders.filter((o) => o.status !== 'REJECTED')
  saveSession({
    wallet: {
      address: wallet.address,
      safeAddress: wallet.safeAddress,
      privateKey: wallet.privateKey,
    },
    updatedAt: new Date().toISOString(),
    portfolio: {
      initialEquity,
      cash: portfolio.cashBalance,
      equity: portfolio.equity,
      peakEquity: portfolio.peakEquity,
    },
    positions: Array.from(portfolio.positions.values()),
    orders: portfolio.orders,
    stats: {
      totalTrades: portfolio.orders.length,
      fillRate: filledOrders.length / Math.max(1, portfolio.orders.length),
      totalArbProfit: arbProfit,
      totalSlippageCost: portfolio.totalSlippageCost,
      sessionsRun: 1,
    },
  })

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
    config,
  }
}
