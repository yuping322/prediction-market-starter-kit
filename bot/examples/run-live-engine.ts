import { Wallet, providers } from 'ethers'
import { createLiveEngine } from '../core/run-live-engine'
import { buildTokenMap, type MarketSubscription } from '../integration/exchange'
import { PolymarketLiveAdapter } from '../integration/polymarket-live'

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

async function main(): Promise<void> {
  const privateKey = getRequiredEnv('POLYMARKET_PRIVATE_KEY')
  const rpcUrl = getRequiredEnv('POLYGON_RPC_URL')
  const funderAddress = getRequiredEnv('POLYMARKET_FUNDER_ADDRESS')
  const apiKey = getRequiredEnv('POLYMARKET_API_KEY')
  const apiSecret = getRequiredEnv('POLYMARKET_API_SECRET')
  const apiPassphrase = getRequiredEnv('POLYMARKET_API_PASSPHRASE')
  const marketId = getRequiredEnv('POLYMARKET_MARKET_ID')
  const yesTokenId = getRequiredEnv('POLYMARKET_YES_TOKEN_ID')
  const noTokenId = getRequiredEnv('POLYMARKET_NO_TOKEN_ID')
  const builderUrl = process.env.POLYMARKET_BUILDER_URL
  const runMs = Number(process.env.POLYMARKET_RUN_MS ?? '30000')

  const provider = new providers.JsonRpcProvider(rpcUrl)
  const signer = new Wallet(privateKey, provider)
  const subscription: MarketSubscription = {
    marketId,
    tokenMap: buildTokenMap(marketId, yesTokenId, noTokenId),
  }

  const adapter = new PolymarketLiveAdapter({
    signer,
    apiCreds: {
      key: apiKey,
      secret: apiSecret,
      passphrase: apiPassphrase,
    },
    funderAddress,
    builderUrl,
  })

  const engine = createLiveEngine(adapter, [subscription])
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
