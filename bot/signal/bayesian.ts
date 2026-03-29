import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import type { FeatureSnapshot } from '../contracts/types'

export type BayesianOutput = {
  pUp: number
  pDown: number
  confidence: number
  enabled: boolean
}

export function computeBayesian(
  feature: FeatureSnapshot,
  config: RuntimeConfig = getRuntimeConfig(),
): BayesianOutput {
  const enabled = config.modeDefaults.confidenceFilterEnabled && config.models.bayesian.enabled
  const raw =
    0.5 +
    feature.imbalanceL1 * config.models.bayesian.imbalanceWeight +
    feature.spreadZScore * config.models.bayesian.spreadWeight
  const pUp = Math.min(0.99, Math.max(0.01, raw))
  return {
    pUp,
    pDown: 1 - pUp,
    confidence: Math.abs(pUp - 0.5) * 2,
    enabled,
  }
}
