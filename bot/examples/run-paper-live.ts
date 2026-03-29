import { createLiveEngine } from '../core/run-live-engine'
import { getApprovedRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import { buildTokenMap, type MarketSubscription } from '../integration/exchange'
import { PolymarketPaperAdapter } from '../integration/polymarket-paper'
import { fetchValidationMarkets } from '../integration/real-data'

function resolveRunMs(): number {
  const value = Number(process.env.POLYMARKET_RUN_MS ?? '30000')
  return Number.isFinite(value) && value > 0 ? value : 30000
}

async function resolveSubscription(): Promise<{ subscription: MarketSubscription; source: 'env' | 'gamma' }> {
  const marketId = process.env.POLYMARKET_MARKET_ID
  const yesTokenId = process.env.POLYMARKET_YES_TOKEN_ID
  const noTokenId = process.env.POLYMARKET_NO_TOKEN_ID

  if (marketId && yesTokenId && noTokenId) {
    return {
      source: 'env',
      subscription: {
        marketId,
        tokenMap: buildTokenMap(marketId, yesTokenId, noTokenId),
      },
    }
  }

  const markets = await fetchValidationMarkets(25)
  const selected = marketId ? markets.find((market) => market.marketId === marketId) : markets[0]
  if (!selected) {
    throw new Error('Unable to resolve a Polymarket market for paper-live run')
  }

  return {
    source: 'gamma',
    subscription: {
      marketId: selected.marketId,
      tokenMap: buildTokenMap(
        selected.marketId,
        yesTokenId ?? selected.tokenMap.yesTokenId,
        noTokenId ?? selected.tokenMap.noTokenId,
      ),
    },
  }
}

function buildPaperRuntime(): Partial<RuntimeConfig> {
  return {
    modeDefaults: {
      executionMode: 'paper',
      confidenceFilterEnabled: false,
    },
    execution: {
      passiveFillRatio: 1,
      hedgeFillRatio: 1,
      priceImprovementBps: 4,
      passivePriceOffset: 0.002,
      allowIocHedge: true,
    },
  }
}

async function main(): Promise<void> {
  const runMs = resolveRunMs()
  const resolved = await resolveSubscription()
  const runtime = getApprovedRuntimeConfig(buildPaperRuntime())
  const adapter = new PolymarketPaperAdapter({ runtime })
  const engine = createLiveEngine(adapter, [resolved.subscription], buildPaperRuntime())

  console.log(
    JSON.stringify(
      {
        source: 'paper-live',
        resolution: resolved.source,
        marketId: resolved.subscription.marketId,
        tokenMap: resolved.subscription.tokenMap,
        runMs,
      },
      null,
      2,
    ),
  )

  await engine.start()

  const timer = setTimeout(async () => {
    await engine.stop()
    console.log(JSON.stringify(engine.getSnapshot(), null, 2))
    process.exit(0)
  }, runMs)

  process.on('SIGINT', async () => {
    clearTimeout(timer)
    await engine.stop()
    console.log(JSON.stringify(engine.getSnapshot(), null, 2))
    process.exit(0)
  })
}

void main()
