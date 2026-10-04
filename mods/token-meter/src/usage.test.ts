import { expect, test } from 'claude-code/testing'
import { addUsage, cacheHitPct, emptyTotals } from './usage'

test('addUsage accumulates and ignores null / missing fields', () => {
  let t = addUsage(emptyTotals(), {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 80,
    cache_creation_input_tokens: 10,
  })
  t = addUsage(t, null)
  t = addUsage(t, { output_tokens: 7 })
  expect(t).toEqual({ input: 10, output: 12, cacheRead: 80, cacheWrite: 10 })
})

test('cacheHitPct = cacheRead / (input + cacheRead + cacheWrite), 0 when empty', () => {
  expect(cacheHitPct(emptyTotals())).toBe(0)
  expect(cacheHitPct({ input: 10, output: 0, cacheRead: 80, cacheWrite: 10 })).toBe(80)
})
