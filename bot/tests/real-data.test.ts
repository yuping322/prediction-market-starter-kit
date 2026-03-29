import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchRealTicks, fetchValidationMarkets } from '../integration/real-data'
import { runEngine } from '../core/run-engine'

test('real data fetch + pipeline smoke', async () => {
  const markets = await fetchValidationMarkets(10)
  assert.ok(markets.length > 0)
  assert.ok(markets[0]?.tokenMap.yesTokenId)

  const ticks = await fetchRealTicks(10)
  assert.ok(ticks.length > 0)
  assert.equal(ticks[0]?.source, 'gamma-validation')

  const result = runEngine(ticks.slice(0, 20))
  assert.ok(Number.isFinite(result.totalPnl))
})
