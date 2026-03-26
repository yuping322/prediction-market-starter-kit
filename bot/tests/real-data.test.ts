import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchRealTicks } from '../integration/real-data'
import { runEngine } from '../core/run-engine'

test('real data fetch + pipeline smoke', async () => {
  const ticks = await fetchRealTicks(10)
  assert.ok(ticks.length > 0)
  const result = runEngine(ticks.slice(0, 20))
  assert.ok(Number.isFinite(result.totalPnl))
})
