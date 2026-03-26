import type { MarketEvent } from '../contracts/types'

export type SyntheticTick = {
  ts: number
  marketId: string
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  volume: number
}

export function tickToMarketEvents(tick: SyntheticTick): MarketEvent[] {
  return [
    {
      eventId: `${tick.marketId}-${tick.ts}-book`,
      tsExchange: tick.ts,
      tsLocal: tick.ts,
      marketId: tick.marketId,
      type: 'book_update',
      payload: {
        yesBid: tick.yesBid,
        yesAsk: tick.yesAsk,
        noBid: tick.noBid,
        noAsk: tick.noAsk,
      },
    },
    {
      eventId: `${tick.marketId}-${tick.ts}-trade`,
      tsExchange: tick.ts,
      tsLocal: tick.ts,
      marketId: tick.marketId,
      type: 'trade_print',
      payload: {
        volume: tick.volume,
      },
    },
  ]
}
