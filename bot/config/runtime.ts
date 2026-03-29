import defaults from './generated/runtime-defaults.json'
import type { ApprovalStatus, ExecutionMode } from '../contracts/types'

export type RuntimeConfig = {
  version: string
  generatedAt: string
  approval: {
    status: ApprovalStatus
    approvedBy: string
  }
  modeDefaults: {
    executionMode: ExecutionMode
    confidenceFilterEnabled: boolean
  }
  strategies: {
    staticArb: {
      costBps: number
      minEvBps: number
      ttlMs: number
      maxSlippageBps: number
    }
  }
  risk: {
    maxOpenNotional: number
    maxDailyLossPct: number
    maxDrawdownPct: number
    maxFailCount: number
    onlyReduceAfterFailCount: number
    maxLatencyMs: number
    maxSize: number
  }
  execution: {
    passiveFillRatio: number
    hedgeFillRatio: number
    priceImprovementBps: number
    passivePriceOffset: number
    allowIocHedge: boolean
  }
  live: {
    reconnectBackoffMs: number
    maxReconnectBackoffMs: number
    staleAfterMs: number
    orderSyncIntervalMs: number
  }
  markets: {
    whitelist: string[]
    refreshIntervalMs: number
  }
  models: {
    bayesian: {
      enabled: boolean
      minConfidence: number
      imbalanceWeight: number
      spreadWeight: number
    }
    stoikov: {
      riskAversion: number
      inventoryWeight: number
      volatilityWeight: number
    }
    kelly: {
      maxFraction: number
      minFraction: number
      confidenceScale: number
    }
    monteCarlo: {
      runs: number
      slippageShockBps: number
      latencyShockMs: number
    }
  }
  rollout: {
    paperMinCompletionRate: number
    paperMinNetEvBps: number
  }
}

function deepMerge<T extends Record<string, unknown>>(base: T, override?: Partial<T>): T {
  if (!override) return { ...base }
  const merged = { ...base } as Record<string, unknown>

  for (const [key, value] of Object.entries(override)) {
    const current = merged[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      merged[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
      continue
    }
    merged[key] = value
  }

  return merged as T
}

export function getRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return deepMerge(defaults as RuntimeConfig, overrides)
}

export function getApprovedRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  const config = getRuntimeConfig(overrides)
  if (config.approval.status !== 'approved') {
    throw new Error(`Runtime config ${config.version} is not approved`)
  }
  return config
}
