import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import type { Opportunity, RiskDecision, RiskState } from '../contracts/types'

export type PreTradeContext = {
  riskState: RiskState
  requestedSize: number
  availableDepthSize: number
  latencyMs: number
}

export function preTradeCheck(
  opportunity: Opportunity,
  context: PreTradeContext,
  config: RuntimeConfig = getRuntimeConfig(),
): RiskDecision {
  const { riskState, requestedSize, availableDepthSize, latencyMs } = context

  if (riskState.killSwitchEnabled) {
    return { allow: false, reason: 'KILL_SWITCH', approvedSize: 0, maxSize: 0, maxSlippageBps: 0, killSwitch: true, onlyReduce: true, notes: ['kill switch active'] }
  }
  if (riskState.onlyReduce) {
    return { allow: false, reason: 'ONLY_REDUCE', approvedSize: 0, maxSize: 0, maxSlippageBps: 0, killSwitch: false, onlyReduce: true, notes: ['only reduce mode active'] }
  }
  if (opportunity.evBps <= 0) {
    return { allow: false, reason: 'NON_POSITIVE_EV', approvedSize: 0, maxSize: 0, maxSlippageBps: 0, killSwitch: false, onlyReduce: false, notes: ['ev is not positive'] }
  }
  if (riskState.openNotional + riskState.pendingNotional >= config.risk.maxOpenNotional) {
    return { allow: false, reason: 'MAX_OPEN_NOTIONAL', approvedSize: 0, maxSize: 0, maxSlippageBps: 0, killSwitch: false, onlyReduce: false, notes: ['open notional limit reached'] }
  }
  if (latencyMs > config.risk.maxLatencyMs) {
    return { allow: false, reason: 'LATENCY_GUARD', approvedSize: 0, maxSize: 0, maxSlippageBps: 0, killSwitch: false, onlyReduce: false, notes: ['latency guard breached'] }
  }
  if (riskState.failCount >= config.risk.maxFailCount) {
    return { allow: false, reason: 'FAIL_COUNT', approvedSize: 0, maxSize: 0, maxSlippageBps: 0, killSwitch: true, onlyReduce: true, notes: ['failure threshold reached'] }
  }
  if (availableDepthSize <= 0) {
    return { allow: false, reason: 'INSUFFICIENT_DEPTH', approvedSize: 0, maxSize: 0, maxSlippageBps: 0, killSwitch: false, onlyReduce: false, notes: ['no visible ask depth'] }
  }

  const approvedSize = Math.max(0, Math.min(requestedSize, availableDepthSize, config.risk.maxSize))
  return {
    allow: approvedSize > 0,
    approvedSize,
    maxSize: config.risk.maxSize,
    maxSlippageBps: config.strategies.staticArb.maxSlippageBps,
    killSwitch: false,
    onlyReduce: false,
    notes: approvedSize > 0 ? ['approved'] : ['size clipped to zero'],
  }
}
