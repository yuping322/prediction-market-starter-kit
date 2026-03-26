let killSwitchEnabled = false

export function setKillSwitch(value: boolean): void {
  killSwitchEnabled = value
}

export function isKillSwitchEnabled(): boolean {
  return killSwitchEnabled
}
