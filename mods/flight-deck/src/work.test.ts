import { expect, test } from 'claude-code/testing'
import { emptyWork, endRun, endTurn, startRun, startTurn, workElapsed } from './work'

test('single turn adds the start -> end interval', () => {
  let w = startTurn(emptyWork(), 1000)
  expect(workElapsed(w, 4000)).toBe(3000)
  w = endTurn(w, 6000)
  expect(w).toEqual({ workMs: 5000, active: 0, busySince: null })
})

test('overlapping turns are not double counted', () => {
  let w = startTurn(emptyWork(), 0)
  w = startTurn(w, 2000)
  w = endTurn(w, 3000)
  expect(w.workMs).toBe(0)
  w = endTurn(w, 5000)
  expect(w.workMs).toBe(5000)
})

test('extra end never goes negative; backwards time is clamped', () => {
  expect(endTurn(emptyWork(), 100)).toEqual(emptyWork())
  expect(endTurn(startTurn(emptyWork(), 5000), 1000).workMs).toBe(0)
})

test('a run of an agent holds one work interval, from its first step to its end', () => {
  let w = startRun({ ...emptyWork(), working: [] }, 'a1', 1000)
  // A later step of the same run opens nothing.
  w = startRun(w, 'a1', 2000)
  expect(w.active).toBe(1)
  expect(w.working).toEqual(['a1'])
  w = { ...w, ...endRun(w, 'a1', 6000) }
  expect(w).toEqual({ workMs: 5000, active: 0, busySince: null, working: [] })
  // An end with no open run (its steps were not seen) closes nothing.
  const open = { ...startTurn(emptyWork(), 0), working: [] }
  expect(endRun(open, 'a1', 500)).toBe(open)
})

test('startRun reads state of an older shape as no open run', () => {
  const old = emptyWork() as never
  expect(startRun(old, 'a1', 1000).working).toEqual(['a1'])
  expect(endRun(old, 'a1', 1000)).toBe(old)
})
