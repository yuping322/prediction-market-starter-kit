import type { BookSideSnapshot, MarketEvent, MarketTokenMap } from '../contracts/types'
import { buildTokenMap } from '../integration/exchange'

export type BookState = {
  marketId: string
  tokenMap: MarketTokenMap
  sequence: number
  updatedAt: number
  yes: BookSideSnapshot
  no: BookSideSnapshot
}

export type BookStore = Record<string, BookState>

const DEFAULT_SIDE: BookSideSnapshot = {
  bids: [{ price: 0.49, size: 100 }],
  asks: [{ price: 0.5, size: 100 }],
}

const EMPTY_SIDE: BookSideSnapshot = {
  bids: [],
  asks: [],
}

function cloneSide(side: BookSideSnapshot): BookSideSnapshot {
  return {
    bids: side.bids.map((level) => ({ ...level })),
    asks: side.asks.map((level) => ({ ...level })),
  }
}

function normalizeSide(side?: BookSideSnapshot): BookSideSnapshot {
  if (!side) return cloneSide(EMPTY_SIDE)
  return {
    bids: [...side.bids].sort((left, right) => right.price - left.price),
    asks: [...side.asks].sort((left, right) => left.price - right.price),
  }
}

export function createBookState(marketId = 'default', tokenMap = buildTokenMap(marketId), seedDefaults = true): BookState {
  return {
    marketId,
    tokenMap,
    sequence: 0,
    updatedAt: 0,
    yes: seedDefaults ? cloneSide(DEFAULT_SIDE) : cloneSide(EMPTY_SIDE),
    no: seedDefaults ? cloneSide(DEFAULT_SIDE) : cloneSide(EMPTY_SIDE),
  }
}

export function getDefaultBookState(): BookState {
  return createBookState('default')
}

export function applyBookEvent(current: BookState, event: MarketEvent): BookState {
  if (event.type !== 'snapshot' && event.type !== 'book_update') return current
  if (event.sequence < current.sequence) return current

  return {
    ...current,
    marketId: event.marketId,
    sequence: event.sequence,
    updatedAt: event.tsLocal,
    yes: event.payload.yes ? normalizeSide(event.payload.yes) : current.yes,
    no: event.payload.no ? normalizeSide(event.payload.no) : current.no,
  }
}

export function applyEventToBooks(books: BookStore, event: MarketEvent, tokenMap?: MarketTokenMap): BookStore {
  const current = books[event.marketId] ?? createBookState(event.marketId, tokenMap ?? buildTokenMap(event.marketId), false)
  return {
    ...books,
    [event.marketId]: applyBookEvent(current, event),
  }
}

export function getTopOfBook(book: BookState): {
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  totalAskNotional: number
} {
  const yesBid = book.yes.bids[0]?.price ?? 0
  const yesAsk = book.yes.asks[0]?.price ?? 1
  const noBid = book.no.bids[0]?.price ?? 0
  const noAsk = book.no.asks[0]?.price ?? 1
  const totalAskNotional = yesAsk + noAsk
  return { yesBid, yesAsk, noBid, noAsk, totalAskNotional }
}
