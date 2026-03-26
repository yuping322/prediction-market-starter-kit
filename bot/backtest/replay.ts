import type { SyntheticTick } from '../ingest/adapter'

export function replayTicks(ticks: SyntheticTick[]): SyntheticTick[] {
  return [...ticks].sort((a, b) => a.ts - b.ts)
}
