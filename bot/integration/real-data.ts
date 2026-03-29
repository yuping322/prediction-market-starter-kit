import { getEvents, type Market } from '@/lib/gamma'
import { parsePrices } from '@/lib/prices'
import fallbackEvents from '../fixtures/gamma-events.snapshot.json'
import type { MarketTokenMap } from '../contracts/types'
import type { SyntheticTick } from '../ingest/adapter'
import { buildTokenMap, type ValidationMarketDescriptor } from './exchange'

function clampPrice(value: number): number {
  return Math.max(0.01, Math.min(0.99, value))
}

function resolveTokenMap(market: Market): MarketTokenMap {
  const yesToken = market.tokens?.find((token) => token.outcome.toLowerCase() === 'yes')?.token_id
  const noToken = market.tokens?.find((token) => token.outcome.toLowerCase() === 'no')?.token_id
  return buildTokenMap(market.id, yesToken, noToken)
}

async function loadEvents(limit: number) {
  try {
    return await getEvents({ active: true, closed: false, archived: false, limit })
  } catch {
    return fallbackEvents as Awaited<ReturnType<typeof getEvents>>
  }
}

export async function fetchValidationMarkets(limit = 50): Promise<ValidationMarketDescriptor[]> {
  const events = await loadEvents(limit)
  const markets: ValidationMarketDescriptor[] = []

  for (const event of events) {
    for (const market of event.markets ?? []) {
      const [yes, no] = parsePrices(market)
      if (yes <= 0 || no <= 0) continue
      markets.push({
        marketId: market.id,
        question: market.question,
        tokenMap: resolveTokenMap(market),
        liquidity: market.liquidity || 0,
        volume24h: market.volume_24hr || market.volume || 0,
        yesPrice: yes,
        noPrice: no,
      })
    }
  }

  return markets
}

export async function fetchRealTicks(limit = 50): Promise<SyntheticTick[]> {
  const markets = await fetchValidationMarkets(limit)
  return markets.map((market, index) => ({
    ts: index + 1,
    marketId: market.marketId,
    yesBid: clampPrice(market.yesPrice - 0.01),
    yesAsk: clampPrice(market.yesPrice + 0.01),
    noBid: clampPrice(market.noPrice - 0.01),
    noAsk: clampPrice(market.noPrice + 0.01),
    volume: Math.max(1, market.volume24h || 1),
    tokenMap: market.tokenMap,
    source: 'gamma-validation',
  }))
}
