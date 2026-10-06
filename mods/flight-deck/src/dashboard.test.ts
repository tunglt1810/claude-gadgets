import { expect, test } from 'claude-code/testing'
import { emptyAgent } from './agents'
import { dashboard, shortModel } from './dashboard'
import { completed, spawned, tuned } from './registry'
import { emptySnapshot } from './snapshot'

const MTOK = { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }

test('dashboard sums cost, working time and runs per model, the costliest first', () => {
  let r = spawned({}, 'a1', 0, {})
  r = tuned(r, 'a1', 'claude-haiku-4-5-20251001', undefined)
  r = completed(r, 'a1', 60_000)
  r = spawned(r, 'a2', 0, {})
  r = tuned(r, 'a2', 'claude-haiku-4-5-20251001', undefined)
  r = completed(completed(r, 'a2', 30_000), 'a2', 30_000)
  const snap = {
    ...emptySnapshot(),
    costUsd: 9.5,
    workMs: 120_000,
    mainModel: 'claude-opus-5-5',
    byModel: { 'claude-opus-5-5': MTOK, 'claude-haiku-4-5-20251001': MTOK },
    byAgent: { a1: emptyAgent(), a2: emptyAgent() },
  }
  expect(dashboard(snap, r, 200_000)).toEqual({
    costUsd: 9.5,
    rows: [
      // The main loop's time is the session's work time.
      { model: 'opus-5-5', costUsd: 4, workMs: 120_000, runs: 0 },
      { model: 'haiku-4-5', costUsd: 1, workMs: 90_000, runs: 3 },
    ],
  })
})

test('dashboard keeps a model with no price, its cost unknown', () => {
  let r = spawned({}, 'a1', 0, {})
  r = tuned(r, 'a1', 'mystery-1', undefined)
  const snap = { ...emptySnapshot(), byModel: { 'mystery-1': MTOK } }
  expect(dashboard(snap, r, 5000).rows).toEqual([
    { model: 'mystery-1', costUsd: null, workMs: 5000, runs: 0 },
  ])
})

test('shortModel drops the vendor prefix and the date of a model id', () => {
  expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5-5')
  expect(shortModel('mystery-1')).toBe('mystery-1')
})
