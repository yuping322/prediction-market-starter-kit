import type { BookStore } from '../ingest/orderbook'
import type { OrderIntent, OrderStatus, OrderUpdate } from '../contracts/types'
import { getApprovedRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import { buildValidationSnapshotEvent, type ExchangeAdapter, type ExchangeConnectionState, type ExchangeConnectionStatus, type ExchangeListeners, type MarketSubscription } from './exchange'
import { applyEventToBooks } from '../ingest/orderbook'
import { buildLiveMarketRegistry, polymarketMessageToMarketEvents } from '../ingest/adapter'
import { fetchValidationMarkets } from './real-data'
import { PolymarketWsClient, type PolymarketWsHandlers, type PolymarketWsSubscription } from '@/lib/polymarket/ws'

export type PolymarketPaperMarketStream = {
  connect(subscription?: PolymarketWsSubscription): Promise<void>
  disconnect(): Promise<void>
  updateSubscription(subscription: PolymarketWsSubscription): Promise<void>
}

export type PolymarketPaperAdapterOptions = {
  runtime?: RuntimeConfig
  marketWsUrl?: string
  fillDelayMs?: number
  bootstrapValidation?: boolean
  validationFetchLimit?: number
  marketStreamFactory?: (handlers: PolymarketWsHandlers) => PolymarketPaperMarketStream
  now?: () => number
}

type PaperOrderState = {
  intent: OrderIntent
  update: OrderUpdate
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'filled' || status === 'canceled' || status === 'rejected' || status === 'expired'
}

function isDifferentUpdate(previous: OrderUpdate | undefined, next: OrderUpdate): boolean {
  return (
    !previous ||
    previous.status !== next.status ||
    previous.filledSize !== next.filledSize ||
    previous.remainingSize !== next.remainingSize ||
    previous.avgPrice !== next.avgPrice ||
    previous.reason !== next.reason
  )
}

export class PolymarketPaperAdapter implements ExchangeAdapter {
  readonly adapterId = 'polymarket-paper'
  readonly mode = 'paper' as const

  private readonly runtime: RuntimeConfig
  private readonly listeners: ExchangeListeners = {}
  private readonly fillDelayMs: number
  private readonly bootstrapValidation: boolean
  private readonly validationFetchLimit: number
  private readonly now: () => number

  private subscriptions: MarketSubscription[] = []
  private registry = buildLiveMarketRegistry([])
  private books: BookStore = {}
  private trackedOrders = new Map<string, PaperOrderState>()
  private timers = new Map<string, Set<ReturnType<typeof setTimeout>>>()
  private marketStream?: PolymarketPaperMarketStream
  private sequence = 0
  private connectionState: ExchangeConnectionState = {
    status: 'disconnected',
    marketChannel: 'disconnected',
    userChannel: 'disconnected',
  }

  constructor(private readonly options: PolymarketPaperAdapterOptions = {}) {
    this.runtime = options.runtime ?? getApprovedRuntimeConfig()
    this.fillDelayMs = Math.max(0, options.fillDelayMs ?? 25)
    this.bootstrapValidation = options.bootstrapValidation ?? true
    this.validationFetchLimit = Math.max(10, options.validationFetchLimit ?? 100)
    this.now = options.now ?? (() => Date.now())
  }

  async connect(listeners?: ExchangeListeners): Promise<void> {
    Object.assign(this.listeners, listeners)
    this.marketStream = this.marketStream ?? this.createMarketStream()
    this.connectionState = {
      status: 'connecting',
      marketChannel: 'connecting',
      userChannel: 'connected',
    }
    this.listeners.onConnectionState?.({ ...this.connectionState })

    if (this.bootstrapValidation) {
      await this.bootstrapValidationSnapshots()
    }

    await this.marketStream.connect(this.currentWsSubscription())
  }

  async disconnect(): Promise<void> {
    for (const timers of this.timers.values()) {
      for (const timer of timers) clearTimeout(timer)
    }
    this.timers.clear()
    await this.marketStream?.disconnect()
    this.marketStream = undefined
    this.connectionState = {
      status: 'disconnected',
      marketChannel: 'disconnected',
      userChannel: 'disconnected',
      lastMessageAt: this.connectionState.lastMessageAt,
    }
    this.listeners.onConnectionState?.({ ...this.connectionState })
  }

  async subscribeMarkets(subscriptions: MarketSubscription[]): Promise<void> {
    this.subscriptions = subscriptions
    this.registry = buildLiveMarketRegistry(subscriptions)
    const subscription = this.currentWsSubscription()
    await this.marketStream?.updateSubscription(subscription)
  }

  async placeOrder(intent: OrderIntent): Promise<OrderUpdate> {
    const ts = this.now()
    const orderId = `paper-${++this.sequence}-${intent.clientOrderId ?? intent.intentId}`
    const accepted: OrderUpdate = {
      orderId,
      exchangeOrderId: orderId,
      clientOrderId: intent.clientOrderId ?? intent.intentId,
      intentId: intent.intentId,
      opportunityId: intent.opportunityId,
      legId: intent.legId,
      marketId: intent.marketId,
      tokenId: intent.tokenId,
      outcome: intent.outcome,
      action: intent.action,
      status: 'accepted',
      filledSize: 0,
      remainingSize: intent.size,
      source: 'simulation',
      ts,
      tsExchange: ts,
      tsLocal: ts,
    }

    this.storeAndEmitUpdate(intent, accepted)
    this.scheduleOrderLifecycle(orderId)
    return accepted
  }

  async cancelOrder(orderId: string, reason = 'USER_CANCEL'): Promise<OrderUpdate> {
    const tracked = this.trackedOrders.get(orderId)
    if (!tracked) {
      const ts = this.now()
      return {
        orderId,
        exchangeOrderId: orderId,
        intentId: orderId,
        opportunityId: orderId,
        legId: 'paper',
        marketId: 'unknown',
        tokenId: 'unknown',
        status: 'canceled',
        filledSize: 0,
        remainingSize: 0,
        reason,
        source: 'cancel',
        ts,
        tsExchange: ts,
        tsLocal: ts,
      }
    }

    if (isTerminalStatus(tracked.update.status)) {
      return tracked.update
    }

    this.clearTimers(orderId)
    const ts = this.now()
    const canceled: OrderUpdate = {
      ...tracked.update,
      status: 'canceled',
      reason,
      source: 'cancel',
      ts,
      tsExchange: ts,
      tsLocal: ts,
    }
    this.storeAndEmitUpdate(tracked.intent, canceled)
    return canceled
  }

  async syncOpenOrders(): Promise<OrderUpdate[]> {
    return [...this.trackedOrders.values()]
      .map((tracked) => tracked.update)
      .filter((update) => !isTerminalStatus(update.status))
      .map((update) => ({ ...update }))
  }

  getConnectionState(): ExchangeConnectionState {
    return { ...this.connectionState }
  }

  private createMarketStream(): PolymarketPaperMarketStream {
    const handlers: PolymarketWsHandlers = {
      onMessage: (message) => {
        const tsLocal = this.now()
        const events = polymarketMessageToMarketEvents(message, this.registry, tsLocal)
        for (const event of events) {
          const tokenMap = this.registry.byMarketId[event.marketId]
          this.books = applyEventToBooks(this.books, event, tokenMap)
          this.connectionState.lastMessageAt = event.tsLocal
          this.listeners.onMarketEvent?.(event)
        }
      },
      onStatusChange: (status, reason) => {
        this.updateMarketConnectionState(status, reason)
      },
      onError: (error) => this.listeners.onError?.(error),
    }

    return this.options.marketStreamFactory?.(handlers) ?? new PolymarketWsClient({
      channel: 'market',
      url: this.options.marketWsUrl,
      reconnectBackoffMs: this.runtime.live.reconnectBackoffMs,
      maxReconnectBackoffMs: this.runtime.live.maxReconnectBackoffMs,
      staleAfterMs: this.runtime.live.staleAfterMs,
      ...handlers,
    })
  }

  private async bootstrapValidationSnapshots(): Promise<void> {
    if (this.subscriptions.length === 0) return
    const markets = await fetchValidationMarkets(this.validationFetchLimit).catch(() => [])
    if (markets.length === 0) return

    const byMarketId = new Map(markets.map((market) => [market.marketId, market]))
    for (const subscription of this.subscriptions) {
      const descriptor = byMarketId.get(subscription.marketId)
      if (!descriptor) continue
      const ts = this.now()
      const event = buildValidationSnapshotEvent(
        {
          ...descriptor,
          tokenMap: subscription.tokenMap,
        },
        ts,
        ++this.sequence,
      )
      this.books = applyEventToBooks(this.books, event, subscription.tokenMap)
      this.connectionState.lastMessageAt = ts
      this.listeners.onMarketEvent?.(event)
    }
  }

  private currentWsSubscription(): PolymarketWsSubscription {
    return {
      marketIds: this.subscriptions.map((subscription) => subscription.marketId),
      tokenIds: this.subscriptions.flatMap((subscription) => [subscription.tokenMap.yesTokenId, subscription.tokenMap.noTokenId]),
    }
  }

  private scheduleOrderLifecycle(orderId: string): void {
    const tracked = this.trackedOrders.get(orderId)
    if (!tracked) return
    const { intent } = tracked

    if (intent.postOnly) {
      const fillRatio = clampRatio(this.runtime.execution.passiveFillRatio)
      if (fillRatio <= 0) return
      this.schedule(orderId, this.fillDelayMs, () => {
        const current = this.trackedOrders.get(orderId)
        if (!current || isTerminalStatus(current.update.status)) return
        const fillSize = Math.min(intent.size, intent.size * fillRatio)
        if (fillSize <= 0) return
        const remainingSize = Math.max(0, intent.size - fillSize)
        const ts = this.now()
        const next: OrderUpdate = {
          ...current.update,
          status: remainingSize <= 1e-9 ? 'filled' : 'partial_fill',
          filledSize: fillSize,
          remainingSize,
          lastFilledSize: fillSize - current.update.filledSize,
          lastFilledPrice: intent.limitPrice,
          avgPrice: intent.limitPrice,
          source: 'simulation',
          ts,
          tsExchange: ts,
          tsLocal: ts,
        }
        this.storeAndEmitUpdate(current.intent, next)
      })
      return
    }

    const aggressive = this.estimateAggressiveFill(intent)
    const fillSize = intent.tif === 'FOK' && aggressive.fillSize + 1e-9 < intent.size ? 0 : aggressive.fillSize
    const remainingSize = Math.max(0, intent.size - fillSize)

    if (fillSize > 0) {
      this.schedule(orderId, this.fillDelayMs, () => {
        const current = this.trackedOrders.get(orderId)
        if (!current || isTerminalStatus(current.update.status)) return
        const ts = this.now()
        const next: OrderUpdate = {
          ...current.update,
          status: remainingSize <= 1e-9 ? 'filled' : 'partial_fill',
          filledSize: fillSize,
          remainingSize,
          lastFilledSize: fillSize - current.update.filledSize,
          lastFilledPrice: aggressive.fillPrice,
          avgPrice: aggressive.fillPrice,
          source: 'simulation',
          ts,
          tsExchange: ts,
          tsLocal: ts,
          reason: remainingSize <= 1e-9 ? undefined : 'IOC_PARTIAL',
        }
        this.storeAndEmitUpdate(current.intent, next)
      })
    }

    if (remainingSize > 1e-9 || fillSize <= 0) {
      this.schedule(orderId, this.fillDelayMs + 1, () => {
        const current = this.trackedOrders.get(orderId)
        if (!current || isTerminalStatus(current.update.status)) return
        const ts = this.now()
        const terminal: OrderUpdate = {
          ...current.update,
          status: fillSize > 0 ? 'expired' : intent.tif === 'FOK' ? 'rejected' : 'expired',
          filledSize: fillSize,
          remainingSize,
          avgPrice: fillSize > 0 ? aggressive.fillPrice : current.update.avgPrice,
          reason: fillSize > 0 ? 'IOC_PARTIAL' : intent.tif === 'FOK' ? 'FOK_UNFILLED' : 'IOC_UNFILLED',
          source: 'simulation',
          ts,
          tsExchange: ts,
          tsLocal: ts,
        }
        this.storeAndEmitUpdate(current.intent, terminal)
      })
    }
  }

  private estimateAggressiveFill(intent: OrderIntent): { fillSize: number; fillPrice: number } {
    const book = this.books[intent.marketId]
    const side = intent.outcome === 'yes' ? book?.yes : book?.no
    const level = intent.action === 'buy' ? side?.asks[0] : side?.bids[0]
    const fillRatio = clampRatio(this.runtime.execution.hedgeFillRatio)

    if (!level) {
      return {
        fillSize: intent.size * fillRatio,
        fillPrice: intent.limitPrice,
      }
    }

    const marketable = intent.action === 'buy' ? level.price <= intent.limitPrice + 1e-9 : level.price + 1e-9 >= intent.limitPrice
    if (!marketable) {
      return {
        fillSize: 0,
        fillPrice: level.price,
      }
    }

    return {
      fillSize: Math.min(intent.size, level.size, intent.size * fillRatio),
      fillPrice: level.price,
    }
  }

  private schedule(orderId: string, delayMs: number, callback: () => void): void {
    const timer = setTimeout(() => {
      const timers = this.timers.get(orderId)
      timers?.delete(timer)
      if (timers && timers.size === 0) this.timers.delete(orderId)
      callback()
    }, Math.max(0, delayMs))
    const timers = this.timers.get(orderId) ?? new Set<ReturnType<typeof setTimeout>>()
    timers.add(timer)
    this.timers.set(orderId, timers)
  }

  private clearTimers(orderId: string): void {
    const timers = this.timers.get(orderId)
    if (!timers) return
    for (const timer of timers) clearTimeout(timer)
    this.timers.delete(orderId)
  }

  private storeAndEmitUpdate(intent: OrderIntent, update: OrderUpdate): void {
    const previous = this.trackedOrders.get(update.orderId)?.update
    if (!isDifferentUpdate(previous, update)) return
    this.trackedOrders.set(update.orderId, { intent, update })
    if (isTerminalStatus(update.status)) {
      this.clearTimers(update.orderId)
    }
    this.connectionState.lastMessageAt = update.tsLocal ?? update.ts
    this.listeners.onOrderUpdate?.(update)
  }

  private updateMarketConnectionState(status: ExchangeConnectionStatus, reason?: string): void {
    this.connectionState.marketChannel = status
    this.connectionState.userChannel = 'connected'

    if (status === 'connected') {
      this.connectionState.status = 'connected'
    } else if (status === 'error') {
      this.connectionState.status = 'error'
    } else if (status === 'reconnecting') {
      this.connectionState.status = 'reconnecting'
    } else if (status === 'connecting') {
      this.connectionState.status = 'connecting'
    } else {
      this.connectionState.status = 'disconnected'
    }

    this.connectionState.reason = reason
    this.listeners.onConnectionState?.({ ...this.connectionState })
  }
}
