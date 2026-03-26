import test from 'node:test'
import assert from 'node:assert/strict'
import type { SyntheticTick } from '../ingest/adapter'
import { runEngine } from '../core/run-engine'

function makeTicks(): SyntheticTick[] {
  return Array.from({ length: 50 }, (_, i) => ({
    ts: i,
    marketId: 'test',
    yesBid: 0.44,
    yesAsk: 0.45,
    noBid: 0.44,
    noAsk: 0.45,
    volume: 100,
  }))
}

test('pipeline generates opportunities and executions', () => {
  const result = runEngine(makeTicks())
  assert.ok(result.opportunities > 0)
  assert.ok(result.executed > 0)
  assert.ok(result.completionRate > 0)
})
