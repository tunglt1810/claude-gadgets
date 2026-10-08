import { expect, test } from 'claude-code/testing'
import { costOf, engineGap, priceNote, readPrice, rewriteCost } from './price'

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
  // Sonnet 5.5: $10 out, $0.10 read, 1.25 x $2 write.
  expect(usd(costOf('claude-sonnet-5-5', t))).toBe(12.6)
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

test('readPrice gives the cache read price of a model, or null with no price', () => {
  expect(readPrice('claude-opus-5-5')).toBe(0.2)
  expect(readPrice('claude-sonnet-5-5')).toBe(0.1)
  // No listed read price: a tenth of the input price.
  expect(usd(readPrice('claude-sonnet-4-6'))).toBe(0.3)
  expect(readPrice('claude-haiku-4-5-20251001')).toBe(0.1)
  expect(readPrice('m')).toBeNull()
})

test('costOf prices Haiku 5.5 at its base rate', () => {
  expect(usd(costOf('claude-haiku-5-5', MTOK))).toBe(0.1)
  const t = { input: 0, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }
  // $0.50 out, $0.01 read, 1.25 x $0.10 write.
  expect(usd(costOf('claude-haiku-5-5', t))).toBe(0.635)
  expect(usd(readPrice('claude-haiku-5-5'))).toBe(0.01)
})

test('costOf prices one request with a long prompt at the long rate of its model', () => {
  // The prompt is the input, the cache reads and the cache writes: 100,001 tokens.
  const long = { input: 1, output: 1e6, cacheRead: 5e4, cacheWrite: 5e4 }
  // $0.50 in, $2.50 out, $0.05 read, 2 x $0.50 write.
  expect(usd(costOf('claude-haiku-5-5', long, '1h', true))).toBe(
    usd((1 * 0.5 + 1e6 * 2.5 + 5e4 * 0.05 + 5e4 * 1) / 1e6),
  )
  // A prompt of 100,000 tokens is not long.
  const short = { input: 0, output: 0, cacheRead: 1e5, cacheWrite: 0 }
  expect(usd(costOf('claude-haiku-5-5', short, '5m', true))).toBe(0.001)
  // Summed tokens are not one request: the base rate.
  expect(usd(costOf('claude-haiku-5-5', MTOK))).toBe(0.1)
  // A model with one rate has no long rate.
  expect(usd(costOf('claude-opus-5-5', MTOK, '5m', true))).toBe(4)
})

test('priceNote names a price that the engine counts at another rate', () => {
  expect(priceNote('claude-sonnet-5-5')).toBe('cache read $0.10/MTok, engine $0.20')
  expect(priceNote('claude-sonnet-5-5-20260901')).toBe(priceNote('claude-sonnet-5-5'))
  // The engine counts these at the listed price.
  expect(priceNote('claude-opus-5-5')).toBeNull()
  expect(priceNote('claude-sonnet-5')).toBeNull()
  expect(priceNote('m')).toBeNull()
})

test('engineGap is the cost that the engine counts over the listed price', () => {
  const t = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }
  // Sonnet 5.5: the engine counts a cache read at $0.20, and the list has $0.10.
  expect(usd(engineGap('claude-sonnet-5-5', t))).toBe(0.1)
  expect(engineGap('claude-opus-5-5', t)).toBe(0)
  expect(engineGap('m', t)).toBe(0)
})

test('a [1m] suffix does not change the price of a model', () => {
  expect(usd(costOf('claude-haiku-5-5[1m]', MTOK))).toBe(0.1)
  expect(readPrice('claude-sonnet-5-5[1M]')).toBe(0.1)
  expect(priceNote('claude-sonnet-5-5[1m]')).toBe(priceNote('claude-sonnet-5-5'))
  // Opus 5.5 is not priced as Opus 5.
  expect(usd(costOf('claude-opus-5-5[1m]', MTOK))).toBe(4)
})

test('readPrice gives the long rate for a prompt above the limit of the model', () => {
  expect(usd(readPrice('claude-haiku-5-5', 100_000))).toBe(0.01)
  expect(usd(readPrice('claude-haiku-5-5', 100_001))).toBe(0.05)
  expect(readPrice('claude-opus-5-5', 500_000)).toBe(0.2)
})

test('rewriteCost is the cost of a cache write less the cost of a cache read', () => {
  // Sonnet 5.5: a 1-hour write is 2 x $2, a 5-minute write 1.25 x $2, a read $0.10.
  expect(usd(rewriteCost('claude-sonnet-5-5', 1e6, '1h', 0))).toBe(3.9)
  expect(usd(rewriteCost('claude-sonnet-5-5', 1e6, '5m', 0))).toBe(2.4)
  // Haiku 5.5 with a long prompt: 1.25 x $0.50 less $0.05.
  expect(usd(rewriteCost('claude-haiku-5-5', 1e6, '5m', 150_000))).toBe(0.575)
  expect(usd(rewriteCost('claude-haiku-5-5', 1e6, '5m', 100_000))).toBe(0.115)
  expect(rewriteCost('m', 1e6, '5m', 0)).toBeNull()
})
