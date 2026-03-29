import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveEngine } from '../core/run-live-engine'
import type { MarketEvent, OrderIntent, OrderUpdate } from '../contracts/types'
import { buildTokenMap, type ExchangeAdapter, type ExchangeConnectionState, type ExchangeListeners } from '../integration/exchange'

class MockExchangeAdapter implements ExchangeAdapter {
  adapterId = 'mock-live'
  mode = 'paper' as const
  private listeners: ExchangeListeners = {}
  private connectionState: ExchangeConnectionState = {
    status: 'disconnected',
    marketChannel: 'disconnected',
    userChannel: 'disconnected',
  }

  async connect(listeners?: ExchangeListeners): Promise<void> {
    this.listeners = listeners ?? {}
    this.connectionState = {
      status: 'connected',
      marketChannel: 'connected',
      userChannel: 'connected',
      lastMessageAt: Date.now(),
    }
    this.listeners.onConnectionState?.(this.connectionState)
  }

  async disconnect(): Promise<void> {
    this.connectionState = {
      status: 'disconnected',
      marketChannel: 'disconnected',
      userChannel: 'disconnected',
    }
  }

  async subscribeMarkets(): Promise<void> {}

  async placeOrder(intent: OrderIntent): Promise<OrderUpdate> {
    const accepted: OrderUpdate = {
      orderId: `${intent.intentId}-ord`,
      exchangeOrderId: `${intent.intentId}-ord`,
      clientOrderId: intent.clientOrderId,
      intentId: intent.intentId,
      opportunityId: intent.opportunityId,
      legId: intent.legId,
      marketId: intent.marketId,
      tokenId: intent.tokenId,
      outcome: intent.outcome,
      action: intent.action,
      status: 'accepted',
      filledSize: 0,
      remainingSize: intent.size,
      source: 'submit',
      ts: Date.now(),
    }
    this.listeners.onOrderUpdate?.(accepted)

    const filled: OrderUpdate = {
      ...accepted,
      status: 'filled',
      filledSize: intent.size,
      remainingSize: 0,
      lastFilledSize: intent.size,
      lastFilledPrice: intent.limitPrice,
      avgPrice: intent.limitPrice,
      source: 'user-stream',
      ts: Date.now(),
    }
    this.listeners.onOrderUpdate?.(filled)
    return accepted
  }

  async cancelOrder(orderId: string): Promise<OrderUpdate> {
    return {
      orderId,
      exchangeOrderId: orderId,
      intentId: orderId,
      opportunityId: orderId,
      legId: 'cancel',
      marketId: 'm1',
      tokenId: 't1',
      status: 'canceled',
      filledSize: 0,
      remainingSize: 0,
      source: 'cancel',
      ts: Date.now(),
    }
  }

  async syncOpenOrders(): Promise<OrderUpdate[]> {
    return []
  }

  getConnectionState(): ExchangeConnectionState {
    return this.connectionState
  }

  emitMarketEvent(event: MarketEvent) {
    this.listeners.onMarketEvent?.(event)
  }
}

test('live engine consumes market events and reaches executed state', async () => {
  const tokenMap = buildTokenMap('m1', 'y1', 'n1')
  const adapter = new MockExchangeAdapter()
  const engine = createLiveEngine(adapter, [{ marketId: 'm1', tokenMap }], {
    modeDefaults: {
      executionMode: 'paper',
      confidenceFilterEnabled: false,
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
  })
  await engine.start()

  adapter.emitMarketEvent({
    eventId: 'm1-s1-y',
    source: 'exchange',
    tsExchange: 1,
    tsLocal: 1,
    marketId: 'm1',
    sequence: 1,
    type: 'snapshot',
    payload: {
      yes: {
        bids: [{ price: 0.44, size: 100 }],
        asks: [{ price: 0.45, size: 100 }],
      },
    },
  })

  adapter.emitMarketEvent({
    eventId: 'm1-s1-n',
    source: 'exchange',
    tsExchange: 2,
    tsLocal: 2,
    marketId: 'm1',
    sequence: 2,
    type: 'snapshot',
    payload: {
      no: {
        bids: [{ price: 0.44, size: 100 }],
        asks: [{ price: 0.45, size: 100 }],
      },
    },
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  const snapshot = engine.getSnapshot()
  assert.ok(snapshot.opportunities > 0)
  assert.ok(snapshot.workingOrders.length > 0)
  assert.equal(snapshot.connectionState.status, 'connected')

  await engine.stop()
})
