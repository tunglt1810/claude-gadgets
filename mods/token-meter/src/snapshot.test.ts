import { expect, test } from 'claude-code/testing'
import { emptySnapshot, isComplete, parseSnapshot, storeKey, touchSessions } from './snapshot'

test('storeKey is per session id', () => {
  expect(storeKey('abc')).toBe('session:abc')
})

test('parseSnapshot: undefined / garbage -> empty', () => {
  expect(parseSnapshot(undefined)).toEqual(emptySnapshot())
  expect(parseSnapshot('x')).toEqual(emptySnapshot())
  expect(
    parseSnapshot({
      totals: { input: 'a' },
      tools: 'b',
      lastStepAt: 'c',
      workMs: 'd',
      costUsd: 'e',
      added: 'f',
      removed: null,
    }),
  ).toEqual(emptySnapshot())
})

test('parseSnapshot keeps valid data', () => {
  const s = {
    totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    tools: 5,
    lastStepAt: 600,
    workMs: 7000,
    costUsd: 1.25,
    added: 8,
    removed: 9,
  }
  expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
})

test('isComplete: state written before a field existed, or holding NaN, is not complete', () => {
  expect(isComplete(emptySnapshot())).toBe(true)
  const { added: _added, ...old } = emptySnapshot()
  expect(isComplete(old)).toBe(false)
  expect(isComplete({ ...emptySnapshot(), removed: Number.NaN })).toBe(false)
})

test('touchSessions puts the id first, de-duplicates and drops the overflow', () => {
  expect(touchSessions(['a', 'b', 'c'], 'b', 3)).toEqual({ keep: ['b', 'a', 'c'], drop: [] })
  expect(touchSessions(['a', 'b', 'c'], 'd', 3)).toEqual({ keep: ['d', 'a', 'b'], drop: ['c'] })
  expect(touchSessions(undefined, 'a', 3)).toEqual({ keep: ['a'], drop: [] })
  expect(touchSessions([1, 'a', null], 'b', 3)).toEqual({ keep: ['b', 'a'], drop: [] })
})

test('parseSnapshot: a snapshot stored before cost and diff existed reads them as zero', () => {
  const old = { totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, tools: 5 }
  expect(parseSnapshot(old)).toMatchObject({ tools: 5, costUsd: 0, added: 0, removed: 0 })
})
