import type { EngineResult } from '../core/run-engine'
import { runEngine } from '../core/run-engine'
import type { SyntheticTick } from '../ingest/adapter'
import { replayTicks } from '../backtest/replay'

function makeSyntheticTicks(total = 200): SyntheticTick[] {
  const ticks: SyntheticTick[] = []
  for (let index = 0; index < total; index += 1) {
    const yesAsk = 0.46 + Math.sin(index / 8) * 0.01
    const noAsk = 0.47 + Math.cos(index / 7) * 0.01
    ticks.push({
      ts: index,
      marketId: 'mkt-1',
      yesBid: yesAsk - 0.01,
      yesAsk,
      noBid: noAsk - 0.01,
      noAsk,
      volume: 100 + (index % 9) * 5,
    })
  }
  return ticks
}

export function runSimulation(): EngineResult {
  const ticks = replayTicks(makeSyntheticTicks())
  return runEngine(ticks)
}
