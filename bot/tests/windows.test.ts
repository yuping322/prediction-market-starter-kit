import test from 'node:test'
import assert from 'node:assert/strict'
import { rollingMean, rollingStd } from '../features/windows'

test('rollingMean returns expected value', () => {
  assert.equal(rollingMean([1, 2, 3, 4], 2), 3.5)
})

test('rollingStd handles constant values', () => {
  assert.equal(rollingStd([2, 2, 2, 2], 4), 0)
})
