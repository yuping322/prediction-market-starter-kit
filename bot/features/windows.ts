export function rollingMean(values: number[], window: number): number {
  if (values.length === 0) return 0
  const slice = values.slice(-window)
  const sum = slice.reduce((acc, v) => acc + v, 0)
  return sum / slice.length
}

export function rollingStd(values: number[], window: number): number {
  const slice = values.slice(-window)
  if (slice.length <= 1) return 0
  const mean = rollingMean(slice, slice.length)
  const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / slice.length
  return Math.sqrt(variance)
}
