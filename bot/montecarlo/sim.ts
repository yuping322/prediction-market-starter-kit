import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'

function nextSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) % 4294967296
}

export function monteCarloPnl(
  basePnl: number,
  runs = getRuntimeConfig().models.monteCarlo.runs,
  config: RuntimeConfig = getRuntimeConfig(),
): { mean: number; p05: number } {
  const results: number[] = []
  let seed = 42

  for (let index = 0; index < runs; index += 1) {
    seed = nextSeed(seed)
    const uniform = seed / 4294967296
    const slippageShock = 1 - (uniform - 0.5) * (config.models.monteCarlo.slippageShockBps / 100)
    const latencyShock = 1 - (uniform - 0.5) * (config.models.monteCarlo.latencyShockMs / 1000)
    results.push(basePnl * slippageShock * latencyShock)
  }

  results.sort((left, right) => left - right)
  const mean = results.reduce((acc, value) => acc + value, 0) / results.length
  const p05 = results[Math.floor(results.length * 0.05)] ?? basePnl
  return { mean, p05 }
}
