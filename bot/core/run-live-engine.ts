import { getApprovedRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import type { MarketEvent, MetricEvent, Opportunity, OrderIntent, OrderStatus, OrderUpdate, RiskState } from '../contracts/types'
import { buildExecutionPlan } from '../execution/orchestrator'
import { FeatureEngine } from '../features/engine'
import type { ExchangeAdapter, ExchangeConnectionState, MarketSubscription } from '../integration/exchange'
import { applyEventToBooks, createBookState, type BookStore } from '../ingest/orderbook'
import { collectMetrics, type SimMetrics } from '../metrics/collector'
import { createRiskState, updateRiskStateAfterExecution } from '../risk/realtime'
import { preTradeCheck } from '../risk/pre_trade'
import { generateOpportunity } from '../signal'

type ActiveTrade = {
  opportunity: Opportunity
  plan: ReturnType<typeof buildExecutionPlan>
  passiveFilledSize: number
  hedgeSubmittedSize: number
  hedgeFilledSize: number
  passiveTerminal: boolean
  hedgeOrders: Map<string, { filledSize: number; final: boolean }>
  cancelTimer?: ReturnType<typeof setTimeout>
}

export type LiveEngineSnapshot = SimMetrics & {
  books: BookStore
  riskState: RiskState
  configVersion: string
  workingOrders: OrderUpdate[]
  activeMarkets: string[]
  connectionState: ExchangeConnectionState
}

function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'filled' || status === 'canceled' || status === 'rejected' || status === 'expired'
}

