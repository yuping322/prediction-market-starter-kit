export function kellySize(evBps: number, confidence: number, equity: number, cap = 0.02): number {
  const edge = Math.max(0, evBps / 10_000)
  const fraction = Math.min(cap, edge * confidence)
  return equity * fraction
}
