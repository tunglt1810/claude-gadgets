import type { Totals } from '../types'
import type { Ttl } from './ttl'

// First-party API prices in US dollars per million tokens, as Anthropic lists them
// (2026-09-25). `read` is the cache read price where it is not 0.1 x `input`. A cache write
// costs 1.25 x `input` for 5 minutes, 2 x for 1 hour. Update this table when the prices change.
const PRICES: Record<string, { input: number; output: number; read?: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

// The price row of a model, or undefined for a model with no price. The longest matching id
// wins: `claude-opus-5-5` is not priced as `claude-opus-5`.
const priceOf = (model: string) => {
  const id = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0]
  return id === undefined ? undefined : PRICES[id]
}

// The cache read price of a model in US dollars per million tokens, or null with no price.
export const readPrice = (model: string): number | null => {
  const p = priceOf(model)
  return p === undefined ? null : (p.read ?? p.input * 0.1)
}

// The estimated cost of a model's tokens, or null for a model with no price.
export const costOf = (model: string, t: Totals, ttl: Ttl = '5m'): number | null => {
  const p = priceOf(model)
  const read = readPrice(model)
  if (p === undefined || read === null) return null
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * read +
      t.cacheWrite * p.input * (ttl === '1h' ? 2 : 1.25)) /
    1e6
  )
}
