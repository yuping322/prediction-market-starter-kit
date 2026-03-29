import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'

export function stoikovPriceAdjust(
  basePrice: number,
  inventory: number,
  volatility1s = 0,
  config: RuntimeConfig = getRuntimeConfig(),
): number {
  const penalty =
    inventory * config.models.stoikov.riskAversion * config.models.stoikov.inventoryWeight +
    volatility1s * config.models.stoikov.volatilityWeight
  return Math.max(0.01, Math.min(0.99, basePrice - penalty))
}
