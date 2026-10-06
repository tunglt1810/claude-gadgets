import { expect, test } from 'claude-code/testing'
import { costOf } from './price'

// Dollars rounded to a millionth: float sums are not exact.
const usd = (n: number | null): number => Math.round((n ?? Number.NaN) * 1e6) / 1e6

const MTOK = { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }

test('costOf prices tokens by the longest matching model id', () => {
  // Opus 5.5 is $4 in, not Opus 5's $5: the longer id wins.
  expect(usd(costOf('claude-opus-5-5', MTOK))).toBe(4)
  expect(usd(costOf('claude-opus-5', MTOK))).toBe(5)
  // A dated id is priced as its model.
  expect(usd(costOf('claude-haiku-4-5-20251001', MTOK))).toBe(1)
})

test('costOf prices output, cache reads and 5-minute cache writes', () => {
  const t = { input: 0, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }
  // Sonnet 5.5: $10 out, $0.20 read, 1.25 x $2 write.
  expect(usd(costOf('claude-sonnet-5-5', t))).toBe(12.7)
  // Haiku 4.5 has no listed read price: 0.1 x its input.
  expect(usd(costOf('claude-haiku-4-5', { ...t, output: 0, cacheWrite: 0 }))).toBe(0.1)
})

test('costOf has no price for an unknown model', () => {
  expect(costOf('gpt-x', MTOK)).toBeNull()
})

test('costOf prices 1-hour cache writes at 2 x input', () => {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 1e6 }
  expect(usd(costOf('claude-sonnet-5-5', t, '1h'))).toBe(4)
  expect(usd(costOf('claude-sonnet-5-5', t, '5m'))).toBe(2.5)
})
