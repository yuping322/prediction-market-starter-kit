import test from 'node:test'
import assert from 'node:assert/strict'
import { preTradeCheck } from '../risk/pre_trade'
import { shouldTriggerDrawdownStop } from '../risk/realtime'

test('preTradeCheck rejects over notional', () => {
  const decision = preTradeCheck(
    { id: '1', strategy: 'static_arb', marketIds: ['m'], evBps: 10, confidence: 0.8, ttlMs: 1, createdAt: 1 },
    1000,
    1000,
  )
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'MAX_OPEN_NOTIONAL')
})

test('drawdown stop triggers on limit breach', () => {
  assert.equal(shouldTriggerDrawdownStop(-2.1, -1), true)
  assert.equal(shouldTriggerDrawdownStop(-1, -4.1), true)
  assert.equal(shouldTriggerDrawdownStop(-1, -1), false)
})
