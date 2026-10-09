import { expect, test } from 'claude-code/testing'
import BandClient, { type BandProps } from './bandClient'
import { emptySnapshot } from './snapshot'

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
  const draw = (p: BandProps) => JSON.stringify(BandClient(p, s as never))
  const tick = () => {
    for (const fn of timers) fn()
  }
  return { s, timers, draw, tick }
}

const REST: BandProps = { snap: emptySnapshot(), busySince: null, ttl: '5m', columns: 200 }

test('a band at rest sets no state and starts no timer', () => {
  const { s, timers, draw } = surfaceOf()
  expect(draw(REST)).toContain('↑ in 0')
  expect(s.sets).toBe(0)
  expect(timers.length).toBe(0)
})

test('the band draws each second while a turn runs, and stops when it ends', () => {
  const { s, timers, draw, tick } = surfaceOf()
  draw({ ...REST, busySince: Date.now() })
  expect(timers.length).toBe(1)
  const atStart = s.sets
  tick()
  expect(s.sets).toBe(atStart + 1)

  draw(REST)
  const atEnd = s.sets
  tick()
  tick()
  expect(s.sets).toBe(atEnd)
  expect(timers.length).toBe(1)
})

test('the band draws each second while the cache has time left', () => {
  const { s, draw, tick } = surfaceOf()
  const drawn = draw({ ...REST, snap: { ...emptySnapshot(), lastStepAt: Date.now() } })
  expect(drawn).toMatch(/◔ (5:00|4:59)/)
  const live = s.sets
  tick()
  expect(s.sets).toBe(live + 1)

  // The cache lapsed a long time ago: its text does not change.
  const { s: old, draw: drawOld, tick: tickOld } = surfaceOf()
  drawOld({ ...REST, snap: { ...emptySnapshot(), lastStepAt: 1 } })
  const lapsed = old.sets
  tickOld()
  expect(old.sets).toBe(lapsed)
})

test('the band leaves the agents button to the page', () => {
  const { draw } = surfaceOf()
  const drawn = draw({ ...REST, snap: { ...emptySnapshot(), agents: 3 } })
  expect(drawn).not.toContain('agents 3')
})
