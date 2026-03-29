import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'

export function kellySize(
  evBps: number,
  confidence: number,
  equity: number,
  config: RuntimeConfig = getRuntimeConfig(),
  riskScale = 1,
): number {
  const edge = Math.max(0, evBps / 10_000)
  const fraction = Math.min(
    config.models.kelly.maxFraction,
    Math.max(config.models.kelly.minFraction, edge * confidence * config.models.kelly.confidenceScale * riskScale),
  )
  return equity * fraction
}
