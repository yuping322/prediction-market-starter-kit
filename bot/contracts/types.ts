export type EventSource = 'synthetic' | 'gamma-validation' | 'paper-execution' | 'exchange'
export type Outcome = 'yes' | 'no'
export type TradingAction = 'buy' | 'sell'
export type OrderTimeInForce = 'GTC' | 'IOC' | 'FOK'
export type ExecutionMode = 'simulation' | 'paper' | 'live-safe'
export type OpportunityStrategy = 'static_arb' | 'stat_arb' | 'microstructure'
export type ApprovalStatus = 'draft' | 'approved' | 'rejected'

export type PriceLevel = {
  price: number
  size: number
}

export type BookSideSnapshot = {
  bids: PriceLevel[]
  asks: PriceLevel[]
}

export type MarketTokenMap = {
  marketId: string
  yesTokenId: string
  noTokenId: string
}

export type BookPayload = {
  yes?: BookSideSnapshot
  no?: BookSideSnapshot
}

type MarketEventBase<TType extends string, TPayload> = {
  eventId: string
  source: EventSource
  tsExchange: number
  tsLocal: number
  marketId: string
  sequence: number
  type: TType
  payload: TPayload
}

export type SnapshotEvent = MarketEventBase<'snapshot', BookPayload>

export type BookUpdateEvent = MarketEventBase<'book_update', BookPayload>

export type TradePrintEvent = MarketEventBase<
  'trade_print',
  {
    outcome: Outcome
    price: number
    size: number
  }
>

export type OrderAckEvent = MarketEventBase<
  'order_ack',
  {
    orderId: string
    intentId: string
    legId: string
    status: 'accepted' | 'rejected'
    reason?: string
  }
>

export type FillEvent = MarketEventBase<
  'fill',
  {
    orderId: string
    intentId: string
    legId: string
    outcome: Outcome
    price: number
    size: number
    remainingSize: number
  }
>

export type OrderCanceledEvent = MarketEventBase<
  'order_canceled',
  {
    orderId: string
    intentId: string
    legId: string
    reason: string
  }
>

export type MarketEvent =
  | SnapshotEvent
  | BookUpdateEvent
  | TradePrintEvent
  | OrderAckEvent
  | FillEvent
  | OrderCanceledEvent

export type FeatureSnapshot = {
  marketId: string
  ts: number
  tokenMap: MarketTokenMap
  imbalanceL1: number
  imbalanceL5: number
  microPrice: number
  spreadZScore: number
  volatility1s: number
  yesMid: number
  noMid: number
  syntheticEdge: number
}

export type OpportunityLeg = {
  legId: string
  marketId: string
  tokenId: string
  outcome: Outcome
  action: TradingAction
  targetPrice: number
  referencePrice: number
  maxSlippageBps: number
  tif: OrderTimeInForce
  postOnly: boolean
}

export type Opportunity = {
  id: string
  strategy: OpportunityStrategy
  marketId: string
  tokenMap: MarketTokenMap
  grossEdgeBps: number
  costBps: number
  evBps: number
  confidence: number
  ttlMs: number
  createdAt: number
  legs: [OpportunityLeg, OpportunityLeg]
}

export type RiskRejectReason =
  | 'MAX_OPEN_NOTIONAL'
  | 'NON_POSITIVE_EV'
  | 'MAX_DRAWDOWN'
  | 'ONLY_REDUCE'
  | 'LATENCY_GUARD'
  | 'KILL_SWITCH'
  | 'FAIL_COUNT'
  | 'INSUFFICIENT_DEPTH'

export type RiskDecision = {
  allow: boolean
  reason?: RiskRejectReason
  approvedSize: number
  maxSize: number
  maxSlippageBps: number
  killSwitch: boolean
  onlyReduce: boolean
  notes: string[]
}

export type RiskState = {
  equity: number
  peakEquity: number
  intradayPnl: number
  drawdownPct: number
  openNotional: number
  pendingNotional: number
  failCount: number
  lastLatencyMs: number
  killSwitchEnabled: boolean
  onlyReduce: boolean
  maxOpenNotional: number
  maxDrawdownPct: number
  maxDailyLossPct: number
}

export type OrderIntent = {
  intentId: string
  opportunityId: string
  legId: string
  marketId: string
  tokenId: string
  outcome: Outcome
  action: TradingAction
  limitPrice: number
  size: number
  tif: OrderTimeInForce
  postOnly: boolean
  reduceOnly: boolean
  expiresAt: number
  clientOrderId?: string
}

export type OrderStatus =
  | 'accepted'
  | 'partial_fill'
  | 'filled'
  | 'canceled'
  | 'rejected'
  | 'expired'

export type OrderUpdateSource = 'simulation' | 'submit' | 'user-stream' | 'rest-sync' | 'cancel'

export type OrderUpdate = {
  orderId: string
  exchangeOrderId?: string
  clientOrderId?: string
  intentId: string
  opportunityId: string
  legId: string
  marketId: string
  tokenId: string
  outcome?: Outcome
  action?: TradingAction
  status: OrderStatus
  filledSize: number
  remainingSize: number
  lastFilledSize?: number
  lastFilledPrice?: number
  avgPrice?: number
  fee?: number
  reason?: string
  sourceStatus?: string
  source?: OrderUpdateSource
  ts: number
  tsExchange?: number
  tsLocal?: number
  raw?: unknown
}

export type ExecutionPlan = {
  opportunityId: string
  createdAt: number
  ttlMs: number
  approvedSize: number
  passiveLeg: OrderIntent
  hedgeLeg: OrderIntent
}

export type MetricEvent = {
  opportunityId: string
  marketId: string
  stage: 'opportunity' | 'risk_reject' | 'execution' | 'fill' | 'kill_switch'
  ts: number
  latencyMs?: number
  slippageBps?: number
  reason?: string
  completion?: number
  pnl?: number
}

export type ExecutionResult = {
  plan: ExecutionPlan
  intents: OrderIntent[]
  updates: OrderUpdate[]
  metrics: MetricEvent[]
  pnl: number
  realizedNotional: number
  completed: boolean
  hedgeUsed: boolean
}
