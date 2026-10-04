import { expect, test } from 'claude-code/testing'
import { emptyWork, endTurn, startTurn, workElapsed } from './work'

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
