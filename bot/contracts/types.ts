export type MarketEvent = {
  eventId: string
  tsExchange: number
  tsLocal: number
  marketId: string
  type: 'book_update' | 'trade_print' | 'snapshot' | 'order_ack' | 'fill'
  payload: Record<string, unknown>
}

export type FeatureSnapshot = {
  marketId: string
  ts: number
  imbalanceL1: number
  imbalanceL5: number
  microPrice: number
  spreadZScore?: number
  volatility1s?: number
}

export type Opportunity = {
  id: string
  strategy: 'static_arb' | 'stat_arb' | 'microstructure'
  marketIds: string[]
  evBps: number
  confidence: number
  ttlMs: number
  createdAt: number
}

export type RiskDecision = {
  allow: boolean
  reason?: string
  maxSize?: number
  maxSlippageBps?: number
  killSwitch: boolean
}

export type OrderIntent = {
  opportunityId: string
  marketId: string
  side: 'buy' | 'sell'
  price: number
  size: number
  tif: 'GTC' | 'IOC' | 'FOK'
}

export type OrderUpdate = {
  orderId: string
  status: 'accepted' | 'partial_fill' | 'filled' | 'canceled' | 'rejected'
  filledSize: number
  avgPrice?: number
  ts: number
}
