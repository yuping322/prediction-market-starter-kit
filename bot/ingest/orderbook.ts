import type { MarketEvent } from '../contracts/types'

export type BookState = {
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
}

const DEFAULT_BOOK: BookState = {
  yesBid: 0.49,
  yesAsk: 0.5,
  noBid: 0.49,
  noAsk: 0.5,
}

export function applyBookEvent(current: BookState, event: MarketEvent): BookState {
  if (event.type !== 'book_update') return current
  const payload = event.payload
  return {
    yesBid: typeof payload.yesBid === 'number' ? payload.yesBid : current.yesBid,
    yesAsk: typeof payload.yesAsk === 'number' ? payload.yesAsk : current.yesAsk,
    noBid: typeof payload.noBid === 'number' ? payload.noBid : current.noBid,
    noAsk: typeof payload.noAsk === 'number' ? payload.noAsk : current.noAsk,
  }
}

export function getDefaultBookState(): BookState {
  return { ...DEFAULT_BOOK }
}
