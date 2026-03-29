import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'

export type EdgeOutput = {
  grossEdgeBps: number
  costBps: number
  evBps: number
  shouldTrade: boolean
}

export function computeEdge(
  book: { yesAsk: number; noAsk: number },
  config: RuntimeConfig = getRuntimeConfig(),
  additionalCostBps = 0,
): EdgeOutput {
  const grossEdgeBps = (1 - (book.yesAsk + book.noAsk)) * 10_000
  const costBps = config.strategies.staticArb.costBps + additionalCostBps
  const evBps = grossEdgeBps - costBps
  return {
    grossEdgeBps,
    costBps,
    evBps,
    shouldTrade: evBps > config.strategies.staticArb.minEvBps,
  }
}
