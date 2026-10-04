import { expect, test } from 'claude-code/testing'
import { emptySnapshot } from './snapshot'
import {
  countsOf,
  isSettled,
  retarget,
  retargetShown,
  shownAt,
  snapShown,
  TWEEN_MS,
  valueAt,
} from './tween'

const counts = { in: 100, out: 10, tools: 1, cost: 0.5, added: 4, removed: 2 }

test('a tween starts at `from` and ends at `to`', () => {
  const t = { from: 100, to: 200, startedAt: 1000 }
  expect(valueAt(t, 1000)).toBe(100)
  expect(valueAt(t, 1000 + TWEEN_MS)).toBe(200)
  expect(valueAt(t, 9999)).toBe(200)
})

test('a tween eases out: it is past the linear half at half time and never overshoots', () => {
  const t = { from: 100, to: 200, startedAt: 0 }
  const mid = valueAt(t, TWEEN_MS / 2)
  expect(mid).toBeGreaterThan(150)
  expect(mid).toBeLessThan(200)
})

test('a new target continues from the displayed value, not from the old target', () => {
  const t = { from: 100, to: 200, startedAt: 0 }
  const at = TWEEN_MS / 2
  const next = retarget(t, 300, at)
  expect(next).toEqual({ from: valueAt(t, at), to: 300, startedAt: at })
})

test('the same target does not restart the tween', () => {
  const t = { from: 100, to: 200, startedAt: 0 }
  expect(retarget(t, 200, 150)).toBe(t)
})

test('counts are the numbers the band animates; `in` is every prompt token', () => {
  const s = {
    ...emptySnapshot(),
    totals: { input: 10, output: 5, cacheRead: 80, cacheWrite: 10 },
    tools: 3,
    costUsd: 0.25,
    added: 7,
    removed: 2,
  }
  expect(countsOf(s)).toEqual({ in: 100, out: 5, tools: 3, cost: 0.25, added: 7, removed: 2 })
})

test('a snapped value shows its target immediately', () => {
  const s = snapShown('S1', counts)
  expect(s.sessionId).toBe('S1')
  expect(shownAt(s, 0)).toEqual(counts)
  expect(isSettled(s, 0)).toBe(true)
})

test('a change in the same session tweens; integers are rounded and cost is not', () => {
  const s = retargetShown(snapShown('S1', counts), 'S1', { ...counts, in: 200, cost: 1.5 }, 1000)
  expect(isSettled(s, 1000)).toBe(false)
  expect(shownAt(s, 1000)).toEqual(counts)
  const mid = shownAt(s, 1000 + TWEEN_MS / 2)
  expect(Number.isInteger(mid.in)).toBe(true)
  expect(mid.in).toBeGreaterThan(100)
  expect(mid.in).toBeLessThan(200)
  expect(mid.cost).toBeGreaterThan(0.5)
  expect(mid.cost).toBeLessThan(1.5)
  expect(mid.out).toBe(10)
  expect(shownAt(s, 1000 + TWEEN_MS)).toEqual({ ...counts, in: 200, cost: 1.5 })
  expect(isSettled(s, 1000 + TWEEN_MS)).toBe(true)
})

test('a change for a different session snaps: no count-up from the other session', () => {
  const s = retargetShown(snapShown('S1', counts), 'S2', { ...counts, in: 900 }, 1000)
  expect(s.sessionId).toBe('S2')
  expect(shownAt(s, 1000).in).toBe(900)
})
