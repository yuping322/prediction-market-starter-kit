export function monteCarloPnl(basePnl: number, runs = 200): { mean: number; p05: number } {
  const results: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const shock = 1 + (Math.random() - 0.5) * 0.4
    results.push(basePnl * shock)
  }
  results.sort((a, b) => a - b)
  const mean = results.reduce((acc, v) => acc + v, 0) / results.length
  const p05 = results[Math.floor(results.length * 0.05)]
  return { mean, p05 }
}
