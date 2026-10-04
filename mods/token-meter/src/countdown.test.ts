import { expect, test } from 'claude-code/testing'
import { cacheHitTone, countdownTone, remainingMs, ttlMs } from './countdown'

test('ttlMs', () => {
  expect(ttlMs('5m')).toBe(300000)
  expect(ttlMs('1h')).toBe(3600000)
})

test('remainingMs: null before any step, negative once past the TTL', () => {
  expect(remainingMs(null, 1000, 300000)).toBeNull()
  expect(remainingMs(0, 100000, 300000)).toBe(200000)
  expect(remainingMs(0, 400000, 300000)).toBe(-100000)
})

test('countdownTone thresholds', () => {
  expect(countdownTone(120000)).toBe('ok')
  expect(countdownTone(60000)).toBe('warn')
  expect(countdownTone(14999)).toBe('danger')
  expect(countdownTone(0)).toBe('expired')
  expect(countdownTone(null)).toBe('expired')
})

test('cacheHitTone thresholds', () => {
  expect([90, 70, 69, 40, 39].map(cacheHitTone)).toEqual(['ok', 'ok', 'warn', 'warn', 'danger'])
})
