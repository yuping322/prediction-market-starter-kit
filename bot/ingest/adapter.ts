import type { BookSideSnapshot, MarketEvent, MarketTokenMap, OrderStatus, OrderUpdate, Outcome, TradePrintEvent } from '../contracts/types'
import { buildTokenMap, type MarketSubscription } from '../integration/exchange'

export type SyntheticTick = {
  ts: number
  marketId: string
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  volume: number
  tokenMap?: MarketTokenMap
  source?: 'synthetic' | 'gamma-validation'
}

export type LiveMarketRegistryEntry = MarketSubscription

export type LiveMarketRegistry = {
  byMarketId: Record<string, MarketTokenMap>
  byTokenId: Record<string, { marketId: string; outcome: Outcome; tokenMap: MarketTokenMap }>
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function lower(value: unknown): string | undefined {
  return asString(value)?.toLowerCase()
}

function getSequence(value: unknown, fallback: number): number {
  return Math.max(1, Math.round(asNumber(value) ?? fallback))
}

function pick(record: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

function clampPrice(value: number): number {
  return Math.max(0.0001, Math.min(0.9999, value))
}

function normalizeSide(levels: unknown, bidSide: boolean): { price: number; size: number }[] {
  if (!Array.isArray(levels)) return []

  const normalized = levels
    .map((level) => {
      if (Array.isArray(level)) {
        const price = asNumber(level[0])
        const size = asNumber(level[1])
        if (price === undefined || size === undefined || size <= 0) return null
        return { price: clampPrice(price), size }
      }
      if (isRecord(level)) {
        const price = asNumber(pick(level, 'price', 'p', 'px'))
        const size = asNumber(pick(level, 'size', 's', 'quantity', 'qty'))
        if (price === undefined || size === undefined || size <= 0) return null
        return { price: clampPrice(price), size }
      }
      return null
    })
    .filter((level): level is { price: number; size: number } => level !== null)

  return normalized.sort((left, right) => (bidSide ? right.price - left.price : left.price - right.price))
}

export function bookSideFromRawLevels(raw: { bids?: unknown; asks?: unknown }): BookSideSnapshot {
  return {
    bids: normalizeSide(raw.bids, true),
    asks: normalizeSide(raw.asks, false),
  }
}

export function getTokenMap(marketId: string, tokenMap?: MarketTokenMap): MarketTokenMap {
  return tokenMap ?? buildTokenMap(marketId)
}

export function buildLiveMarketRegistry(entries: LiveMarketRegistryEntry[]): LiveMarketRegistry {
  const byMarketId: LiveMarketRegistry['byMarketId'] = {}
  const byTokenId: LiveMarketRegistry['byTokenId'] = {}

  for (const entry of entries) {
    byMarketId[entry.marketId] = entry.tokenMap
    byTokenId[entry.tokenMap.yesTokenId] = { marketId: entry.marketId, outcome: 'yes', tokenMap: entry.tokenMap }
    byTokenId[entry.tokenMap.noTokenId] = { marketId: entry.marketId, outcome: 'no', tokenMap: entry.tokenMap }
  }

  return { byMarketId, byTokenId }
}

function resolveTokenInfo(
  raw: UnknownRecord,
  registry: LiveMarketRegistry,
): { marketId: string; tokenId: string; outcome: Outcome; tokenMap: MarketTokenMap } | null {
  const tokenId = asString(pick(raw, 'asset_id', 'assetId', 'token_id', 'tokenId'))
  if (tokenId && registry.byTokenId[tokenId]) {
    return {
      marketId: registry.byTokenId[tokenId].marketId,
      tokenId,
      outcome: registry.byTokenId[tokenId].outcome,
      tokenMap: registry.byTokenId[tokenId].tokenMap,
    }
  }

  const marketId = asString(pick(raw, 'market', 'market_id', 'marketId', 'condition_id', 'conditionId'))
  if (marketId && registry.byMarketId[marketId]) {
    const tokenMap = registry.byMarketId[marketId]
    const outcome = lower(pick(raw, 'outcome', 'side')) === 'no' ? 'no' : 'yes'
    return {
      marketId,
      tokenId: outcome === 'yes' ? tokenMap.yesTokenId : tokenMap.noTokenId,
      outcome,
      tokenMap,
    }
  }

  return null
}

export function orderBookSummaryToSnapshotEvent(
  summary: unknown,
  registry: LiveMarketRegistry,
  tsLocal = Date.now(),
): MarketEvent | null {
  if (!isRecord(summary)) return null
  const resolved = resolveTokenInfo(summary, registry)
  if (!resolved) return null

  const side = bookSideFromRawLevels({
    bids: pick(summary, 'bids'),
    asks: pick(summary, 'asks'),
  })
  const tsExchange = asNumber(pick(summary, 'timestamp', 'ts')) ?? tsLocal
  const sequence = getSequence(pick(summary, 'timestamp', 'sequence', 'seq'), tsExchange)

  return {
    eventId: `${resolved.marketId}-${resolved.tokenId}-${sequence}-snapshot`,
    source: 'exchange',
    tsExchange,
    tsLocal,
    marketId: resolved.marketId,
    sequence,
    type: 'snapshot',
    payload: resolved.outcome === 'yes' ? { yes: side } : { no: side },
  }
}

function flattenMessages(message: unknown): unknown[] {
  if (Array.isArray(message)) return message.flatMap((entry) => flattenMessages(entry))
  if (isRecord(message) && Array.isArray(message.data)) return flattenMessages(message.data)
  return [message]
}

function rawBookToMarketEvent(raw: UnknownRecord, registry: LiveMarketRegistry, tsLocal: number): MarketEvent | null {
  const resolved = resolveTokenInfo(raw, registry)
  if (!resolved) return null

  const side = bookSideFromRawLevels({
    bids: pick(raw, 'bids'),
    asks: pick(raw, 'asks'),
  })
  if (side.bids.length === 0 && side.asks.length === 0) return null

  const tsExchange = asNumber(pick(raw, 'timestamp', 'ts', 'time')) ?? tsLocal
  const sequence = getSequence(pick(raw, 'sequence', 'seq', 'timestamp'), tsExchange)
  const eventType = lower(pick(raw, 'event_type', 'type')) === 'book' ? 'snapshot' : 'book_update'

  return {
    eventId: `${resolved.marketId}-${resolved.tokenId}-${sequence}-${eventType}`,
    source: 'exchange',
    tsExchange,
    tsLocal,
    marketId: resolved.marketId,
    sequence,
    type: eventType,
    payload: resolved.outcome === 'yes' ? { yes: side } : { no: side },
  }
}

function rawTradeToEvent(raw: UnknownRecord, registry: LiveMarketRegistry, tsLocal: number): TradePrintEvent | null {
  const resolved = resolveTokenInfo(raw, registry)
  if (!resolved) return null
  const price = asNumber(pick(raw, 'price', 'last_trade_price', 'p'))
  const size = asNumber(pick(raw, 'size', 'amount', 'matched_amount', 'qty'))
  if (price === undefined || size === undefined || size <= 0) return null

  const tsExchange = asNumber(pick(raw, 'timestamp', 'ts', 'match_time', 'last_update')) ?? tsLocal
  const sequence = getSequence(pick(raw, 'sequence', 'seq', 'timestamp'), tsExchange)

  return {
    eventId: `${resolved.marketId}-${resolved.tokenId}-${sequence}-trade`,
    source: 'exchange',
    tsExchange,
    tsLocal,
    marketId: resolved.marketId,
    sequence,
    type: 'trade_print',
    payload: {
      outcome: resolved.outcome,
      price: clampPrice(price),
      size,
    },
  }
}

export function polymarketMessageToMarketEvents(message: unknown, registry: LiveMarketRegistry, tsLocal = Date.now()): MarketEvent[] {
  const events: MarketEvent[] = []

  for (const entry of flattenMessages(message)) {
    if (!isRecord(entry)) continue
    const eventType = lower(pick(entry, 'event_type', 'type'))

    if (eventType === 'book' || eventType === 'snapshot' || eventType === 'book_update' || ('bids' in entry && 'asks' in entry)) {
      const bookEvent = rawBookToMarketEvent(entry, registry, tsLocal)
      if (bookEvent) events.push(bookEvent)
      continue
    }

    if (eventType === 'trade' || eventType === 'trade_print' || eventType === 'last_trade_price') {
      const tradeEvent = rawTradeToEvent(entry, registry, tsLocal)
      if (tradeEvent) events.push(tradeEvent)
    }
  }

  return events
}

function mapRawOrderStatus(status: string | undefined, filledSize: number, remainingSize: number): OrderStatus | undefined {
  if (!status) {
    if (filledSize > 0 && remainingSize <= 0) return 'filled'
    if (filledSize > 0) return 'partial_fill'
    return undefined
  }

  if (status.includes('reject') || status.includes('fail') || status.includes('error')) return 'rejected'
  if (status.includes('cancel')) return 'canceled'
  if (status.includes('expire')) return 'expired'
  if (status.includes('fill') || status.includes('match') || status.includes('trade') || status.includes('exec')) {
    return remainingSize <= 0 ? 'filled' : 'partial_fill'
  }
  if (status.includes('open') || status.includes('live') || status.includes('accept') || status.includes('place')) return 'accepted'
  return undefined
}

function getFilledSize(raw: UnknownRecord, tracked?: OrderUpdate): number {
  const current =
    asNumber(
      pick(raw, 'filled_size', 'filledSize', 'matched_size', 'matchedSize', 'size_matched', 'sizeMatched', 'cum_filled_size'),
    ) ?? tracked?.filledSize
  return Math.max(0, current ?? 0)
}

function getRemainingSize(raw: UnknownRecord, tracked?: OrderUpdate, filledSize = 0): number {
  const explicit = asNumber(pick(raw, 'remaining_size', 'remainingSize', 'leaves_qty', 'rest_size'))
  if (explicit !== undefined) return Math.max(0, explicit)

  const original =
    asNumber(pick(raw, 'original_size', 'size', 'order_size', 'quantity', 'qty')) ??
    ((tracked?.filledSize ?? 0) + (tracked?.remainingSize ?? 0))

  return Math.max(0, original - filledSize)
}

export function polymarketMessageToOrderUpdates(
  message: unknown,
  registry: LiveMarketRegistry,
  trackedOrders = new Map<string, OrderUpdate>(),
  tsLocal = Date.now(),
): OrderUpdate[] {
  const updates: OrderUpdate[] = []

  for (const entry of flattenMessages(message)) {
    if (!isRecord(entry)) continue
    const payload = isRecord(entry.payload) ? { ...entry, ...entry.payload } : entry
    const orderId = asString(pick(payload, 'order_id', 'orderID', 'id', 'hash'))
    if (!orderId) continue

    const tracked = trackedOrders.get(orderId)
    const resolved = resolveTokenInfo(payload, registry)
    const clientOrderId = asString(pick(payload, 'client_order_id', 'clientOrderId')) ?? tracked?.clientOrderId
    const filledSize = getFilledSize(payload, tracked)
    const remainingSize = getRemainingSize(payload, tracked, filledSize)
    const rawStatus = lower(pick(payload, 'status', 'event_type', 'type', 'state'))
    const status = mapRawOrderStatus(rawStatus, filledSize, remainingSize)
    if (!status) continue

    const lastFilledSizeRaw = asNumber(pick(payload, 'last_fill_size', 'lastFilledSize', 'match_size'))
    const lastFilledSize = lastFilledSizeRaw ?? Math.max(0, filledSize - (tracked?.filledSize ?? 0))
    const price = asNumber(pick(payload, 'price', 'avg_price', 'avgPrice', 'match_price', 'fill_price'))
    const tsExchange = asNumber(pick(payload, 'timestamp', 'ts', 'created_at', 'last_update', 'match_time')) ?? tsLocal

    updates.push({
      orderId,
      exchangeOrderId: orderId,
      clientOrderId,
      intentId: tracked?.intentId ?? clientOrderId ?? orderId,
      opportunityId: tracked?.opportunityId ?? clientOrderId ?? orderId,
      legId: tracked?.legId ?? 'live',
      marketId: resolved?.marketId ?? tracked?.marketId ?? asString(pick(payload, 'market', 'market_id')) ?? 'unknown',
      tokenId: resolved?.tokenId ?? tracked?.tokenId ?? asString(pick(payload, 'asset_id', 'assetId')) ?? 'unknown',
      outcome: resolved?.outcome ?? tracked?.outcome,
      action: tracked?.action,
      status,
      filledSize,
      remainingSize,
      lastFilledSize,
      lastFilledPrice: price,
      avgPrice: price ?? tracked?.avgPrice,
      fee: asNumber(pick(payload, 'fee', 'fee_paid', 'feePaid')),
      reason: asString(pick(payload, 'reason', 'error', 'errorMsg')),
      sourceStatus: rawStatus,
      source: 'user-stream',
      ts: tsLocal,
      tsExchange,
      tsLocal,
      raw: entry,
    })
  }

  return updates
}

export function tickToMarketEvents(tick: SyntheticTick): MarketEvent[] {
  const sequenceBase = Math.max(1, tick.ts * 10)
  const source = tick.source ?? 'synthetic'
  const bookEvent: MarketEvent = {
    eventId: `${tick.marketId}-${tick.ts}-book`,
    source,
    tsExchange: tick.ts,
    tsLocal: tick.ts,
    marketId: tick.marketId,
    sequence: sequenceBase,
    type: 'book_update',
    payload: {
      yes: {
        bids: [{ price: tick.yesBid, size: Math.max(1, tick.volume / 2) }],
        asks: [{ price: tick.yesAsk, size: Math.max(1, tick.volume / 2) }],
      },
      no: {
        bids: [{ price: tick.noBid, size: Math.max(1, tick.volume / 2) }],
        asks: [{ price: tick.noAsk, size: Math.max(1, tick.volume / 2) }],
      },
    },
  }

  const tradeEvents: TradePrintEvent[] = [
    {
      eventId: `${tick.marketId}-${tick.ts}-yes-trade`,
      source,
      tsExchange: tick.ts,
      tsLocal: tick.ts,
      marketId: tick.marketId,
      sequence: sequenceBase + 1,
      type: 'trade_print',
      payload: {
        outcome: 'yes',
        price: (tick.yesBid + tick.yesAsk) / 2,
        size: Math.max(1, tick.volume / 2),
      },
    },
    {
      eventId: `${tick.marketId}-${tick.ts}-no-trade`,
      source,
      tsExchange: tick.ts,
      tsLocal: tick.ts,
      marketId: tick.marketId,
      sequence: sequenceBase + 2,
      type: 'trade_print',
      payload: {
        outcome: 'no',
        price: (tick.noBid + tick.noAsk) / 2,
        size: Math.max(1, tick.volume / 2),
      },
    },
  ]

  return [bookEvent, ...tradeEvents]
}
