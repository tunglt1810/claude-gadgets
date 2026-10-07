import { expect, test } from 'claude-code/testing'
import { emptyAgent } from './agents'
import { paneData } from './paneData'
import { spawned } from './registry'
import { emptySnapshot } from './snapshot'

const snap = () => ({
  ...emptySnapshot(),
  tools: 9,
  byAgent: {
    a1: { ...emptyAgent(), tools: 2 },
    a2: { ...emptyAgent(), tools: 3, parentId: 'a1' },
    b1: { ...emptyAgent(), tools: 4 },
  },
})

test("the tree screen takes every agent and the dashboard, not one agent's numbers", () => {
  const entries = spawned(spawned({}, 'a1', 1, {}), 'b1', 1, {})
  expect(paneData('S1', entries, null, snap(), 0, null)).toMatchObject({
    sessionId: 'S1',
    entries,
    stats: null,
  })
})

test('the transcript screen takes only the viewed agent and its own numbers', () => {
  const entries = spawned(spawned({}, 'a1', 1, {}), 'b1', 1, {})
  const data = paneData('S1', entries, 'a1', snap(), 0, null)
  expect(Object.keys(data.entries)).toEqual(['a1'])
  // a1 and the agent it spawned; not b1, not the main loop.
  expect(data.stats?.tools).toBe(5)
})

test('the numbers of another agent and of the main loop do not change the data', () => {
  const entries = spawned(spawned({}, 'a1', 1, {}), 'b1', 1, {})
  const busy = snap()
  busy.tools = 50
  busy.byAgent.b1 = { ...emptyAgent(), tools: 40 }
  expect(paneData('S1', entries, 'a1', busy, 0, null)).toEqual(
    paneData('S1', entries, 'a1', snap(), 0, null),
  )
})

test('paneData gives the context to the tree screen only', () => {
  const context = { tokens: 1 } as never
  expect(paneData('S1', {}, null, emptySnapshot(), 0, context).context).toBe(context)
  expect(paneData('S1', {}, 'a1', emptySnapshot(), 0, context).context).toBeNull()
})
