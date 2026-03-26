import type { Opportunity, RiskDecision } from '../contracts/types'

export function preTradeCheck(
  opportunity: Opportunity,
  openNotional: number,
  maxOpenNotional: number,
): RiskDecision {
  if (openNotional >= maxOpenNotional) {
    return { allow: false, reason: 'MAX_OPEN_NOTIONAL', killSwitch: false }
  }
  if (opportunity.evBps <= 0) {
    return { allow: false, reason: 'NON_POSITIVE_EV', killSwitch: false }
  }
  return { allow: true, maxSize: 100, maxSlippageBps: 30, killSwitch: false }
}
