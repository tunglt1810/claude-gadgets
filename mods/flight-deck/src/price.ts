import type { Totals } from '../types'

// First-party API prices in US dollars per million tokens, as Anthropic lists them
// (2026-09-25). `read` is the cache read price where it is not 0.1 x `input`. A cache write is
// priced at the 5-minute rate, 1.25 x `input`. Update this table when the prices change.
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

// The estimated cost of a model's tokens, or null for a model with no price. The longest
// matching id wins: `claude-opus-5-5` is not priced as `claude-opus-5`.
export const costOf = (model: string, t: Totals): number | null => {
  const id = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0]
  const p = id === undefined ? undefined : PRICES[id]
  if (p === undefined) return null
  const read = p.read ?? p.input * 0.1
  return (
    (t.input * p.input + t.output * p.output + t.cacheRead * read + t.cacheWrite * p.input * 1.25) /
    1e6
  )
}
