import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import type { FeatureSnapshot, Opportunity } from '../contracts/types'
import { getTopOfBook, type BookState } from '../ingest/orderbook'
import { computeBayesian } from './bayesian'
import { computeEdge } from './edge'

function clampPrice(value: number): number {
  return Math.max(0.01, Math.min(0.99, value))
}

export function generateOpportunity(
  feature: FeatureSnapshot,
  book: BookState,
  now: number,
  config: RuntimeConfig = getRuntimeConfig(),
): Opportunity | null {
  const bayesian = computeBayesian(feature, config)
  const top = getTopOfBook(book)
  const edge = computeEdge(top, config)

  if (!edge.shouldTrade) return null
  if (bayesian.enabled && bayesian.confidence < config.models.bayesian.minConfidence) return null

  const passiveOutcome = top.yesAsk <= top.noAsk ? 'yes' : 'no'
  const hedgeOutcome = passiveOutcome === 'yes' ? 'no' : 'yes'
  const passiveBase = passiveOutcome === 'yes' ? top.yesAsk : top.noAsk
  const hedgeBase = hedgeOutcome === 'yes' ? top.yesAsk : top.noAsk
  const priceOffset = config.execution.passivePriceOffset

  return {
    id: `${feature.marketId}-${now}`,
    strategy: 'static_arb',
    marketId: feature.marketId,
    tokenMap: feature.tokenMap,
    grossEdgeBps: edge.grossEdgeBps,
    costBps: edge.costBps,
    evBps: edge.evBps,
    confidence: bayesian.confidence,
    ttlMs: config.strategies.staticArb.ttlMs,
    createdAt: now,
    legs: [
      {
        legId: `${feature.marketId}-passive-${passiveOutcome}`,
        marketId: feature.marketId,
        tokenId: passiveOutcome === 'yes' ? feature.tokenMap.yesTokenId : feature.tokenMap.noTokenId,
        outcome: passiveOutcome,
        action: 'buy',
        targetPrice: clampPrice(passiveBase - priceOffset),
        referencePrice: passiveBase,
        maxSlippageBps: config.strategies.staticArb.maxSlippageBps,
        tif: 'GTC',
        postOnly: true,
      },
      {
        legId: `${feature.marketId}-hedge-${hedgeOutcome}`,
        marketId: feature.marketId,
        tokenId: hedgeOutcome === 'yes' ? feature.tokenMap.yesTokenId : feature.tokenMap.noTokenId,
        outcome: hedgeOutcome,
        action: 'buy',
        targetPrice: clampPrice(hedgeBase),
        referencePrice: hedgeBase,
        maxSlippageBps: config.strategies.staticArb.maxSlippageBps,
        tif: 'IOC',
        postOnly: false,
      },
    ],
  }
}
