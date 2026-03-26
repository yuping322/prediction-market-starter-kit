import type { SyntheticTick } from '../ingest/adapter'
import { replayTicks } from '../backtest/replay'
import { runEngine } from '../core/run-engine'

function makeSyntheticTicks(total = 200): SyntheticTick[] {
  const ticks: SyntheticTick[] = []
  for (let i = 0; i < total; i += 1) {
    const yesAsk = 0.46 + Math.sin(i / 8) * 0.01
    const noAsk = 0.47 + Math.cos(i / 7) * 0.01
    ticks.push({
      ts: i,
      marketId: 'mkt-1',
      yesBid: yesAsk - 0.01,
      yesAsk,
      noBid: noAsk - 0.01,
      noAsk,
      volume: 100 + (i % 9) * 5,
    })
  }
  return ticks
}

export function runSimulation(): {
  opportunities: number
  executed: number
  totalPnl: number
  completionRate: number
  mcMean: number
  mcP05: number
} {
  const ticks = replayTicks(makeSyntheticTicks())
  return runEngine(ticks)
}

if (process.argv[1]?.includes('run-simulation')) {
  const result = runSimulation()
  console.log(JSON.stringify(result, null, 2))
}
