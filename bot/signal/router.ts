import type {
  Opportunity,
  FeatureSnapshot,
  StrategyConfig,
  StrategyState,
  StrategyStats,
  StrategyRegistry,
  StrategyExecutionResult,
  RoutedOpportunity,
  ArbitrationResult,
  AllocationDecision,
  RouterState,
  StrategyType,
  StatArbSignal,
  MicrostructureSignal,
  TermSpreadSnapshot,
  TermStructureSignal,
  ResourceClaim,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"
import {
  StrategyRegistryManager,
  createDefaultStrategyConfig,
} from "./registry"
import {
  arbitrate,
  checkResourceConflict,
  DEFAULT_ARBITRATION_CONFIG,
} from "./arbitration"
import { allocateCapital, DEFAULT_ALLOCATION_CONFIG } from "./allocation"
import {
  generateStaticArbOpportunity,
  generateStaticArbResourceClaim,
  DEFAULT_STATIC_ARB_CONFIG,
} from "./static-arb"

export interface RouterConfig {
  parallelExecution: boolean
  maxRoutingDelayMs: number
  maxArbitrationDelayMs: number
  enableDynamicWeightAdjustment: boolean
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  parallelExecution: true,
  maxRoutingDelayMs: 5,
  maxArbitrationDelayMs: 1,
  enableDynamicWeightAdjustment: true,
}

export type StrategyOpportunityGenerator = (
  feature: FeatureSnapshot,
  book: BookState,
  now: number
) => Opportunity | null

export type StatArbOpportunityGenerator = (
  signal: StatArbSignal
) => Opportunity | null

export type MicrostructureOpportunityGenerator = (
  signal: MicrostructureSignal
) => Opportunity | null

export type TermStructureOpportunityGenerator = (
  spread: TermSpreadSnapshot,
  signal: TermStructureSignal
) => Opportunity | null

export class StrategyRouter {
  private registryManager: StrategyRegistryManager
  private routerState: RouterState
  private config: RouterConfig
  private opportunityGenerators: Map<StrategyType, StrategyOpportunityGenerator>
  private statArbGenerator?: StatArbOpportunityGenerator
  private microstructureGenerator?: MicrostructureOpportunityGenerator
  private termStructureGenerator?: TermStructureOpportunityGenerator

  constructor(config: RouterConfig = DEFAULT_ROUTER_CONFIG) {
    this.registryManager = new StrategyRegistryManager()
    this.config = config
    this.routerState = {
      totalEquity: 10_000,
      totalExposure: 0,
      availableCapital: 10_000,
      lockedMarkets: new Map(),
      strategyExposures: new Map(),
    }
    this.opportunityGenerators = new Map()
    this.opportunityGenerators.set("static_arb", this.defaultStaticArbGenerator)
    this.opportunityGenerators.set("stat_arb", this.defaultStatArbGenerator)
    this.opportunityGenerators.set(
      "microstructure",
      this.defaultMicrostructureGenerator
    )
    this.opportunityGenerators.set(
      "term_structure",
      this.defaultTermStructureGenerator
    )
    this.initializeDefaultStrategies()
  }

  private initializeDefaultStrategies(): void {
    const defaultTypes: StrategyType[] = [
      "static_arb",
      "stat_arb",
      "microstructure",
      "term_structure",
    ]
    for (const type of defaultTypes) {
      const config = createDefaultStrategyConfig(type, type)
      this.registryManager.registerStrategy(config)
    }
  }

  private defaultStaticArbGenerator: StrategyOpportunityGenerator = (
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): Opportunity | null => {
    return generateStaticArbOpportunity(
      feature,
      book,
      now,
      DEFAULT_STATIC_ARB_CONFIG
    )
  }

  private defaultStatArbGenerator: StrategyOpportunityGenerator = (
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): Opportunity | null => {
    return null // stat_arb requires pair market data, handled separately
  }

  private defaultMicrostructureGenerator: StrategyOpportunityGenerator = (
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): Opportunity | null => {
    // Simple microstructure signal based on imbalance
    const imbalance = feature.imbalanceL1
    if (Math.abs(imbalance) < 0.3) return null

    return {
      id: `${feature.marketId}-micro-${now}`,
      strategy: "microstructure",
      marketIds: [feature.marketId],
      evBps: Math.abs(imbalance) * 100,
      confidence: Math.abs(imbalance),
      ttlMs: 2000,
      createdAt: now,
    }
  }

  private defaultTermStructureGenerator: StrategyOpportunityGenerator = (
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): Opportunity | null => {
    return null // term_structure requires multiple expiry data, handled separately
  }

  registerStrategy(config: StrategyConfig): void {
    this.registryManager.registerStrategy(config)
  }

  unregisterStrategy(name: string): void {
    this.registryManager.unregisterStrategy(name)
  }

  enableStrategy(name: string): void {
    this.registryManager.enableStrategy(name)
  }

  disableStrategy(name: string): void {
    this.registryManager.disableStrategy(name)
  }

  pauseStrategy(name: string): void {
    this.registryManager.pauseStrategy(name)
  }

  resumeStrategy(name: string): void {
    this.registryManager.resumeStrategy(name)
  }

  updateStrategyWeight(name: string, weight: number): void {
    this.registryManager.updateStrategyWeight(name, weight)
  }

  setOpportunityGenerator(
    type: StrategyType,
    generator: StrategyOpportunityGenerator
  ): void {
    this.opportunityGenerators.set(type, generator)
  }

  setStatArbGenerator(generator: StatArbOpportunityGenerator): void {
    this.statArbGenerator = generator
  }

  setMicrostructureGenerator(
    generator: MicrostructureOpportunityGenerator
  ): void {
    this.microstructureGenerator = generator
  }

  setTermStructureGenerator(
    generator: TermStructureOpportunityGenerator
  ): void {
    this.termStructureGenerator = generator
  }

  getStrategyState(name: string): StrategyState | undefined {
    return this.registryManager.getStrategyState(name)
  }

  getStrategyConfig(name: string): StrategyConfig | undefined {
    return this.registryManager.getStrategyConfig(name)
  }

  updateStrategyState(result: StrategyExecutionResult): void {
    this.registryManager.updateStrategyState(result.strategyName, result)

    const currentExposure =
      this.routerState.strategyExposures.get(result.strategyName) ?? 0
    if (result.success && result.exposure !== undefined) {
      this.routerState.strategyExposures.set(
        result.strategyName,
        result.exposure
      )
      this.routerState.totalExposure =
        this.routerState.totalExposure - currentExposure + result.exposure
    }

    for (const marketId of result.marketIds) {
      if (result.success) {
        this.routerState.lockedMarkets.delete(marketId)
        this.registryManager.unlockMarket(result.strategyName, marketId)
      }
    }
  }

  checkCooldown(name: string, now: number): boolean {
    return this.registryManager.checkCooldown(name, now)
  }

  updateRouterState(totalEquity: number, totalExposure: number): void {
    this.routerState.totalEquity = totalEquity
    this.routerState.totalExposure = totalExposure
    this.routerState.availableCapital = totalEquity - totalExposure
  }

  lockMarket(strategyName: string, marketId: string): void {
    this.routerState.lockedMarkets.set(marketId, strategyName)
    this.registryManager.lockMarket(strategyName, marketId)
  }

  unlockMarket(strategyName: string, marketId: string): void {
    this.routerState.lockedMarkets.delete(marketId)
    this.registryManager.unlockMarket(strategyName, marketId)
  }

  route(
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): RoutedOpportunity[] {
    const routedOpportunities: RoutedOpportunity[] = []
    const registry = this.registryManager.getRegistry()

    const activeStrategies = Array.from(registry.strategies.values())
      .filter((s) => s.enabled)
      .sort((a, b) => b.priority - a.priority)

    for (const strategy of activeStrategies) {
      if (!this.checkCooldown(strategy.name, now)) {
        continue
      }

      const state = registry.states.get(strategy.name)
      if (!state || state.status !== "active") {
        continue
      }

      const generator = this.opportunityGenerators.get(strategy.type)
      if (!generator) {
        continue
      }

      const opportunity = generator(feature, book, now)
      if (!opportunity) {
        continue
      }

      this.registryManager.incrementOpportunitiesFound(strategy.name)

      const resourceClaim = this.generateResourceClaim(opportunity, strategy)

      routedOpportunities.push({
        opportunity,
        sourceStrategy: strategy.name,
        priority: strategy.priority,
        resourceClaim,
      })
    }

    return routedOpportunities
  }

  private generateResourceClaim(
    opportunity: Opportunity,
    strategy: StrategyConfig
  ): typeof opportunity extends { strategy: "static_arb" }
    ? ReturnType<typeof generateStaticArbResourceClaim>
    : {
        marketIds: string[]
        estimatedExposure: number
        estimatedDurationMs: number
      } {
    if (opportunity.strategy === "static_arb") {
      return generateStaticArbResourceClaim(opportunity)
    }

    return {
      marketIds: opportunity.marketIds,
      estimatedExposure:
        strategy.maxExposurePerMarket * this.routerState.totalEquity,
      estimatedDurationMs: opportunity.ttlMs,
    }
  }

  arbitrate(opportunities: RoutedOpportunity[]): ArbitrationResult {
    return arbitrate(
      opportunities,
      this.routerState,
      DEFAULT_ARBITRATION_CONFIG
    )
  }

  allocateCapital(): AllocationDecision {
    const registry = this.registryManager.getRegistry()
    return allocateCapital(
      this.routerState.totalEquity,
      registry.strategies,
      registry.states,
      this.routerState,
      DEFAULT_ALLOCATION_CONFIG
    )
  }

  checkResourceConflict(
    claim1: { marketIds: string[] },
    claim2: { marketIds: string[] }
  ): boolean {
    return checkResourceConflict(
      claim1 as ResourceClaim,
      claim2 as ResourceClaim
    )
  }

  getStrategyStats(name: string): StrategyStats | null {
    return this.registryManager.getStrategyStats(name)
  }

  getAllStrategyStats(): Map<string, StrategyStats> {
    return this.registryManager.getAllStrategyStats()
  }

  getRouterState(): RouterState {
    return this.routerState
  }

  getRegistry(): StrategyRegistry {
    return this.registryManager.getRegistry()
  }

  resetIntraday(): void {
    this.registryManager.resetIntradayStats()
    this.routerState.totalExposure = 0
    this.routerState.availableCapital = this.routerState.totalEquity
    this.routerState.lockedMarkets.clear()
    this.routerState.strategyExposures.clear()
  }

  getActiveStrategies(): StrategyConfig[] {
    return this.registryManager.getActiveStrategies()
  }

  routeAndArbitrate(
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): ArbitrationResult {
    const opportunities = this.route(feature, book, now)
    return this.arbitrate(opportunities)
  }

  selectBestOpportunity(
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): RoutedOpportunity | null {
    const result = this.routeAndArbitrate(feature, book, now)
    return result.selected
  }
}

export function createDefaultRouter(): StrategyRouter {
  return new StrategyRouter(DEFAULT_ROUTER_CONFIG)
}

export function generateStatArbOpportunity(
  signal: StatArbSignal
): Opportunity | null {
  if (signal.direction === "neutral") return null
  if (signal.evBps <= 0) return null

  return {
    id: `stat_arb-${signal.pairId}-${Date.now()}`,
    strategy: "stat_arb",
    marketIds: [signal.pairId],
    evBps: signal.evBps,
    confidence: signal.confidence,
    ttlMs: signal.ttlMs,
    createdAt: Date.now(),
  }
}

export function generateMicrostructureOpportunity(
  signal: MicrostructureSignal
): Opportunity | null {
  if (signal.direction === "neutral") return null
  if (signal.evBps <= 0) return null
  if (signal.confidence < 0.1) return null

  return {
    id: `microstructure-${signal.marketId}-${signal.ts}`,
    strategy: "microstructure",
    marketIds: [signal.marketId],
    evBps: signal.evBps,
    confidence: signal.confidence,
    ttlMs: 2_000,
    createdAt: signal.ts,
  }
}

export function generateTermOpportunity(
  spread: TermSpreadSnapshot,
  signal: TermStructureSignal
): Opportunity | null {
  if (signal.direction === "neutral") return null
  if (signal.evBps <= 0) return null

  return {
    id: `term_structure-${spread.eventId}-${spread.ts}`,
    strategy: "term_structure",
    marketIds: [signal.shortMarketId, signal.longMarketId],
    evBps: signal.evBps,
    confidence: signal.confidence,
    ttlMs: signal.ttlMs,
    createdAt: spread.ts,
  }
}
