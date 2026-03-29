import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveEngine } from '../core/run-live-engine'
import { getApprovedRuntimeConfig } from '../config/runtime'
import type { OrderIntent, OrderUpdate } from '../contracts/types'
import { buildTokenMap } from '../integration/exchange'
import { PolymarketPaperAdapter, type PolymarketPaperMarketStream } from '../integration/polymarket-paper'
import type { PolymarketWsHandlers, PolymarketWsSubscription } from '@/lib/polymarket/ws'

class FakePaperMarketStream implements PolymarketPaperMarketStream {
  private subscription?: PolymarketWsSubscription

  constructor(private readonly handlers: PolymarketWsHandlers) {}

  async connect(subscription?: PolymarketWsSubscription): Promise<void> {
    this.subscription = subscription
    this.handlers.onStatusChange?.('connected')
  }

  async disconnect(): Promise<void> {
    this.handlers.onStatusChange?.('disconnected')
  }

  async updateSubscription(subscription: PolymarketWsSubscription): Promise<void> {
    this.subscription = subscription
  }

  emit(message: unknown): void {
    this.handlers.onMessage?.(message)
  }

  getSubscription(): PolymarketWsSubscription | undefined {
    return this.subscription
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    intentId: 'paper-order-1',
    opportunityId: 'opp-1',
    legId: 'passive',
    marketId: 'm1',
    tokenId: 'y1',
    outcome: 'yes',
    action: 'buy',
    limitPrice: 0.45,
    size: 10,
    tif: 'GTC',
    postOnly: true,
    reduceOnly: false,
    expiresAt: Date.now() + 5_000,
    clientOrderId: 'paper-order-1',
    ...overrides,
  }
}

test('paper adapter simulates passive fill then cancel without account credentials', async () => {
  let stream: FakePaperMarketStream | undefined
  const runtime = getApprovedRuntimeConfig({
    execution: {
      passiveFillRatio: 0.5,
      hedgeFillRatio: 1,
      priceImprovementBps: 4,
      passivePriceOffset: 0.002,
      allowIocHedge: true,
    },
  })
  const adapter = new PolymarketPaperAdapter({
    runtime,
    fillDelayMs: 5,
    bootstrapValidation: false,
    marketStreamFactory: (handlers) => {
      stream = new FakePaperMarketStream(handlers)
      return stream
    },
  })

  const tokenMap = buildTokenMap('m1', 'y1', 'n1')
  const updates: OrderUpdate[] = []
  await adapter.subscribeMarkets([{ marketId: 'm1', tokenMap }])
  await adapter.connect({
    onOrderUpdate: (update) => updates.push(update),
  })

  assert.deepEqual(stream?.getSubscription(), {
    marketIds: ['m1'],
    tokenIds: ['y1', 'n1'],
  })

  const accepted = await adapter.placeOrder(makeIntent())
  assert.equal(accepted.status, 'accepted')
  assert.equal((await adapter.syncOpenOrders()).length, 1)

  await wait(20)
  assert.equal(updates[0]?.status, 'accepted')
  assert.equal(updates[1]?.status, 'partial_fill')
  assert.equal(updates[1]?.filledSize, 5)

  const openOrders = await adapter.syncOpenOrders()
  assert.equal(openOrders.length, 1)
  assert.equal(openOrders[0]?.status, 'partial_fill')

  const canceled = await adapter.cancelOrder(accepted.orderId, 'TEST_CANCEL')
  assert.equal(canceled.status, 'canceled')
  assert.equal((await adapter.syncOpenOrders()).length, 0)

  await adapter.disconnect()
})

test('paper live engine executes end-to-end from public market stream', async () => {
  let stream: FakePaperMarketStream | undefined
  const overrides = {
    modeDefaults: {
      executionMode: 'paper' as const,
      confidenceFilterEnabled: false,
    },
    execution: {
      passiveFillRatio: 1,
      hedgeFillRatio: 1,
      priceImprovementBps: 4,
      passivePriceOffset: 0.002,
      allowIocHedge: true,
    },
    models: {
      bayesian: {
        enabled: true,
        minConfidence: 0.1,
        imbalanceWeight: 0.3,
        spreadWeight: -0.05,
      },
      stoikov: {
        riskAversion: 0.002,
        inventoryWeight: 1,
        volatilityWeight: 0.5,
      },
      kelly: {
        maxFraction: 0.02,
        minFraction: 0.001,
        confidenceScale: 1,
      },
      monteCarlo: {
        runs: 200,
        slippageShockBps: 15,
        latencyShockMs: 120,
      },
    },
  }
  const adapter = new PolymarketPaperAdapter({
    runtime: getApprovedRuntimeConfig(overrides),
    fillDelayMs: 5,
    bootstrapValidation: false,
    marketStreamFactory: (handlers) => {
      stream = new FakePaperMarketStream(handlers)
      return stream
    },
  })

  const tokenMap = buildTokenMap('m1', 'y1', 'n1')
  const engine = createLiveEngine(adapter, [{ marketId: 'm1', tokenMap }], overrides)
  await engine.start()

  const now = Date.now()
  stream?.emit([
    {
      event_type: 'book',
      asset_id: tokenMap.yesTokenId,
      market: 'm1',
      timestamp: now,
      bids: [['0.44', '100']],
      asks: [['0.45', '100']],
    },
    {
      event_type: 'book',
      asset_id: tokenMap.noTokenId,
      market: 'm1',
      timestamp: now + 1,
      bids: [['0.44', '100']],
      asks: [['0.45', '100']],
    },
  ])

  await wait(40)
  const snapshot = engine.getSnapshot()
  assert.ok(snapshot.opportunities > 0)
  assert.ok(snapshot.executed > 0)
  assert.equal(snapshot.connectionState.status, 'connected')
  assert.equal(snapshot.activeMarkets.length, 0)
  assert.ok(snapshot.workingOrders.some((order) => order.status === 'filled'))

  await engine.stop()
})
