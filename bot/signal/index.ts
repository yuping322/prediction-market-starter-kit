import type { Opportunity } from '../contracts/types'
import type { BookState } from '../ingest/orderbook'
import { computeBayesian } from './bayesian'
import { computeEdge } from './edge'
import type { FeatureSnapshot } from '../contracts/types'

export function generateOpportunity(
  feature: FeatureSnapshot,
  book: BookState,
  now: number,
  costBps = 20,
  minEvBps = 5,
): Opportunity | null {
  const bayesian = computeBayesian(feature)
  const edge = computeEdge(book, costBps, minEvBps)

  if (!edge.shouldTrade) return null
  if (bayesian.confidence < 0.1) return null

  return {
    id: `${feature.marketId}-${now}`,
    strategy: 'static_arb',
    marketIds: [feature.marketId],
    evBps: edge.evBps,
    confidence: bayesian.confidence,
    ttlMs: 3_000,
    createdAt: now,
  }
}
