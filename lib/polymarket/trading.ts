import { ClobClient, type CreateOrderOptions, OrderType, Side, type TickSize } from '@polymarket/clob-client'
import { BuilderConfig } from '@polymarket/builder-signing-sdk'
import type { Wallet, providers } from 'ethers'
import { CHAIN_ID, CLOB_URL } from './constants'

export type TradeTimeInForce = 'GTC' | 'IOC' | 'FOK'

export type TradeParams = {
  tokenId: string
  side: 'yes' | 'no'
  action: 'buy' | 'sell'
  amount: number
  price: number
  tif?: TradeTimeInForce
  expiration?: number
  feeRateBps?: number
  tickSize?: TickSize
  negRisk?: boolean
}

export type IntentLike = {
  tokenId: string
  action: 'buy' | 'sell'
  limitPrice: number
  size: number
  tif: TradeTimeInForce
  expiresAt: number
}

export type ApiCredentials = {
  key: string
  secret: string
  passphrase: string
}

export type TradingClientOptions = {
  funderAddress?: string
  signatureType?: number
  builderUrl?: string
  useServerTime?: boolean
}

export type ClobOrderOptions = {
  tickSize?: TickSize
  negRisk?: boolean
  feeRateBps?: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const REMOTE_SIGNING_URL = (override?: string) => {
  if (override) return override
  if (typeof window !== 'undefined') return `${window.location.origin}/api/builder-sign`
  return '/api/builder-sign'
}

export async function getOrCreateApiCredentials(
  ethersSigner: Wallet | providers.JsonRpcSigner,
): Promise<ApiCredentials> {
  const tempClient = new ClobClient(CLOB_URL, CHAIN_ID, ethersSigner)

  const derived = await tempClient.deriveApiKey().catch(() => null)
  if (derived?.key && derived?.secret && derived?.passphrase) {
    return derived
  }

  return tempClient.createApiKey()
}

export function createTradingClient(
  ethersSigner: Wallet | providers.JsonRpcSigner,
  apiCreds: ApiCredentials,
  safeAddressOrOptions?: string | TradingClientOptions,
) {
  const options =
    typeof safeAddressOrOptions === 'string'
      ? { funderAddress: safeAddressOrOptions, signatureType: 2 }
      : (safeAddressOrOptions ?? {})

  const builderConfig = new BuilderConfig({
    remoteBuilderConfig: {
      url: REMOTE_SIGNING_URL(options.builderUrl),
    },
  })

  return new ClobClient(
    CLOB_URL,
    CHAIN_ID,
    ethersSigner,
    apiCreds,
    options.signatureType ?? 2,
    options.funderAddress,
    undefined,
    options.useServerTime ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builderConfig as any,
  )
}

function mapTimeInForceToOrderType(tif: TradeTimeInForce): OrderType {
  switch (tif) {
    case 'IOC':
      return OrderType.FAK
    case 'FOK':
      return OrderType.FOK
    default:
      return OrderType.GTC
  }
}

async function resolveCreateOrderOptions(
  client: ClobClient,
  tokenId: string,
  overrides?: ClobOrderOptions,
): Promise<CreateOrderOptions> {
  const [tickSize, negRisk] = await Promise.all([
    overrides?.tickSize ? Promise.resolve(overrides.tickSize) : client.getTickSize(tokenId),
    overrides?.negRisk !== undefined ? Promise.resolve(overrides.negRisk) : client.getNegRisk(tokenId),
  ])

  return {
    tickSize,
    negRisk,
  }
}

async function postLimitOrder(
  client: ClobClient,
  params: {
    tokenId: string
    price: number
    size: number
    action: 'buy' | 'sell'
    tif: TradeTimeInForce
    expiration?: number
    feeRateBps?: number
  },
  overrides?: ClobOrderOptions,
) {
  const orderType = mapTimeInForceToOrderType(params.tif)
  const order = await client.createOrder(
    {
      tokenID: params.tokenId,
      price: params.price,
      size: params.size,
      side: params.action === 'sell' ? Side.SELL : Side.BUY,
      feeRateBps: params.feeRateBps ?? overrides?.feeRateBps ?? 0,
      expiration: params.expiration,
      taker: ZERO_ADDRESS,
    },
    await resolveCreateOrderOptions(client, params.tokenId, overrides),
  )

  return client.postOrder(order, orderType)
}

export async function placeOrder(client: ClobClient, params: TradeParams) {
  if (Number.isNaN(params.price) || Number.isNaN(params.amount) || params.price <= 0 || params.amount <= 0) {
    throw new Error(`Invalid order params: price=${params.price}, amount=${params.amount}`)
  }

  return postLimitOrder(
    client,
    {
      tokenId: params.tokenId,
      price: params.price,
      size: params.amount,
      action: params.action,
      tif: params.tif ?? 'GTC',
      expiration: params.expiration,
      feeRateBps: params.feeRateBps,
    },
    {
      tickSize: params.tickSize,
      negRisk: params.negRisk,
      feeRateBps: params.feeRateBps,
    },
  )
}

export async function placeIntentOrder(client: ClobClient, intent: IntentLike, options?: ClobOrderOptions) {
  return postLimitOrder(
    client,
    {
      tokenId: intent.tokenId,
      price: intent.limitPrice,
      size: intent.size,
      action: intent.action,
      tif: intent.tif,
      expiration: intent.expiresAt > 0 ? Math.floor(intent.expiresAt / 1000) : undefined,
      feeRateBps: options?.feeRateBps,
    },
    options,
  )
}

export async function getOpenOrders(client: ClobClient) {
  return client.getOpenOrders()
}

export async function getOrderById(client: ClobClient, orderId: string) {
  return client.getOrder(orderId)
}

export async function cancelOrder(client: ClobClient, orderId: string) {
  return client.cancelOrder({ orderID: orderId })
}

export async function cancelAllOrders(client: ClobClient) {
  return client.cancelAll()
}
