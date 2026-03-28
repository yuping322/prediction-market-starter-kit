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
  totalSlippageCost = 0

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
   * Execute a paper trade with realistic slippage and partial fill simulation.
   *
   * @param slippageBps  - Extra cost in basis points applied to execution price (default 50)
   * @param fillBaseRate - Base probability of getting filled (default 0.5)
   * @param fillSizeDecay - How much fill rate drops per unit of size (default 0.001)
   */
  executeTrade(
    marketId: string,
    side: 'YES' | 'NO',
    price: number,
    size: number,
    ts: number,
    slippageBps = 50,
    fillBaseRate = 0.5,
    fillSizeDecay = 0.001,
  ): PaperOrder {
    // Apply slippage: buying costs more
    const slippageMultiplier = 1 + slippageBps / 10_000
    const execPrice = Math.min(0.99, price * slippageMultiplier)
    const slippageCost = (execPrice - price) * size
    this.totalSlippageCost += Math.max(0, slippageCost)

    // Partial fill: larger orders fill less reliably
    const fillRate = Math.max(0.1, fillBaseRate - size * fillSizeDecay)
    const filledSize = Math.round(size * fillRate * 100) / 100

    const cost = execPrice * filledSize
    if (cost > this.cashBalance) {
      const affordable = Math.floor((this.cashBalance / execPrice) * 100) / 100
      if (affordable <= 0) {
        const order: PaperOrder = {
          id: `paper-${this.orders.length + 1}`,
          ts,
          marketId,
          side,
          action: 'BUY',
          price: execPrice,
          size,
          status: 'REJECTED',
          filledSize: 0,
          pnl: 0,
        }
        this.orders.push(order)
        return order
      }
      return this.recordFill(marketId, side, execPrice, affordable, size, ts)
    }

    return this.recordFill(marketId, side, execPrice, filledSize, size, ts)
  }

  private recordFill(
    marketId: string,
    side: 'YES' | 'NO',
    execPrice: number,
    filledSize: number,
    requestedSize: number,
    ts: number,
  ): PaperOrder {
    const actualCost = execPrice * filledSize
    this.cashBalance -= actualCost

    const key = `${marketId}:${side}`
    const existing = this.positions.get(key)
    if (existing) {
      const totalSize = existing.size + filledSize
      existing.avgEntry = (existing.avgEntry * existing.size + execPrice * filledSize) / totalSize
      existing.size = totalSize
      existing.currentPrice = execPrice
    } else {
      this.positions.set(key, {
        marketId,
        side,
        size: filledSize,
        avgEntry: execPrice,
        currentPrice: execPrice,
        unrealizedPnl: 0,
      })
    }

    const isPartial = filledSize < requestedSize * 0.99
    const order: PaperOrder = {
      id: `paper-${this.orders.length + 1}`,
      ts,
      marketId,
      side,
      action: 'BUY',
      price: execPrice,
      size: requestedSize,
      status: isPartial ? 'PARTIAL' : 'FILLED',
      filledSize,
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
    totalSlippageCost: number
    drawdownPct: number
    orderCount: number
    fillCount: number
    partialCount: number
  } {
    return {
      equity: this.equity,
      cash: this.cashBalance,
      positionCount: this.positions.size,
      openNotional: this.openNotional,
      totalPnl: this.totalPnl,
      lockedArbProfit: this.lockedArbProfit,
      totalSlippageCost: this.totalSlippageCost,
      drawdownPct: this.drawdownPct,
      orderCount: this.orders.length,
      fillCount: this.orders.filter((o) => o.status === 'FILLED').length,
      partialCount: this.orders.filter((o) => o.status === 'PARTIAL').length,
    }
  }
}
