export type PaperPosition = {
  marketId: string
  side: 'YES' | 'NO'
  size: number
  avgEntry: number
  currentPrice: number
  unrealizedPnl: number
}

export type PaperOrder = {
  id: string
  ts: number
  marketId: string
  side: 'YES' | 'NO'
  action: 'BUY' | 'SELL'
  price: number
  size: number
  status: 'FILLED' | 'PARTIAL' | 'REJECTED'
  filledSize: number
  pnl: number
}

export class PaperPortfolio {
  initialEquity: number
  cashBalance: number
  positions: Map<string, PaperPosition> = new Map()
  orders: PaperOrder[] = []
  peakEquity: number

  constructor(initialEquity = 10_000) {
    this.initialEquity = initialEquity
    this.cashBalance = initialEquity
    this.peakEquity = initialEquity
  }

  get equity(): number {
    let posValue = 0
    for (const pos of this.positions.values()) {
      posValue += pos.size * pos.currentPrice
    }
    return this.cashBalance + posValue
  }

  get totalPnl(): number {
    return this.equity - this.initialEquity
  }

  get drawdownPct(): number {
    if (this.peakEquity <= 0) return 0
    return ((this.peakEquity - this.equity) / this.peakEquity) * 100
  }

  get openNotional(): number {
    let total = 0
    for (const pos of this.positions.values()) {
      total += pos.size * pos.currentPrice
    }
    return total
  }

  /**
   * Execute a paper trade: deduct cash, update position, record order.
   */
  executeTrade(
    marketId: string,
    side: 'YES' | 'NO',
    price: number,
    size: number,
    ts: number,
  ): PaperOrder {
    const cost = price * size
    if (cost > this.cashBalance) {
      const affordable = Math.floor((this.cashBalance / price) * 100) / 100
      if (affordable <= 0) {
        const order: PaperOrder = {
          id: `paper-${this.orders.length + 1}`,
          ts,
          marketId,
          side,
          action: 'BUY',
          price,
          size,
          status: 'REJECTED',
          filledSize: 0,
          pnl: 0,
        }
        this.orders.push(order)
        return order
      }
      size = affordable
    }

    const actualCost = price * size
    this.cashBalance -= actualCost

    const key = `${marketId}:${side}`
    const existing = this.positions.get(key)
    if (existing) {
      const totalSize = existing.size + size
      existing.avgEntry = (existing.avgEntry * existing.size + price * size) / totalSize
      existing.size = totalSize
      existing.currentPrice = price
    } else {
      this.positions.set(key, {
        marketId,
        side,
        size,
        avgEntry: price,
        currentPrice: price,
        unrealizedPnl: 0,
      })
    }

    const order: PaperOrder = {
      id: `paper-${this.orders.length + 1}`,
      ts,
      marketId,
      side,
      action: 'BUY',
      price,
      size,
      status: 'FILLED',
      filledSize: size,
      pnl: 0,
    }
    this.orders.push(order)

    if (this.equity > this.peakEquity) {
      this.peakEquity = this.equity
    }

    return order
  }

  /**
   * Update mark prices for all positions and compute unrealized P&L.
   */
  markToMarket(marketId: string, yesPrice: number, noPrice: number): void {
    const yesPos = this.positions.get(`${marketId}:YES`)
    if (yesPos) {
      yesPos.currentPrice = yesPrice
      yesPos.unrealizedPnl = (yesPrice - yesPos.avgEntry) * yesPos.size
    }
    const noPos = this.positions.get(`${marketId}:NO`)
    if (noPos) {
      noPos.currentPrice = noPrice
      noPos.unrealizedPnl = (noPrice - noPos.avgEntry) * noPos.size
    }
  }

  /**
   * Compute guaranteed arb profit from hedged YES+NO positions.
   * If you hold both YES and NO on the same market, the hedged portion
   * pays $1 at settlement while costing (yesEntry + noEntry) < $1.
   */
  get lockedArbProfit(): number {
    const marketIds = new Set<string>()
    for (const pos of this.positions.values()) {
      marketIds.add(pos.marketId)
    }
    let profit = 0
    for (const mid of marketIds) {
      const yesPos = this.positions.get(`${mid}:YES`)
      const noPos = this.positions.get(`${mid}:NO`)
      if (yesPos && noPos) {
        const hedgedSize = Math.min(yesPos.size, noPos.size)
        const costPerPair = yesPos.avgEntry + noPos.avgEntry
        // Each hedged pair pays $1 at settlement, cost was < $1
        profit += hedgedSize * (1 - costPerPair)
      }
    }
    return profit
  }

  snapshot(): {
    equity: number
    cash: number
    positionCount: number
    openNotional: number
    totalPnl: number
    lockedArbProfit: number
    drawdownPct: number
    orderCount: number
    fillCount: number
  } {
    return {
      equity: this.equity,
      cash: this.cashBalance,
      positionCount: this.positions.size,
      openNotional: this.openNotional,
      totalPnl: this.totalPnl,
      lockedArbProfit: this.lockedArbProfit,
      drawdownPct: this.drawdownPct,
      orderCount: this.orders.length,
      fillCount: this.orders.filter((o) => o.status === 'FILLED').length,
    }
  }
}