export function createLiveEngine(
  adapter: ExchangeAdapter,
  subscriptions: MarketSubscription[],
  overrides?: Partial<RuntimeConfig>,
) {
  const config = getApprovedRuntimeConfig(overrides)
  const featureEngine = new FeatureEngine()
  let books: BookStore = {}
  let riskState = createRiskState(config)
  let opportunities = 0
  let executed = 0
  let totalPnl = 0
  let connectionState = adapter.getConnectionState()
  const metricEvents: MetricEvent[] = []
  const activeTrades = new Map<string, ActiveTrade>()
  const activeTradeByMarket = new Map<string, string>()
  const activeTradeByIntent = new Map<string, string>()
  const activeTradeByOrder = new Map<string, string>()
  const workingOrders = new Map<string, OrderUpdate>()

  function registerIntent(opportunityId: string, intent: OrderIntent) {
    activeTradeByIntent.set(intent.intentId, opportunityId)
    if (intent.clientOrderId) activeTradeByIntent.set(intent.clientOrderId, opportunityId)
  }

  function unregisterTrade(opportunityId: string) {
    const active = activeTrades.get(opportunityId)
    if (!active) return
    if (active.cancelTimer) clearTimeout(active.cancelTimer)
    activeTrades.delete(opportunityId)
    activeTradeByMarket.delete(active.opportunity.marketId)

    for (const [key, value] of [...activeTradeByIntent.entries()]) {
      if (value === opportunityId) activeTradeByIntent.delete(key)
    }
    for (const [key, value] of [...activeTradeByOrder.entries()]) {
      if (value === opportunityId) activeTradeByOrder.delete(key)
    }
  }

  async function submitHedge(active: ActiveTrade, deltaSize: number): Promise<void> {
    if (deltaSize <= 0) return
    const hedgeIndex = active.hedgeOrders.size + 1
    const hedgeIntent: OrderIntent = {
      ...active.plan.hedgeLeg,
      intentId: `${active.plan.hedgeLeg.intentId}-${hedgeIndex}`,
      clientOrderId: `${active.plan.hedgeLeg.clientOrderId ?? active.plan.hedgeLeg.intentId}-${hedgeIndex}`,
      size: deltaSize,
    }

    registerIntent(active.opportunity.id, hedgeIntent)
    active.hedgeSubmittedSize += deltaSize
    const update = await adapter.placeOrder(hedgeIntent)
    activeTradeByOrder.set(update.orderId, active.opportunity.id)
    active.hedgeOrders.set(update.orderId, { filledSize: update.filledSize, final: isTerminalStatus(update.status) })
    workingOrders.set(update.orderId, update)
  }

  function maybeFinalizeTrade(active: ActiveTrade) {
    const hedgeOrders = [...active.hedgeOrders.values()]
    const allHedgesTerminal = hedgeOrders.every((entry) => entry.final)
    const requiredHedge = active.passiveFilledSize
    const passiveHasEnded = active.passiveTerminal
    if (!passiveHasEnded) return
    if (requiredHedge > 0 && !allHedgesTerminal && active.hedgeFilledSize + 1e-9 < requiredHedge) return

    const completion = requiredHedge > 0 ? Math.min(1, active.hedgeFilledSize / requiredHedge) : 0
    const slippageBps =
      ((Math.abs(active.plan.passiveLeg.limitPrice - active.opportunity.legs[0].referencePrice) /
        Math.max(0.01, active.opportunity.legs[0].referencePrice)) +
        (Math.abs(active.plan.hedgeLeg.limitPrice - active.opportunity.legs[1].referencePrice) /
          Math.max(0.01, active.opportunity.legs[1].referencePrice))) *
      5_000
    const realizedNotional = active.hedgeFilledSize * (active.plan.passiveLeg.limitPrice + active.plan.hedgeLeg.limitPrice)
    const pnl = active.hedgeFilledSize * (active.opportunity.evBps / 10_000) - active.hedgeFilledSize * (slippageBps / 10_000)
    const completed = requiredHedge > 0 && completion >= 0.95

    executed += 1
    totalPnl += pnl
    metricEvents.push(
      {
        opportunityId: active.opportunity.id,
        marketId: active.opportunity.marketId,
        stage: 'execution',
        ts: Date.now(),
        latencyMs: riskState.lastLatencyMs,
        slippageBps,
        completion,
        pnl,
      },
      {
        opportunityId: active.opportunity.id,
        marketId: active.opportunity.marketId,
        stage: completed ? 'fill' : 'kill_switch',
        ts: Date.now(),
        completion,
        reason: completed ? undefined : 'HEDGE_INCOMPLETE',
      },
    )

    riskState.pendingNotional = Math.max(0, riskState.pendingNotional - active.plan.approvedSize * active.plan.passiveLeg.limitPrice)
    riskState = updateRiskStateAfterExecution(riskState, {
      pnl,
      realizedNotional,
      completed,
      latencyMs: riskState.lastLatencyMs,
    })
    unregisterTrade(active.opportunity.id)
  }

  async function onOrderUpdate(update: OrderUpdate): Promise<void> {
    workingOrders.set(update.orderId, update)
    const opportunityId = activeTradeByOrder.get(update.orderId) ?? activeTradeByIntent.get(update.intentId) ?? (update.clientOrderId ? activeTradeByIntent.get(update.clientOrderId) : undefined)
    if (!opportunityId) return

    const active = activeTrades.get(opportunityId)
    if (!active) return

    activeTradeByOrder.set(update.orderId, opportunityId)

    const isPassive = update.intentId.startsWith(active.plan.passiveLeg.intentId)
    if (isPassive) {
      const delta = Math.max(0, update.filledSize - active.passiveFilledSize)
      active.passiveFilledSize = Math.max(active.passiveFilledSize, update.filledSize)
      active.passiveTerminal = isTerminalStatus(update.status)
      if (active.passiveTerminal && active.cancelTimer) {
        clearTimeout(active.cancelTimer)
        active.cancelTimer = undefined
      }
      if (delta > 0 && config.execution.allowIocHedge) {
        await submitHedge(active, delta)
      }
      maybeFinalizeTrade(active)
      return
    }

    const previous = active.hedgeOrders.get(update.orderId)
    const delta = Math.max(0, update.filledSize - (previous?.filledSize ?? 0))
    active.hedgeFilledSize += delta
    active.hedgeOrders.set(update.orderId, {
      filledSize: update.filledSize,
      final: isTerminalStatus(update.status),
    })
    maybeFinalizeTrade(active)
  }

  async function onMarketEvent(event: MarketEvent) {
    const tokenMap = subscriptions.find((subscription) => subscription.marketId === event.marketId)?.tokenMap
    books = applyEventToBooks(books, event, tokenMap)

    if (activeTradeByMarket.has(event.marketId)) return

    const book = books[event.marketId] ?? createBookState(event.marketId, tokenMap, false)
    const hasTwoSidedBook = book.yes.bids.length > 0 && book.yes.asks.length > 0 && book.no.bids.length > 0 && book.no.asks.length > 0
    if (!hasTwoSidedBook) return

    const feature = featureEngine.build(event.marketId, event.tsLocal, book, [event])
    const opportunity = generateOpportunity(feature, book, event.tsLocal, config)
    if (!opportunity) return

    opportunities += 1
    metricEvents.push({
      opportunityId: opportunity.id,
      marketId: opportunity.marketId,
      stage: 'opportunity',
      ts: event.tsLocal,
    })

    const requestedSize = Math.min(config.risk.maxSize, riskState.equity * config.models.kelly.maxFraction)
    const decision = preTradeCheck(
      opportunity,
      {
        riskState,
        requestedSize,
        availableDepthSize: Math.min(book.yes.asks[0]?.size ?? 0, book.no.asks[0]?.size ?? 0),
        latencyMs: connectionState.lastMessageAt ? Math.max(0, Date.now() - connectionState.lastMessageAt) : 0,
      },
      config,
    )

    if (!decision.allow) {
      metricEvents.push({
        opportunityId: opportunity.id,
        marketId: opportunity.marketId,
        stage: 'risk_reject',
        ts: event.tsLocal,
        reason: decision.reason,
      })
      return
    }

    const plan = buildExecutionPlan(
      opportunity,
      {
        equity: riskState.equity,
        inventory: riskState.openNotional,
        riskDecision: decision,
        now: event.tsLocal,
        volatility1s: feature.volatility1s,
      },
      config,
    )

    if (plan.approvedSize <= 0) return

    const active: ActiveTrade = {
      opportunity,
      plan,
      passiveFilledSize: 0,
      hedgeSubmittedSize: 0,
      hedgeFilledSize: 0,
      passiveTerminal: false,
      hedgeOrders: new Map(),
    }

    activeTrades.set(opportunity.id, active)
    activeTradeByMarket.set(opportunity.marketId, opportunity.id)
    registerIntent(opportunity.id, plan.passiveLeg)
    riskState.pendingNotional += plan.approvedSize * plan.passiveLeg.limitPrice

    const passiveUpdate = await adapter.placeOrder(plan.passiveLeg)
    activeTradeByOrder.set(passiveUpdate.orderId, opportunity.id)
    workingOrders.set(passiveUpdate.orderId, passiveUpdate)

    const ttlDelay = Math.max(0, plan.passiveLeg.expiresAt - Date.now())
    active.cancelTimer = setTimeout(() => {
      void adapter.cancelOrder(passiveUpdate.orderId, 'TTL_EXPIRED').catch(() => undefined)
    }, ttlDelay)
  }

  return {
    async start(): Promise<void> {
      await adapter.subscribeMarkets(subscriptions)
      await adapter.connect({
        onMarketEvent: (event) => {
          void onMarketEvent(event)
        },
        onOrderUpdate: (update) => {
          void onOrderUpdate(update)
        },
        onConnectionState: (state) => {
          connectionState = state
          riskState.lastLatencyMs = state.lastMessageAt ? Math.max(0, Date.now() - state.lastMessageAt) : 0
        },
      })
    },
    async stop(): Promise<void> {
      for (const active of activeTrades.values()) {
        if (active.cancelTimer) clearTimeout(active.cancelTimer)
      }
      await adapter.disconnect()
    },
    getSnapshot(): LiveEngineSnapshot {
      const metrics = collectMetrics({
        opportunities,
        executed,
        totalPnl,
        metricEvents,
        riskState,
      })

      return {
        ...metrics,
        books,
        riskState,
        configVersion: config.version,
        workingOrders: [...workingOrders.values()],
        activeMarkets: [...activeTradeByMarket.keys()],
        connectionState,
      }
    },
  }
}
