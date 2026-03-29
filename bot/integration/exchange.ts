import type { MarketEvent, MarketTokenMap, OrderIntent, OrderUpdate } from '../contracts/types'

export type ValidationMarketDescriptor = {
  marketId: string
  question: string
  tokenMap: MarketTokenMap
  liquidity: number
  volume24h: number
  yesPrice: number
  noPrice: number
}

export type MarketSubscription = {
  marketId: string
  tokenMap: MarketTokenMap
}

export type ExchangeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type ExchangeConnectionState = {
  status: ExchangeConnectionStatus
  marketChannel: ExchangeConnectionStatus
  userChannel: ExchangeConnectionStatus
  lastMessageAt?: number
  reason?: string
}

export type ExchangeListeners = {
  onMarketEvent?: (event: MarketEvent) => void
  onOrderUpdate?: (update: OrderUpdate) => void
  onConnectionState?: (state: ExchangeConnectionState) => void
  onError?: (error: Error) => void
}

export type ExchangeAdapter = {
  adapterId: string
  mode: 'paper' | 'live-safe'
  connect(listeners?: ExchangeListeners): Promise<void>
  disconnect(): Promise<void>
  subscribeMarkets(subscriptions: MarketSubscription[]): Promise<void>
  placeOrder(intent: OrderIntent): Promise<OrderUpdate>
  cancelOrder(orderId: string, reason?: string): Promise<OrderUpdate>
  syncOpenOrders(): Promise<OrderUpdate[]>
  getConnectionState(): ExchangeConnectionState
}

export function buildTokenMap(marketId: string, yesTokenId?: string, noTokenId?: string): MarketTokenMap {
  return {
    marketId,
    yesTokenId: yesTokenId || `${marketId}-YES`,
    noTokenId: noTokenId || `${marketId}-NO`,
  }
}

export function buildValidationSnapshotEvent(
  descriptor: ValidationMarketDescriptor,
  ts: number,
  sequence = ts,
): MarketEvent {
  return {
    eventId: `${descriptor.marketId}-${sequence}-snapshot`,
    source: 'gamma-validation',
    tsExchange: ts,
    tsLocal: ts,
    marketId: descriptor.marketId,
    sequence,
    type: 'snapshot',
    payload: {
      yes: {
        bids: [{ price: Math.max(0.01, descriptor.yesPrice - 0.01), size: Math.max(1, descriptor.volume24h / 1000) }],
        asks: [{ price: Math.min(0.99, descriptor.yesPrice + 0.01), size: Math.max(1, descriptor.volume24h / 1000) }],
      },
      no: {
        bids: [{ price: Math.max(0.01, descriptor.noPrice - 0.01), size: Math.max(1, descriptor.volume24h / 1000) }],
        asks: [{ price: Math.min(0.99, descriptor.noPrice + 0.01), size: Math.max(1, descriptor.volume24h / 1000) }],
      },
    },
  }
}
