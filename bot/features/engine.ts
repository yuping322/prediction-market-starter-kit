import type { FeatureSnapshot, MarketEvent } from '../contracts/types'
import { getTopOfBook, type BookState } from '../ingest/orderbook'
import { pushRollingValue, rollingMean, rollingStd } from './windows'

function sumTradeVolume(events: MarketEvent[], marketId: string, outcome: 'yes' | 'no'): number {
  return events.reduce((acc, event) => {
    if (event.marketId !== marketId || event.type !== 'trade_print' || event.payload.outcome !== outcome) {
      return acc
    }
    return acc + event.payload.size
  }, 0)
}

export class FeatureEngine {
  private spreadHistory = new Map<string, number[]>()

  build(marketId: string, ts: number, book: BookState, events: MarketEvent[]): FeatureSnapshot {
    const top = getTopOfBook(book)
    const history = this.spreadHistory.get(marketId) ?? []
    const syntheticEdge = 1 - top.totalAskNotional
    const nextHistory = pushRollingValue(history, syntheticEdge, 120)
    this.spreadHistory.set(marketId, nextHistory)

    const mean = rollingMean(nextHistory, 50)
    const std = rollingStd(nextHistory, 50)
    const spreadZScore = std > 0 ? (syntheticEdge - mean) / std : 0

    const yesVolume = sumTradeVolume(events, marketId, 'yes')
    const noVolume = sumTradeVolume(events, marketId, 'no')
    const topBidSize = (book.yes.bids[0]?.size ?? 0) + (book.no.bids[0]?.size ?? 0)
    const topAskSize = (book.yes.asks[0]?.size ?? 0) + (book.no.asks[0]?.size ?? 0)
    const totalTradeVolume = yesVolume + noVolume
    const totalDisplayed = Math.max(1, topBidSize + topAskSize)

    return {
      marketId,
      ts,
      tokenMap: book.tokenMap,
      imbalanceL1: ((book.yes.bids[0]?.size ?? 0) - (book.no.bids[0]?.size ?? 0)) / Math.max(1, topBidSize),
      imbalanceL5: (yesVolume - noVolume) / Math.max(1, totalTradeVolume),
      microPrice: (top.yesAsk + top.noAsk) / 2,
      spreadZScore,
      volatility1s: std,
      yesMid: (top.yesBid + top.yesAsk) / 2,
      noMid: (top.noBid + top.noAsk) / 2,
      syntheticEdge: syntheticEdge * Math.min(1, totalDisplayed / Math.max(1, totalTradeVolume || totalDisplayed)),
    }
  }
}
