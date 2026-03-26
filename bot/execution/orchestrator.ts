import type { Opportunity, OrderIntent, OrderUpdate } from '../contracts/types'
import { kellySize } from './kelly'
import { stoikovPriceAdjust } from './stoikov'

export type FillSimulation = {
  intents: OrderIntent[]
  updates: OrderUpdate[]
  pnl: number
}

export function executeOpportunity(opportunity: Opportunity, equity: number, inventory: number): FillSimulation {
  const size = kellySize(opportunity.evBps, opportunity.confidence, equity)
  const basePrice = 0.5
  const adjPrice = stoikovPriceAdjust(basePrice, inventory)

  const intents: OrderIntent[] = [
    {
      opportunityId: opportunity.id,
      marketId: opportunity.marketIds[0],
      side: 'buy',
      price: adjPrice,
      size,
      tif: 'GTC',
    },
    {
      opportunityId: opportunity.id,
      marketId: opportunity.marketIds[0],
      side: 'buy',
      price: 1 - adjPrice,
      size,
      tif: 'IOC',
    },
  ]

  const fillRatio = Math.min(1, 0.7 + opportunity.confidence * 0.3)
  const filledSize = size * fillRatio

  const updates: OrderUpdate[] = [
    {
      orderId: `${opportunity.id}-1`,
      status: fillRatio < 1 ? 'partial_fill' : 'filled',
      filledSize,
      avgPrice: adjPrice,
      ts: opportunity.createdAt,
    },
  ]

  const pnl = filledSize * (opportunity.evBps / 10_000)
  return { intents, updates, pnl }
}
