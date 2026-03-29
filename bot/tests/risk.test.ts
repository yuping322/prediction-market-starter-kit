import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTokenMap } from '../integration/exchange'
import { getRuntimeConfig } from '../config/runtime'
import { preTradeCheck } from '../risk/pre_trade'
import { createRiskState, shouldTriggerDrawdownStop } from '../risk/realtime'
import type { Opportunity } from '../contracts/types'

const tokenMap = buildTokenMap('m')

function makeOpportunity(evBps = 10): Opportunity {
  return {
    id: '1',
    strategy: 'static_arb',
    marketId: 'm',
    tokenMap,
    grossEdgeBps: evBps + 20,
    costBps: 20,
    evBps,
    confidence: 0.8,
    ttlMs: 3000,
    createdAt: 1,
    legs: [
      {
        legId: 'yes',
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
        legId: 'no',
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

test('preTradeCheck rejects over notional', () => {
  const config = getRuntimeConfig()
  const riskState = createRiskState(config)
  riskState.openNotional = config.risk.maxOpenNotional

  const decision = preTradeCheck(
    makeOpportunity(),
    {
      riskState,
      requestedSize: 50,
      availableDepthSize: 100,
      latencyMs: 50,
    },
    config,
  )
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'MAX_OPEN_NOTIONAL')
})

test('drawdown stop triggers on limit breach', () => {
  assert.equal(shouldTriggerDrawdownStop(-2.1, -1), true)
  assert.equal(shouldTriggerDrawdownStop(-1, -4.1), true)
  assert.equal(shouldTriggerDrawdownStop(-1, -1), false)
})
