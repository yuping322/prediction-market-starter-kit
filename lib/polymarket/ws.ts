import {
  CLOB_MARKET_WS_URL,
  CLOB_USER_WS_URL,
  CLOB_WS_MAX_BACKOFF_MS,
  CLOB_WS_RECONNECT_BACKOFF_MS,
  CLOB_WS_STALE_AFTER_MS,
} from './constants'
import type { ApiCredentials } from './trading'

export type PolymarketWsChannel = 'market' | 'user'
export type PolymarketWsStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type PolymarketWsSubscription = {
  marketIds: string[]
  tokenIds: string[]
}

export type PolymarketWsHandlers = {
  onMessage?: (message: unknown) => void
  onStatusChange?: (status: PolymarketWsStatus, reason?: string) => void
  onError?: (error: Error) => void
}

export type PolymarketWsClientOptions = {
  channel: PolymarketWsChannel
  url?: string
  credentials?: ApiCredentials
  reconnectBackoffMs?: number
  maxReconnectBackoffMs?: number
  staleAfterMs?: number
  buildSubscribeMessage?: (subscription: PolymarketWsSubscription, credentials?: ApiCredentials) => unknown
} & PolymarketWsHandlers

function parseMessage(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

function defaultSubscribeMessage(
  channel: PolymarketWsChannel,
  subscription: PolymarketWsSubscription,
  credentials?: ApiCredentials,
) {
  if (channel === 'user') {
    return {
      type: 'user',
      markets: subscription.marketIds,
      market_ids: subscription.marketIds,
      asset_ids: subscription.tokenIds,
      auth: credentials,
    }
  }

  return {
    type: 'market',
    assets_ids: subscription.tokenIds,
    asset_ids: subscription.tokenIds,
    markets: subscription.marketIds,
  }
}

export class PolymarketWsClient {
  private readonly channel: PolymarketWsChannel
  private readonly url: string
  private readonly credentials?: ApiCredentials
  private readonly reconnectBackoffMs: number
  private readonly maxReconnectBackoffMs: number
  private readonly staleAfterMs: number
  private readonly handlers: PolymarketWsHandlers
  private readonly buildSubscribeMessage: (subscription: PolymarketWsSubscription, credentials?: ApiCredentials) => unknown

  private ws?: WebSocket
  private closedManually = false
  private reconnectAttempts = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private staleTimer?: ReturnType<typeof setInterval>
  private subscription?: PolymarketWsSubscription
  private lastMessageAt?: number
  private status: PolymarketWsStatus = 'disconnected'

  constructor(options: PolymarketWsClientOptions) {
    this.channel = options.channel
    this.url = options.url ?? (options.channel === 'user' ? CLOB_USER_WS_URL : CLOB_MARKET_WS_URL)
    this.credentials = options.credentials
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? CLOB_WS_RECONNECT_BACKOFF_MS
    this.maxReconnectBackoffMs = options.maxReconnectBackoffMs ?? CLOB_WS_MAX_BACKOFF_MS
    this.staleAfterMs = options.staleAfterMs ?? CLOB_WS_STALE_AFTER_MS
    this.handlers = options
    this.buildSubscribeMessage =
      options.buildSubscribeMessage ??
      ((subscription, credentials) => defaultSubscribeMessage(this.channel, subscription, credentials))
  }

  getLastMessageAt(): number | undefined {
    return this.lastMessageAt
  }

  getStatus(): PolymarketWsStatus {
    return this.status
  }

  async connect(subscription?: PolymarketWsSubscription): Promise<void> {
    if (subscription) {
      this.subscription = subscription
    }

    this.closedManually = false
    await this.open(this.status === 'connected' ? 'connected' : 'connecting')
  }

  async disconnect(): Promise<void> {
    this.closedManually = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.staleTimer) clearInterval(this.staleTimer)
    this.reconnectTimer = undefined
    this.staleTimer = undefined

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'client_disconnect')
    }

    this.ws = undefined
    this.setStatus('disconnected')
  }

  async updateSubscription(subscription: PolymarketWsSubscription): Promise<void> {
    this.subscription = subscription
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send(this.buildSubscribeMessage(subscription, this.credentials))
    }
  }

  private async open(nextStatus: 'connecting' | 'reconnecting' | 'connected'): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    await new Promise<void>((resolve, reject) => {
      let settled = false
      this.setStatus(nextStatus)
      this.ws = new WebSocket(this.url)

      this.ws.addEventListener('open', () => {
        this.reconnectAttempts = 0
        this.lastMessageAt = Date.now()
        this.setStatus('connected')
        this.startStaleMonitor()
        if (this.subscription) {
          this.send(this.buildSubscribeMessage(this.subscription, this.credentials))
        }
        settled = true
        resolve()
      })

      this.ws.addEventListener('message', (event) => {
        this.lastMessageAt = Date.now()
        if (typeof event.data === 'string') {
          this.handlers.onMessage?.(parseMessage(event.data))
        }
      })

      this.ws.addEventListener('close', (event) => {
        if (this.staleTimer) clearInterval(this.staleTimer)
        this.staleTimer = undefined
        this.setStatus(this.closedManually ? 'disconnected' : 'reconnecting', event.reason || 'socket_closed')
        if (!this.closedManually) {
          this.scheduleReconnect()
        }
        if (!settled) {
          settled = true
          reject(new Error(`${this.channel} websocket closed before open: ${event.reason || 'unknown'}`))
        }
      })

      this.ws.addEventListener('error', () => {
        this.setStatus('error', 'socket_error')
        this.handlers.onError?.(new Error(`${this.channel} websocket error`))
      })
    })
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(payload))
  }

  private scheduleReconnect(): void {
    if (this.closedManually) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    const delay = Math.min(this.reconnectBackoffMs * 2 ** this.reconnectAttempts, this.maxReconnectBackoffMs)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      void this.open('reconnecting').catch((error) => {
        this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
        this.scheduleReconnect()
      })
    }, delay)
  }

  private startStaleMonitor(): void {
    if (this.staleTimer) clearInterval(this.staleTimer)
    this.staleTimer = setInterval(() => {
      if (!this.lastMessageAt || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastMessageAt <= this.staleAfterMs) return
      this.ws.close(4000, 'stale_socket')
    }, Math.max(1_000, Math.floor(this.staleAfterMs / 2)))
  }

  private setStatus(status: PolymarketWsStatus, reason?: string): void {
    this.status = status
    this.handlers.onStatusChange?.(status, reason)
  }
}
