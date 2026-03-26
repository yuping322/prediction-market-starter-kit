export function stoikovPriceAdjust(basePrice: number, inventory: number, riskAversion = 0.002): number {
  return Math.max(0.01, Math.min(0.99, basePrice - inventory * riskAversion))
}
