import { fetchRealTicks } from '../integration/real-data'
import { runEngine } from '../core/run-engine'

async function main(): Promise<void> {
  const ticks = await fetchRealTicks(30)
  if (ticks.length === 0) {
    throw new Error('No real ticks fetched from Polymarket Gamma API')
  }

  const result = runEngine(ticks)
  console.log(
    JSON.stringify(
      {
        source: 'real-data',
        ticks: ticks.length,
        ...result,
      },
      null,
      2,
    ),
  )
}

void main()
