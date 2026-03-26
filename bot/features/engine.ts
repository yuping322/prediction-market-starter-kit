import type { FeatureSnapshot, MarketEvent } from '../contracts/types'
import { rollingMean, rollingStd } from './windows'
import type { BookState } from '../ingest/orderbook'

export class FeatureEngine {
  private spreadHistory: number[] = []

  build(marketId: string, ts: number, book: BookState, events: MarketEvent[]): FeatureSnapshot {
    const tradeVolume = events
      .filter((evt) => evt.type === 'trade_print' && evt.marketId === marketId)
      .reduce((acc, evt) => acc + (typeof evt.payload.volume === 'number' ? evt.payload.volume : 0), 0)

    const yesMid = (book.yesBid + book.yesAsk) / 2
    const noMid = (book.noBid + book.noAsk) / 2
    const syntheticSpread = yesMid + noMid - 1

    this.spreadHistory.push(syntheticSpread)
    const mean = rollingMean(this.spreadHistory, 50)
    const std = rollingStd(this.spreadHistory, 50)
    const z = std > 0 ? (syntheticSpread - mean) / std : 0

    return {
      marketId,
      ts,
      imbalanceL1: (book.yesBid - book.noBid) / Math.max(0.0001, book.yesBid + book.noBid),
      imbalanceL5: tradeVolume / Math.max(1, events.length),
      microPrice: (book.yesAsk + book.noAsk) / 2,
      spreadZScore: z,
      volatility1s: std,
    }
  }
}
