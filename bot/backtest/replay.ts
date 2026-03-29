import type { MarketEvent } from '../contracts/types'
import type { SyntheticTick } from '../ingest/adapter'

export function replayTicks(ticks: SyntheticTick[]): SyntheticTick[] {
  return [...ticks].sort((left, right) => left.ts - right.ts)
}

export function replayEvents(events: MarketEvent[]): MarketEvent[] {
  return [...events].sort((left, right) => left.tsExchange - right.tsExchange || left.sequence - right.sequence)
}
