import { getEvents } from '@/lib/gamma'
import { parsePrices } from '@/lib/prices'
import { readFile } from 'node:fs/promises'
import type { SyntheticTick } from '../ingest/adapter'

function clampPrice(value: number): number {
  return Math.max(0.01, Math.min(0.99, value))
}

export async function fetchRealTicks(limit = 50): Promise<SyntheticTick[]> {
  let events: Awaited<ReturnType<typeof getEvents>>
  try {
    events = await getEvents({ active: true, closed: false, archived: false, limit })
  } catch {
    const snapshot = await readFile(new URL('../fixtures/gamma-events.snapshot.json', import.meta.url), 'utf8')
    events = JSON.parse(snapshot)
  }
  const ticks: SyntheticTick[] = []
  let ts = 0

  for (const event of events) {
    for (const market of event.markets ?? []) {
      const [yes, no] = parsePrices(market)
      if (yes <= 0 || no <= 0) continue

      const spread = 0.01
      ticks.push({
        ts: ts += 1,
        marketId: market.id,
        yesBid: clampPrice(yes - spread),
        yesAsk: clampPrice(yes + spread),
        noBid: clampPrice(no - spread),
        noAsk: clampPrice(no + spread),
        volume: Math.max(1, market.volume_24hr || market.volume || 1),
      })
    }
  }

  return ticks
}
