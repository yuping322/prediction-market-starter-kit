export function shouldTriggerDrawdownStop(intradayPnlPct: number, drawdownPct: number): boolean {
  return intradayPnlPct <= -2 || drawdownPct <= -4
}
