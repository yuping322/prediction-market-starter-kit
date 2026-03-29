import test from 'node:test'
import assert from 'node:assert/strict'
import { getRuntimeConfig } from '../config/runtime'
import { computeEdge } from '../signal/edge'

test('computeEdge detects positive EV', () => {
  const result = computeEdge(
    { yesAsk: 0.45, noAsk: 0.45 },
    getRuntimeConfig({
      strategies: {
        staticArb: {
          costBps: 20,
          minEvBps: 5,
          ttlMs: 3000,
          maxSlippageBps: 30,
        },
      },
    }),
  )
  assert.ok(result.evBps > 0)
  assert.equal(result.shouldTrade, true)
})

test('computeEdge blocks negative EV', () => {
  const result = computeEdge(
    { yesAsk: 0.5, noAsk: 0.5 },
    getRuntimeConfig({
      strategies: {
        staticArb: {
          costBps: 20,
          minEvBps: 5,
          ttlMs: 3000,
          maxSlippageBps: 30,
        },
      },
    }),
  )
  assert.equal(result.shouldTrade, false)
})
