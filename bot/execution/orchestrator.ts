import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import type { ExecutionPlan, ExecutionResult, Opportunity, OrderIntent, OrderUpdate, RiskDecision } from '../contracts/types'
import { kellySize } from './kelly'
import { stoikovPriceAdjust } from './stoikov'

export type ExecutionContext = {
  equity: number
  inventory: number
  riskDecision: RiskDecision
  now: number
  volatility1s?: number
}

function clampPrice(value: number): number {
  return Math.max(0.01, Math.min(0.99, value))
}

function makePlan(opportunity: Opportunity, approvedSize: number, passivePrice: number, hedgePrice: number): ExecutionPlan {
  const passiveLeg: OrderIntent = {
    intentId: `${opportunity.id}-passive`,
    opportunityId: opportunity.id,
    legId: opportunity.legs[0].legId,
    marketId: opportunity.marketId,
    tokenId: opportunity.legs[0].tokenId,
    outcome: opportunity.legs[0].outcome,
    action: opportunity.legs[0].action,
    limitPrice: passivePrice,
    size: approvedSize,
    tif: opportunity.legs[0].tif,
    postOnly: true,
    reduceOnly: false,
    expiresAt: opportunity.createdAt + opportunity.ttlMs,
    clientOrderId: `${opportunity.id}-passive`,
  }

  const hedgeLeg: OrderIntent = {
    intentId: `${opportunity.id}-hedge`,
    opportunityId: opportunity.id,
    legId: opportunity.legs[1].legId,
    marketId: opportunity.marketId,
    tokenId: opportunity.legs[1].tokenId,
    outcome: opportunity.legs[1].outcome,
    action: opportunity.legs[1].action,
    limitPrice: hedgePrice,
    size: approvedSize,
    tif: opportunity.legs[1].tif,
    postOnly: false,
    reduceOnly: false,
    expiresAt: opportunity.createdAt + opportunity.ttlMs,
    clientOrderId: `${opportunity.id}-hedge`,
  }

  return {
    opportunityId: opportunity.id,
    createdAt: opportunity.createdAt,
    ttlMs: opportunity.ttlMs,
    approvedSize,
    passiveLeg,
    hedgeLeg,
  }
}

export function buildExecutionPlan(
  opportunity: Opportunity,
  context: ExecutionContext,
  config: RuntimeConfig = getRuntimeConfig(),
): ExecutionPlan {
  const requestedSize = kellySize(opportunity.evBps, opportunity.confidence, context.equity, config)
  const approvedSize = Math.min(requestedSize, context.riskDecision.approvedSize || context.riskDecision.maxSize)
  const passiveReference = opportunity.legs[0].targetPrice
  const hedgeReference = opportunity.legs[1].targetPrice
  const passivePrice = clampPrice(stoikovPriceAdjust(passiveReference, context.inventory, context.volatility1s, config))
  const hedgePrice = clampPrice(hedgeReference + context.riskDecision.maxSlippageBps / 10_000)
  return makePlan(opportunity, approvedSize, passivePrice, hedgePrice)
}

