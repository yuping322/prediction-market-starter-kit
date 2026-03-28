import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { PaperPosition, PaperOrder } from './portfolio'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '..', 'data')
const SESSION_PATH = resolve(DATA_DIR, 'session.json')

export type SessionData = {
  wallet: {
    address: string
    safeAddress: string
    privateKey: string
  }
  updatedAt: string
  portfolio: {
    initialEquity: number
    cash: number
    equity: number
    peakEquity: number
  }
  positions: PaperPosition[]
  orders: PaperOrder[]
  stats: {
    totalTrades: number
    fillRate: number
    totalArbProfit: number
    totalSlippageCost: number
    sessionsRun: number
  }
}

export function saveSession(data: SessionData): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(SESSION_PATH, JSON.stringify(data, null, 2), 'utf8')
}

export function loadSession(): SessionData | null {
  try {
    const raw = readFileSync(SESSION_PATH, 'utf8')
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

export function getSessionPath(): string {
  return SESSION_PATH
}
