import { expect, test } from 'claude-code/testing'
import type { Cell } from '../types'
import CellClient from './cellClient'

// A surface that counts what a desktop counts: it unmounts every `Client` of a mod that
// sends more than 400 messages in a second, and each `setState` sends two.
const surfaceOf = () => {
  const timers: (() => void)[] = []
  const s = {
    elements: { Box: 'Box', Text: 'Text' },
    state: undefined as unknown,
    sets: 0,
    setState(next: unknown) {
      s.state = next
      s.sets += 1
    },
    every(_ms: number, fn: () => void) {
      timers.push(fn)
      return () => undefined
    },
  }
  const draw = (c: Cell) => CellClient(c, s as never)
  const tick = () => {
    for (const fn of timers) fn()
  }
  return { s, timers, draw, tick }
}

test('a cell that does not change sets no state and starts no timer', () => {
  const { s, timers, draw } = surfaceOf()
  draw({ text: 'opus-5-5', width: 8 })
  draw({ text: '', width: 2 })
  expect(s.sets).toBe(0)
  expect(timers.length).toBe(0)
})

test('a turning cell draws on each tick, and stops when its agent ends', () => {
  const { s, timers, draw, tick } = surfaceOf()
  draw({ text: '', spin: true, width: 2 })
  expect(timers.length).toBe(1)
  const atStart = s.sets
  tick()
  expect(s.sets).toBe(atStart + 1)
  draw({ text: '', spin: true, width: 2 })

  // The agent ended: the same instance gets a cell that does not turn.
  draw({ text: '✓', width: 2 })
  const atEnd = s.sets
  tick()
  tick()
  expect(s.sets).toBe(atEnd)

  // It runs again: the timer that is there draws again, and no second one starts.
  draw({ text: '', spin: true, width: 2 })
  const atRerun = s.sets
  tick()
  expect(s.sets).toBe(atRerun + 1)
  expect(timers.length).toBe(1)
})

test('a cell that starts to turn after its first drawing starts its timer then', () => {
  const { s, timers, draw, tick } = surfaceOf()
  draw({ text: '✓', width: 2 })
  draw({ text: '', spin: true, width: 2 })
  expect(timers.length).toBe(1)
  const before = s.sets
  tick()
  expect(s.sets).toBe(before + 1)
})

test('a counting cell at its number draws nothing on a frame', () => {
  const { s, draw, tick } = surfaceOf()
  draw({ text: '', usd: 1.5 })
  const before = s.sets
  tick()
  tick()
  expect(s.sets).toBe(before)
})
