import type { MarketEvent, SnapshotEvent } from '../contracts/types'

export type RecoveryResult = {
  recoveredEvents: MarketEvent[]
  hasGap: boolean
  nextSequence: number
}

export function recoverFromSnapshot(snapshot: SnapshotEvent, recentEvents: MarketEvent[]): RecoveryResult {
  const ordered = recentEvents
    .filter((event) => event.marketId === snapshot.marketId && event.sequence > snapshot.sequence)
    .sort((left, right) => left.sequence - right.sequence)

  let expectedSequence = snapshot.sequence + 1
  let hasGap = false
  const recoveredEvents: MarketEvent[] = []

  for (const event of ordered) {
    if (event.sequence > expectedSequence) {
      hasGap = true
      break
    }
    if (event.sequence < expectedSequence) continue
    recoveredEvents.push(event)
    expectedSequence = event.sequence + 1
  }

  return {
    recoveredEvents,
    hasGap,
    nextSequence: expectedSequence,
  }
}
