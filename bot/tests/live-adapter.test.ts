import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLiveMarketRegistry,
  orderBookSummaryToSnapshotEvent,
  polymarketMessageToMarketEvents,
  polymarketMessageToOrderUpdates,
} from '../ingest/adapter'
import { buildExecutionPlan } from '../execution/orchestrator'
import { buildTokenMap } from '../integration/exchange'
import type { Opportunity, OrderUpdate, RiskDecision } from '../contracts/types'

const tokenMap = buildTokenMap('market-1', 'yes-token', 'no-token')
const registry = buildLiveMarketRegistry([{ marketId: 'market-1', tokenMap }])

const riskDecision: RiskDecision = {
  allow: true,
  approvedSize: 25,
  maxSize: 25,
  maxSlippageBps: 30,
  killSwitch: false,
  onlyReduce: false,
  notes: ['approved'],
}

function makeOpportunity(): Opportunity {
  return {
    id: 'opp-live-1',
    strategy: 'static_arb',
    marketId: 'market-1',
    tokenMap,
    grossEdgeBps: 100,
    costBps: 20,
    evBps: 80,
    confidence: 0.75,
    ttlMs: 3000,
    createdAt: 1000,
    legs: [
      {
        legId: 'passive',
        marketId: 'market-1',
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
        legId: 'hedge',
        marketId: 'market-1',
        tokenId: tokenMap.noTokenId,
        outcome: 'no',
        action: 'buy',
        targetPrice: 0.46,
        referencePrice: 0.46,
        maxSlippageBps: 30,
        tif: 'IOC',
        postOnly: false,
      },
    ],
  }
}

test('orderBookSummaryToSnapshotEvent maps token book to market snapshot', () => {
  const snapshot = orderBookSummaryToSnapshotEvent(
    {
      asset_id: tokenMap.yesTokenId,
      timestamp: '101',
      bids: [['0.44', '120']],
      asks: [['0.45', '80']],
    },
    registry,
    200,
  )

  assert.ok(snapshot)
  assert.equal(snapshot?.type, 'snapshot')
  assert.equal(snapshot?.marketId, 'market-1')
  assert.equal(snapshot?.payload.yes?.asks[0]?.price, 0.45)
})

test('polymarketMessageToMarketEvents parses book and trade frames', () => {
  const events = polymarketMessageToMarketEvents(
    [
      {
        event_type: 'book_update',
        asset_id: tokenMap.noTokenId,
        market: 'market-1',
        timestamp: 10,
        bids: [['0.53', '25']],
        asks: [['0.54', '10']],
      },
      {
        event_type: 'trade',
        asset_id: tokenMap.noTokenId,
        market: 'market-1',
        timestamp: 11,
        price: '0.54',
        size: '5',
        outcome: 'No',
      },
    ],
    registry,
    500,
  )

  assert.equal(events.length, 2)
  assert.equal(events[0]?.type, 'book_update')
  assert.equal(events[1]?.type, 'trade_print')
})

test('polymarketMessageToOrderUpdates converts user stream payload to cumulative order updates', () => {
  const tracked = new Map<string, OrderUpdate>()
  tracked.set('ord-1', {
    orderId: 'ord-1',
    exchangeOrderId: 'ord-1',
    clientOrderId: 'opp-live-1-passive',
    intentId: 'opp-live-1-passive',
    opportunityId: 'opp-live-1',
    legId: 'passive',
    marketId: 'market-1',
    tokenId: tokenMap.yesTokenId,
    outcome: 'yes',
    action: 'buy',
    status: 'accepted',
    filledSize: 0,
    remainingSize: 25,
    source: 'submit',
    ts: 1,
  })

  const updates = polymarketMessageToOrderUpdates(
    {
      data: [
        {
          event_type: 'trade',
          order_id: 'ord-1',
          asset_id: tokenMap.yesTokenId,
          market: 'market-1',
          status: 'matched',
          size_matched: '10',
          original_size: '25',
          price: '0.45',
          timestamp: 123,
        },
      ],
    },
    registry,
    tracked,
    200,
  )

  assert.equal(updates.length, 1)
  assert.equal(updates[0]?.status, 'partial_fill')
  assert.equal(updates[0]?.filledSize, 10)
  assert.equal(updates[0]?.remainingSize, 15)
  assert.equal(updates[0]?.lastFilledSize, 10)
})

test('buildExecutionPlan emits client order ids for live routing', () => {
  const plan = buildExecutionPlan(makeOpportunity(), {
    equity: 10_000,
    inventory: 0,
    riskDecision,
    now: 1000,
    volatility1s: 0.01,
  })

  assert.equal(plan.approvedSize > 0, true)
  assert.equal(plan.passiveLeg.clientOrderId, 'opp-live-1-passive')
  assert.equal(plan.hedgeLeg.clientOrderId, 'opp-live-1-hedge')
})
