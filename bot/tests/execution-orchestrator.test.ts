import test from 'node:test'
import assert from 'node:assert/strict'
import { executeOpportunity } from '../execution/orchestrator'
import { buildTokenMap } from '../integration/exchange'
import type { Opportunity, RiskDecision } from '../contracts/types'

const tokenMap = buildTokenMap('m')

function makeOpportunity(): Opportunity {
  return {
    id: 'opp-1',
    strategy: 'static_arb',
    marketId: 'm',
    tokenMap,
    grossEdgeBps: 120,
    costBps: 20,
    evBps: 100,
    confidence: 0.8,
    ttlMs: 3000,
    createdAt: 1,
    legs: [
      {
        legId: 'passive-yes',
        marketId: 'm',
        tokenId: tokenMap.yesTokenId,
        outcome: 'yes',
        action: 'buy',
        targetPrice: 0.45,
        referencePrice: 0.45,
        maxSlippageBps: 30,
        tif: 'GTC',
        postOnly: true,
      },
      {
        legId: 'hedge-no',
        marketId: 'm',
        tokenId: tokenMap.noTokenId,
        outcome: 'no',
        action: 'buy',
        targetPrice: 0.45,
        referencePrice: 0.45,
        maxSlippageBps: 30,
        tif: 'IOC',
        postOnly: false,
      },
    ],
  }
}

const riskDecision: RiskDecision = {
  allow: true,
  approvedSize: 50,
  maxSize: 50,
  maxSlippageBps: 30,
  killSwitch: false,
  onlyReduce: false,
  notes: ['approved'],
}

test('executeOpportunity builds two-leg execution plan', () => {
  const result = executeOpportunity(makeOpportunity(), {
    equity: 10_000,
    inventory: 0,
    riskDecision,
    now: 1,
    volatility1s: 0.01,
  })

  assert.equal(result.intents.length, 2)
  assert.ok(result.updates.some((update) => update.intentId === `${makeOpportunity().id}-hedge`))
  assert.equal(result.hedgeUsed, true)
})
