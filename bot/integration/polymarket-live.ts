import type { ClobClient, OpenOrder } from '@polymarket/clob-client'
import type { Wallet, providers } from 'ethers'
import type { OrderIntent, OrderUpdate } from '../contracts/types'
import { getApprovedRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import {
  buildLiveMarketRegistry,
  orderBookSummaryToSnapshotEvent,
  polymarketMessageToMarketEvents,
  polymarketMessageToOrderUpdates,
} from '../ingest/adapter'
import type {
  ExchangeAdapter,
  ExchangeConnectionState,
  ExchangeConnectionStatus,
  ExchangeListeners,
  MarketSubscription,
} from './exchange'
import {
  cancelOrder as cancelClobOrder,
  createTradingClient,
  getOpenOrders,
  placeIntentOrder,
  type ApiCredentials,
  type ClobOrderOptions,
} from '@/lib/polymarket/trading'
import { PolymarketWsClient } from '@/lib/polymarket/ws'

export type PolymarketLiveAdapterOptions = {
  signer: Wallet | providers.JsonRpcSigner
  apiCreds: ApiCredentials
  funderAddress: string
  builderUrl?: string
  runtime?: RuntimeConfig
  marketWsUrl?: string
  userWsUrl?: string
}

function nowMs(): number {
  return Date.now()
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
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

export class PolymarketLiveAdapter implements ExchangeAdapter {
  readonly adapterId = 'polymarket-live'
  readonly mode = 'live-safe' as const

  private readonly runtime: RuntimeConfig
  private readonly listeners: ExchangeListeners = {}
  private readonly orderOptionCache = new Map<string, ClobOrderOptions>()
  private readonly trackedOrders = new Map<string, OrderUpdate>()
  private readonly client: ClobClient

  private subscriptions: MarketSubscription[] = []
  private registry = buildLiveMarketRegistry([])
  private reconcileTimer?: ReturnType<typeof setInterval>
  private marketWs?: PolymarketWsClient
  private userWs?: PolymarketWsClient
  private connectionState: ExchangeConnectionState = {
    status: 'disconnected',
    marketChannel: 'disconnected',
    userChannel: 'disconnected',
  }

  constructor(private readonly options: PolymarketLiveAdapterOptions) {
    this.runtime = options.runtime ?? getApprovedRuntimeConfig()
    this.client = createTradingClient(options.signer, options.apiCreds, {
      funderAddress: options.funderAddress,
      builderUrl: options.builderUrl,
      useServerTime: true,
    })
  }

  async connect(listeners?: ExchangeListeners): Promise<void> {
    Object.assign(this.listeners, listeners)
    this.updateConnectionState('connecting')

    this.marketWs = new PolymarketWsClient({
      channel: 'market',
      url: this.options.marketWsUrl,
      reconnectBackoffMs: this.runtime.live.reconnectBackoffMs,
      maxReconnectBackoffMs: this.runtime.live.maxReconnectBackoffMs,
      staleAfterMs: this.runtime.live.staleAfterMs,
      onMessage: (message) => {
        const events = polymarketMessageToMarketEvents(message, this.registry, nowMs())
        for (const event of events) {
          this.connectionState.lastMessageAt = event.tsLocal
          this.listeners.onMarketEvent?.(event)
        }
      },
      onStatusChange: (status, reason) => {
        this.updateChannelState('market', status, reason)
      },
      onError: (error) => this.listeners.onError?.(error),
    })

    this.userWs = new PolymarketWsClient({
      channel: 'user',
      url: this.options.userWsUrl,
      credentials: this.options.apiCreds,
      reconnectBackoffMs: this.runtime.live.reconnectBackoffMs,
      maxReconnectBackoffMs: this.runtime.live.maxReconnectBackoffMs,
      staleAfterMs: this.runtime.live.staleAfterMs,
      onMessage: (message) => {
        const updates = polymarketMessageToOrderUpdates(message, this.registry, this.trackedOrders, nowMs())
        for (const update of updates) {
          this.emitTrackedUpdate(update)
        }
      },
      onStatusChange: (status, reason) => {
        this.updateChannelState('user', status, reason)
      },
      onError: (error) => this.listeners.onError?.(error),
    })

    await this.bootstrapSnapshots()
    const subscription = this.currentWsSubscription()
    await Promise.all([this.marketWs.connect(subscription), this.userWs.connect(subscription)])
    this.startReconcileLoop()
  }

  async disconnect(): Promise<void> {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    this.reconcileTimer = undefined
    await Promise.all([this.marketWs?.disconnect(), this.userWs?.disconnect()])
    this.marketWs = undefined
    this.userWs = undefined
    this.updateConnectionState('disconnected')
  }

  async subscribeMarkets(subscriptions: MarketSubscription[]): Promise<void> {
    this.subscriptions = subscriptions
    this.registry = buildLiveMarketRegistry(subscriptions)
    const subscription = this.currentWsSubscription()
    await Promise.all([
      this.marketWs?.updateSubscription(subscription),
      this.userWs?.updateSubscription(subscription),
    ])
  }

  async placeOrder(intent: OrderIntent): Promise<OrderUpdate> {
    const response = await placeIntentOrder(this.client, intent, await this.resolveOrderOptions(intent.tokenId))
    const ts = nowMs()
    const rawStatus = typeof response?.status === 'string' ? response.status.toLowerCase() : undefined
    const rejected = response?.success === false || rawStatus?.includes('reject')

    const update: OrderUpdate = {
      orderId: response?.orderID || intent.clientOrderId || intent.intentId,
      exchangeOrderId: response?.orderID,
      clientOrderId: intent.clientOrderId ?? intent.intentId,
      intentId: intent.intentId,
      opportunityId: intent.opportunityId,
      legId: intent.legId,
      marketId: intent.marketId,
      tokenId: intent.tokenId,
      outcome: intent.outcome,
      action: intent.action,
      status: rejected ? 'rejected' : 'accepted',
      filledSize: 0,
      remainingSize: intent.size,
      reason: rejected ? response?.errorMsg || rawStatus : undefined,
      sourceStatus: rawStatus,
      source: 'submit',
      ts,
      tsExchange: ts,
      tsLocal: ts,
      raw: response,
    }

    this.emitTrackedUpdate(update)
    return update
  }

  async cancelOrder(orderId: string, reason = 'USER_CANCEL'): Promise<OrderUpdate> {
    const tracked = this.trackedOrders.get(orderId)
    const response = await cancelClobOrder(this.client, orderId)
    const ts = nowMs()
    const update: OrderUpdate = {
      orderId,
      exchangeOrderId: orderId,
      clientOrderId: tracked?.clientOrderId,
      intentId: tracked?.intentId ?? orderId,
      opportunityId: tracked?.opportunityId ?? orderId,
      legId: tracked?.legId ?? 'live',
      marketId: tracked?.marketId ?? 'unknown',
      tokenId: tracked?.tokenId ?? 'unknown',
      outcome: tracked?.outcome,
      action: tracked?.action,
      status: 'canceled',
      filledSize: tracked?.filledSize ?? 0,
      remainingSize: tracked?.remainingSize ?? 0,
      avgPrice: tracked?.avgPrice,
      reason,
      sourceStatus: typeof response?.status === 'string' ? response.status.toLowerCase() : 'canceled',
      source: 'cancel',
      ts,
      tsExchange: ts,
      tsLocal: ts,
      raw: response,
    }

    this.emitTrackedUpdate(update)
    return update
  }

  async syncOpenOrders(): Promise<OrderUpdate[]> {
    const openOrders = await getOpenOrders(this.client)
    return openOrders.map((order) => this.mapOpenOrder(order))
  }

  getConnectionState(): ExchangeConnectionState {
    return { ...this.connectionState }
  }

  private async bootstrapSnapshots(): Promise<void> {
    const tokenIds = this.subscriptions.flatMap((subscription) => [
      subscription.tokenMap.yesTokenId,
      subscription.tokenMap.noTokenId,
    ])

    const summaries = await Promise.all(tokenIds.map((tokenId) => this.client.getOrderBook(tokenId)))
    for (const summary of summaries) {
      const event = orderBookSummaryToSnapshotEvent(summary, this.registry, nowMs())
      if (event) {
        this.listeners.onMarketEvent?.(event)
      }
    }
  }

  private currentWsSubscription() {
    return {
      marketIds: this.subscriptions.map((subscription) => subscription.marketId),
      tokenIds: this.subscriptions.flatMap((subscription) => [
        subscription.tokenMap.yesTokenId,
        subscription.tokenMap.noTokenId,
      ]),
    }
  }

  private async resolveOrderOptions(tokenId: string): Promise<ClobOrderOptions> {
    const cached = this.orderOptionCache.get(tokenId)
    if (cached) return cached

    const [tickSize, negRisk, feeRateBps] = await Promise.all([
      this.client.getTickSize(tokenId),
      this.client.getNegRisk(tokenId),
      this.client.getFeeRateBps(tokenId),
    ])

    const resolved = { tickSize, negRisk, feeRateBps }
    this.orderOptionCache.set(tokenId, resolved)
    return resolved
  }

  private emitTrackedUpdate(update: OrderUpdate): void {
    const previous = this.trackedOrders.get(update.orderId)
    if (!isDifferentUpdate(previous, update)) return
    this.trackedOrders.set(update.orderId, update)
    this.connectionState.lastMessageAt = update.tsLocal ?? update.ts
    this.listeners.onOrderUpdate?.(update)
  }

  private mapOpenOrder(order: OpenOrder): OrderUpdate {
    const tracked = this.trackedOrders.get(order.id)
    const tokenInfo = this.registry.byTokenId[order.asset_id]
    const filledSize = Math.max(0, toNumber(order.size_matched) ?? tracked?.filledSize ?? 0)
    const originalSize = Math.max(0, toNumber(order.original_size) ?? filledSize + (tracked?.remainingSize ?? 0))
    const remainingSize = Math.max(0, originalSize - filledSize)

    return {
      orderId: order.id,
      exchangeOrderId: order.id,
      clientOrderId: tracked?.clientOrderId,
      intentId: tracked?.intentId ?? order.id,
      opportunityId: tracked?.opportunityId ?? order.id,
      legId: tracked?.legId ?? 'live',
      marketId: tokenInfo?.marketId ?? tracked?.marketId ?? order.market,
      tokenId: order.asset_id,
      outcome: tokenInfo?.outcome ?? tracked?.outcome,
      action: tracked?.action,
      status: filledSize > 0 ? 'partial_fill' : 'accepted',
      filledSize,
      remainingSize,
      avgPrice: toNumber(order.price) ?? tracked?.avgPrice,
      sourceStatus: order.status?.toLowerCase(),
      source: 'rest-sync',
      ts: order.created_at,
      tsExchange: order.created_at,
      tsLocal: nowMs(),
      raw: order,
    }
  }

  private startReconcileLoop(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    this.reconcileTimer = setInterval(() => {
      void this.syncOpenOrders()
        .then((updates) => {
          for (const update of updates) {
            this.emitTrackedUpdate(update)
          }
        })
        .catch((error) => {
          this.listeners.onError?.(error instanceof Error ? error : new Error(String(error)))
        })
    }, this.runtime.live.orderSyncIntervalMs)
  }

  private updateChannelState(channel: 'marketChannel' | 'userChannel' | 'market' | 'user', status: ExchangeConnectionStatus, reason?: string): void {
    if (channel === 'market' || channel === 'marketChannel') {
      this.connectionState.marketChannel = status
    } else {
      this.connectionState.userChannel = status
    }

    const states = [this.connectionState.marketChannel, this.connectionState.userChannel]
    if (states.every((state) => state === 'connected')) {
      this.connectionState.status = 'connected'
    } else if (states.some((state) => state === 'error')) {
      this.connectionState.status = 'error'
    } else if (states.some((state) => state === 'reconnecting')) {
      this.connectionState.status = 'reconnecting'
    } else if (states.some((state) => state === 'connecting')) {
      this.connectionState.status = 'connecting'
    } else if (states.every((state) => state === 'disconnected')) {
      this.connectionState.status = 'disconnected'
    }

    this.connectionState.reason = reason
    this.listeners.onConnectionState?.({ ...this.connectionState })
  }

  private updateConnectionState(status: ExchangeConnectionStatus, reason?: string): void {
    this.connectionState = {
      ...this.connectionState,
      status,
      marketChannel: status,
      userChannel: status,
      reason,
    }
    this.listeners.onConnectionState?.({ ...this.connectionState })
  }
}
