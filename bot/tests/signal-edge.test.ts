import test from 'node:test'
import assert from 'node:assert/strict'
import { computeEdge } from '../signal/edge'

test('computeEdge detects positive EV', () => {
  const result = computeEdge(
    { yesBid: 0.44, yesAsk: 0.45, noBid: 0.44, noAsk: 0.45 },
    20,
    5,
  )
  assert.ok(result.evBps > 0)
  assert.equal(result.shouldTrade, true)
})

test('computeEdge blocks negative EV', () => {
  const result = computeEdge(
    { yesBid: 0.49, yesAsk: 0.5, noBid: 0.49, noAsk: 0.5 },
    20,
    5,
  )
  assert.equal(result.shouldTrade, false)
})
