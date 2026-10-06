import { expect, test } from 'claude-code/testing'
import { emptySnapshot } from './snapshot'
import { addUsage, advised, cacheHitPct, emptyTotals, rebased, restOf, settled } from './usage'

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

const NONE = { calls: 0, ms: 0, usd: 0, base: 0 }

test('advised counts the advisor calls of a step and their time', () => {
  const uses = [
    { name: 'advisor', startedAt: 100, endedAt: 600 },
    { name: 'web_search', startedAt: 100, endedAt: 900 },
    // The response ended before the result: a call with no time.
    { name: 'advisor', startedAt: 700 },
  ]
  expect(advised({ ...NONE, calls: 1, ms: 50 }, uses, 'opus')).toEqual({
    calls: 3,
    ms: 550,
    usd: 0,
    base: 0,
    model: 'opus',
    pending: true,
  })
  // No advisor call: nothing changes. No model in the settings: the earlier one stays.
  const a = { ...NONE, model: 'opus' }
  expect(advised(a, [], 'sonnet')).toBe(a)
  expect(advised(a, uses, undefined).model).toBe('opus')
})

test('advised: a call with no result is counted and has no cost to settle', () => {
  const failed = [{ name: 'advisor', startedAt: 700 }]
  expect(advised(NONE, failed, 'opus')).toEqual({ ...NONE, calls: 1, model: 'opus' })
})

test('settled takes the growth of the rest since the turn started as the cost of the advisor', () => {
  const advisor = { calls: 1, ms: 9, usd: 0.5, base: 0.25, pending: true as const }
  const snap = { ...emptySnapshot(), advisor, costByModel: { m: 6.75 } }
  // The ledger does not hold the call yet: the rest did not grow.
  expect(settled({ ...snap, costUsd: 6.5 })).toBe(advisor)
  // It does: the rest went from 0.25 to 0.88, and 0.63 of it is the advisor's.
  const s = settled({ ...snap, costUsd: 7.63 })
  expect(s.pending).toBeUndefined()
  expect(Math.round(s.usd * 1e6)).toBe(1_130_000)
  expect(Math.round(s.base * 1e6)).toBe(880_000)
  // No call to settle: a side request is not the advisor's.
  const idle = { ...snap, advisor: { ...NONE, base: 0.25 }, costUsd: 7.63 }
  expect(settled(idle)).toBe(idle.advisor)
})

test('rebased takes the rest at the start of a turn, unless a call is still to settle', () => {
  const snap = { ...emptySnapshot(), costUsd: 5, costByModel: { m: 4 } }
  expect(rebased(snap).base).toBe(1)
  const waiting = { ...snap, advisor: { ...NONE, base: 2, pending: true as const } }
  expect(rebased(waiting)).toBe(waiting.advisor)
})

test('restOf is the ledger cost that no step holds', () => {
  expect(restOf({ costUsd: 5, costByModel: { a: 3, b: 1.5 } })).toBe(0.5)
})
