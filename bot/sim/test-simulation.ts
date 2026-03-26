import assert from 'node:assert/strict'
import { runSimulation } from './run-simulation'

const result = runSimulation()

assert.ok(result.opportunities > 0, 'should detect opportunities')
assert.ok(result.executed > 0, 'should execute opportunities')
assert.ok(result.completionRate > 0 && result.completionRate <= 1, 'completionRate out of range')
assert.ok(Number.isFinite(result.totalPnl), 'pnl should be finite')
assert.ok(Number.isFinite(result.mcMean), 'mc mean should be finite')
assert.ok(Number.isFinite(result.mcP05), 'mc p05 should be finite')

console.log('simulation-test-pass', result)