export function executeOpportunity(
  opportunity: Opportunity,
  context: ExecutionContext,
  config: RuntimeConfig = getRuntimeConfig(),
): ExecutionResult {
  const plan = buildExecutionPlan(opportunity, context, config)
  const approvedSize = plan.approvedSize

  if (!context.riskDecision.allow || approvedSize <= 0) {
    return {
      plan,
      intents: [],
      updates: [],
      metrics: [],
      pnl: 0,
      realizedNotional: 0,
      completed: false,
      hedgeUsed: false,
    }
  }

  const passiveFillRatio = Math.max(
    0,
    Math.min(1, config.execution.passiveFillRatio + opportunity.confidence * 0.25 - Math.abs(context.inventory) * 0.0002),
  )
  const passiveFilled = approvedSize * passiveFillRatio
  const hedgeFillRatio = config.execution.allowIocHedge ? config.execution.hedgeFillRatio : 0
  const hedgeFilled = passiveFilled * hedgeFillRatio
  const completion = passiveFilled > 0 ? hedgeFilled / passiveFilled : 0
  const slippageBps =
    ((Math.abs(plan.passiveLeg.limitPrice - opportunity.legs[0].referencePrice) / Math.max(0.01, opportunity.legs[0].referencePrice)) +
      (Math.abs(plan.hedgeLeg.limitPrice - opportunity.legs[1].referencePrice) / Math.max(0.01, opportunity.legs[1].referencePrice))) *
    5_000

  const updates: OrderUpdate[] = [
    {
      orderId: `${plan.passiveLeg.intentId}-ord`,
      exchangeOrderId: `${plan.passiveLeg.intentId}-ord`,
      clientOrderId: plan.passiveLeg.clientOrderId,
      intentId: plan.passiveLeg.intentId,
      opportunityId: opportunity.id,
      legId: plan.passiveLeg.legId,
      marketId: plan.passiveLeg.marketId,
      tokenId: plan.passiveLeg.tokenId,
      outcome: plan.passiveLeg.outcome,
      action: plan.passiveLeg.action,
      status: 'accepted',
      filledSize: 0,
      remainingSize: approvedSize,
      source: 'simulation',
      ts: context.now,
      tsExchange: context.now,
      tsLocal: context.now,
    },
    {
      orderId: `${plan.passiveLeg.intentId}-ord`,
      exchangeOrderId: `${plan.passiveLeg.intentId}-ord`,
      clientOrderId: plan.passiveLeg.clientOrderId,
      intentId: plan.passiveLeg.intentId,
      opportunityId: opportunity.id,
      legId: plan.passiveLeg.legId,
      marketId: plan.passiveLeg.marketId,
      tokenId: plan.passiveLeg.tokenId,
      outcome: plan.passiveLeg.outcome,
      action: plan.passiveLeg.action,
      status: passiveFilled >= approvedSize ? 'filled' : 'partial_fill',
      filledSize: passiveFilled,
      remainingSize: Math.max(0, approvedSize - passiveFilled),
      lastFilledSize: passiveFilled,
      lastFilledPrice: plan.passiveLeg.limitPrice,
      avgPrice: plan.passiveLeg.limitPrice,
      source: 'simulation',
      ts: context.now + 1,
      tsExchange: context.now + 1,
      tsLocal: context.now + 1,
    },
  ]

  if (passiveFilled < approvedSize) {
    updates.push({
      orderId: `${plan.passiveLeg.intentId}-ord`,
      exchangeOrderId: `${plan.passiveLeg.intentId}-ord`,
      clientOrderId: plan.passiveLeg.clientOrderId,
      intentId: plan.passiveLeg.intentId,
      opportunityId: opportunity.id,
      legId: plan.passiveLeg.legId,
      marketId: plan.passiveLeg.marketId,
      tokenId: plan.passiveLeg.tokenId,
      outcome: plan.passiveLeg.outcome,
      action: plan.passiveLeg.action,
      status: 'expired',
      filledSize: passiveFilled,
      remainingSize: Math.max(0, approvedSize - passiveFilled),
      avgPrice: plan.passiveLeg.limitPrice,
      reason: 'TTL_EXPIRED',
      source: 'simulation',
      ts: context.now + opportunity.ttlMs,
      tsExchange: context.now + opportunity.ttlMs,
      tsLocal: context.now + opportunity.ttlMs,
    })
  }

  if (passiveFilled > 0) {
    updates.push(
      {
        orderId: `${plan.hedgeLeg.intentId}-ord`,
        exchangeOrderId: `${plan.hedgeLeg.intentId}-ord`,
        clientOrderId: plan.hedgeLeg.clientOrderId,
        intentId: plan.hedgeLeg.intentId,
        opportunityId: opportunity.id,
        legId: plan.hedgeLeg.legId,
        marketId: plan.hedgeLeg.marketId,
        tokenId: plan.hedgeLeg.tokenId,
        outcome: plan.hedgeLeg.outcome,
        action: plan.hedgeLeg.action,
        status: 'accepted',
        filledSize: 0,
        remainingSize: passiveFilled,
        source: 'simulation',
        ts: context.now + 2,
        tsExchange: context.now + 2,
        tsLocal: context.now + 2,
      },
      {
        orderId: `${plan.hedgeLeg.intentId}-ord`,
        exchangeOrderId: `${plan.hedgeLeg.intentId}-ord`,
        clientOrderId: plan.hedgeLeg.clientOrderId,
        intentId: plan.hedgeLeg.intentId,
        opportunityId: opportunity.id,
        legId: plan.hedgeLeg.legId,
        marketId: plan.hedgeLeg.marketId,
        tokenId: plan.hedgeLeg.tokenId,
        outcome: plan.hedgeLeg.outcome,
        action: plan.hedgeLeg.action,
        status: hedgeFilled >= passiveFilled ? 'filled' : 'partial_fill',
        filledSize: hedgeFilled,
        remainingSize: Math.max(0, passiveFilled - hedgeFilled),
        lastFilledSize: hedgeFilled,
        lastFilledPrice: plan.hedgeLeg.limitPrice,
        avgPrice: plan.hedgeLeg.limitPrice,
        reason: hedgeFilled >= passiveFilled ? undefined : 'IOC_PARTIAL',
        source: 'simulation',
        ts: context.now + 3,
        tsExchange: context.now + 3,
        tsLocal: context.now + 3,
      },
    )
  }

  const realizedNotional = hedgeFilled * (plan.passiveLeg.limitPrice + plan.hedgeLeg.limitPrice)
  const pnl = hedgeFilled * (opportunity.evBps / 10_000) - hedgeFilled * (slippageBps / 10_000)
  const completed = completion >= 0.95

  return {
    plan,
    intents: [plan.passiveLeg, plan.hedgeLeg],
    updates,
    metrics: [
      {
        opportunityId: opportunity.id,
        marketId: opportunity.marketId,
        stage: 'execution',
        ts: context.now,
        latencyMs: 3,
        slippageBps,
        completion,
        pnl,
      },
      {
        opportunityId: opportunity.id,
        marketId: opportunity.marketId,
        stage: completed ? 'fill' : 'kill_switch',
        ts: context.now + 3,
        completion,
        reason: completed ? undefined : 'HEDGE_INCOMPLETE',
      },
    ],
    pnl,
    realizedNotional,
    completed,
    hedgeUsed: passiveFilled > 0,
  }
}
