import type { FeatureSnapshot } from '../contracts/types'

export function shouldEnterBySpread(feature: FeatureSnapshot, zThreshold: number): boolean {
  const z = feature.spreadZScore ?? 0
  return Math.abs(z) >= zThreshold
}
