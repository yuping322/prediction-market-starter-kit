export type KillSwitchState = {
  enabled: boolean
  onlyReduce: boolean
  reason?: string
  activatedAt?: number
}

let killSwitchState: KillSwitchState = {
  enabled: false,
  onlyReduce: false,
}

export function activateKillSwitch(reason: string, ts = Date.now(), onlyReduce = true): void {
  killSwitchState = {
    enabled: true,
    onlyReduce,
    reason,
    activatedAt: ts,
  }
}

export function clearKillSwitch(): void {
  killSwitchState = {
    enabled: false,
    onlyReduce: false,
  }
}

export function getKillSwitchState(): KillSwitchState {
  return { ...killSwitchState }
}
