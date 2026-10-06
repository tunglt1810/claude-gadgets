import { expect, test } from 'claude-code/testing'
import { emptyAgent } from './agents'
import { dashboard, runsText, SIDE, shareColor, sharePct, shortModel } from './dashboard'
import { PALETTE } from './palette'
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
    costUsd: 5,
    workMs: 120_000,
    mainModel: 'claude-opus-5-5',
    byModel: { 'claude-opus-5-5': MTOK, 'claude-haiku-4-5-20251001': MTOK },
    byAgent: { a1: emptyAgent(), a2: emptyAgent() },
  }
  expect(dashboard(snap, r, 200_000)).toEqual({
    costUsd: 5,
    rows: [
      // The main loop's time is the session's work time.
      { model: 'opus-5-5', costUsd: 4, workMs: 120_000, runs: 0, main: true },
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

test('dashboard adds a side requests row for the ledger cost no model row holds', () => {
  const snap = { ...emptySnapshot(), costUsd: 5.25, byModel: { 'claude-opus-5-5': MTOK } }
  expect(dashboard(snap, {}, 0).rows).toEqual([
    { model: 'opus-5-5', costUsd: 4, workMs: 0, runs: 0 },
    { model: SIDE, costUsd: 1.25, workMs: 0, runs: 0 },
  ])
})

test('dashboard adds no side requests row when the rows cover the ledger to the cent', () => {
  const snap = { ...emptySnapshot(), costUsd: 4.004, byModel: { 'claude-opus-5-5': MTOK } }
  expect(dashboard(snap, {}, 0).rows.map((r) => r.model)).toEqual(['opus-5-5'])
  // The estimate can pass the ledger: nothing is left, never a negative row.
  const over = { ...snap, costUsd: 3 }
  expect(dashboard(over, {}, 0).rows.map((r) => r.model)).toEqual(['opus-5-5'])
})

test('dashboard adds no side requests row when a row has no price: the rest is unknown', () => {
  const snap = { ...emptySnapshot(), costUsd: 9, byModel: { 'mystery-1': MTOK } }
  expect(dashboard(snap, {}, 0).rows.map((r) => r.model)).toEqual(['mystery-1'])
})

test('dashboard takes a row cost priced at each step over one priced from the tokens', () => {
  const snap = {
    ...emptySnapshot(),
    costUsd: 7,
    byModel: { 'claude-opus-5-5': MTOK },
    costByModel: { 'claude-opus-5-5': 7 },
  }
  expect(dashboard(snap, {}, 0).rows).toEqual([
    { model: 'opus-5-5', costUsd: 7, workMs: 0, runs: 0 },
  ])
})

test('dashboard adds an advisor row: its calls and time, its cost in the side requests row', () => {
  const snap = {
    ...emptySnapshot(),
    costUsd: 5,
    byModel: { 'claude-opus-5-5': MTOK },
    advisor: { calls: 2, ms: 90_000, usd: 0, base: 0, model: 'claude-opus-5-5' },
  }
  expect(dashboard(snap, {}, 0).rows).toEqual([
    { model: 'opus-5-5', costUsd: 4, workMs: 0, runs: 0 },
    { model: 'advisor·opus-5-5', costUsd: null, workMs: 90_000, runs: 2 },
    { model: SIDE, costUsd: 1, workMs: 0, runs: 0 },
  ])
  // The settings did not name the advisor's model.
  const bare = { ...snap, advisor: { calls: 1, ms: 0, usd: 0, base: 0 } }
  expect(dashboard(bare, {}, 0).rows[1]?.model).toBe('advisor')
  // Its cost is settled: it leaves the side requests row.
  const known = { ...snap, advisor: { calls: 2, ms: 0, usd: 0.75, base: 0 } }
  expect(dashboard(known, {}, 0).rows.slice(1)).toEqual([
    { model: 'advisor', costUsd: 0.75, workMs: 0, runs: 2 },
    { model: SIDE, costUsd: 0.25, workMs: 0, runs: 0 },
  ])
})

test('runsText names the main loop, with the runs of the agents on its model', () => {
  const r = { model: 'opus-5-5', costUsd: 4, workMs: 0, runs: 0 }
  expect(runsText(r)).toBe('0')
  expect(runsText({ ...r, main: true })).toBe('main')
  expect(runsText({ ...r, main: true, runs: 2 })).toBe('main+2')
})

test('sharePct is the share of a cost in the total, a whole percent', () => {
  expect(sharePct(4.77, 5.73)).toBe(83)
  expect(sharePct(0, 5)).toBe(0)
  // No cost, or no total to share: no percent.
  expect(sharePct(null, 5)).toBeNull()
  expect(sharePct(1, 0)).toBeNull()
})

test('shareColor is warmer for a larger share', () => {
  expect(shareColor(83)).toBe(PALETTE.red)
  expect(shareColor(50)).toBe(PALETTE.red)
  expect(shareColor(25)).toBe(PALETTE.orange)
  expect(shareColor(10)).toBe(PALETTE.yellow)
  expect(shareColor(9)).toBe(PALETTE.dim)
})
