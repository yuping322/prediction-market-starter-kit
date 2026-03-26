import type { FeatureSnapshot } from '../contracts/types'

export type BayesianOutput = {
  pUp: number
  pDown: number
  confidence: number
}

export function computeBayesian(feature: FeatureSnapshot): BayesianOutput {
  const raw = 0.5 + feature.imbalanceL1 * 0.3 + (feature.spreadZScore ?? 0) * -0.05
  const pUp = Math.min(0.99, Math.max(0.01, raw))
  return {
    pUp,
    pDown: 1 - pUp,
    confidence: Math.abs(pUp - 0.5) * 2,
  }
}
