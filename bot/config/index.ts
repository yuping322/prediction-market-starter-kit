import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export type BotConfig = {
  portfolio: {
    initialEquity: number
    maxOpenNotional: number
  }
  execution: {
    kellyCap: number
    stoikovRiskAversion: number
    slippageBps: number
    partialFillBaseRate: number
    partialFillSizeDecay: number
  }
  signal: {
    costBps: number
    minEvBps: number
    confidenceThreshold: number
  }
  risk: {
    intradayStopPct: number
    maxDrawdownPct: number
    maxPositionPct: number
  }
  data: {
    tickLimit: number
    spreadOverride: number
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PATH = resolve(__dirname, 'default.json')

let cached: BotConfig | null = null

export function loadConfig(path?: string): BotConfig {
  if (cached && !path) return cached

  const filePath = path ?? process.env.BOT_CONFIG_PATH ?? DEFAULT_PATH
  const raw = readFileSync(filePath, 'utf8')
  const config = JSON.parse(raw) as BotConfig
  if (!path) cached = config
  return config
}

export function resetConfigCache(): void {
  cached = null
}
