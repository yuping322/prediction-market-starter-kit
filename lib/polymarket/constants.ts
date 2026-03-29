export const CHAIN_ID = 137

export const CLOB_URL = 'https://clob.polymarket.com'
export const CLOB_MARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
export const CLOB_USER_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/user'
export const CLOB_WS_RECONNECT_BACKOFF_MS = 1_500
export const CLOB_WS_MAX_BACKOFF_MS = 15_000
export const CLOB_WS_STALE_AFTER_MS = 20_000
export const RELAYER_URL = 'https://relayer-v2.polymarket.com/'

export const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const
export const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' as const
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' as const
export const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a' as const
export const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296' as const

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const
