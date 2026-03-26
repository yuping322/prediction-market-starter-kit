import type { MarketEvent } from '../contracts/types'

export function recoverFromSnapshot(snapshot: MarketEvent, recentEvents: MarketEvent[]): MarketEvent[] {
  if (snapshot.type !== 'snapshot') return recentEvents
  return recentEvents.filter((evt) => evt.tsExchange >= snapshot.tsExchange)
}
