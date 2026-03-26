import type { BookState } from '../ingest/orderbook'

export type EdgeOutput = {
  evBps: number
  shouldTrade: boolean
}

export function computeEdge(book: BookState, costBps: number, minEvBps: number): EdgeOutput {
  const gross = (1 - (book.yesAsk + book.noAsk)) * 10_000
  const evBps = gross - costBps
  return {
    evBps,
    shouldTrade: evBps > minEvBps,
  }
}
