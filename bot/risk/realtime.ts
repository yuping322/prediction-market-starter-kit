import { getRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import type { RiskState } from '../contracts/types'
import { activateKillSwitch, getKillSwitchState } from './killswitch'

export function createRiskState(config: RuntimeConfig = getRuntimeConfig(), equity = 10_000): RiskState {
  const killSwitch = getKillSwitchState()
  return {
    equity,
    peakEquity: equity,
    intradayPnl: 0,
    drawdownPct: 0,
    openNotional: 0,
    pendingNotional: 0,
    failCount: 0,
    lastLatencyMs: 0,
    killSwitchEnabled: killSwitch.enabled,
    onlyReduce: killSwitch.onlyReduce,
    maxOpenNotional: config.risk.maxOpenNotional,
    maxDrawdownPct: config.risk.maxDrawdownPct,
    maxDailyLossPct: config.risk.maxDailyLossPct,
  }
}

export function shouldTriggerDrawdownStop(intradayPnlPct: number, drawdownPct: number): boolean {
  return intradayPnlPct <= -2 || drawdownPct <= -4
}

export function updateRiskStateAfterExecution(
  state: RiskState,
  result: { pnl: number; realizedNotional: number; completed: boolean; latencyMs: number },
): RiskState {
  const equity = state.equity + result.pnl
  const peakEquity = Math.max(state.peakEquity, equity)
  const intradayPnl = state.intradayPnl + result.pnl
  const drawdownPct = peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0
  const intradayPnlPct = peakEquity > 0 ? (intradayPnl / peakEquity) * 100 : 0
  const failCount = result.completed ? 0 : state.failCount + 1
  const onlyReduce = failCount >= 2
  const killSwitch =
    state.killSwitchEnabled ||
    failCount >= 3 ||
    shouldTriggerDrawdownStop(intradayPnlPct, drawdownPct)

  if (killSwitch) {
    activateKillSwitch(
      failCount >= 3 ? 'FAIL_COUNT' : 'DRAWDOWN_STOP',
      Date.now(),
      true,
    )
  }

  return {
    ...state,
    equity,
    peakEquity,
    intradayPnl,
    drawdownPct,
    openNotional: result.completed ? 0 : result.realizedNotional,
    pendingNotional: 0,
    failCount,
    lastLatencyMs: result.latencyMs,
    killSwitchEnabled: killSwitch,
    onlyReduce,
  }
}
