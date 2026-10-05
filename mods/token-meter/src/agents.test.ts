import { expect, test } from 'claude-code/testing'
import { agentView, bumpAgent, emptyAgent } from './agents'
import { emptySnapshot } from './snapshot'

const totals = (n: number) => ({ input: n, output: n, cacheRead: n, cacheWrite: n })

test('bumpAgent changes one agent, starts an unknown one from empty, and skips the main loop', () => {
  const one = bumpAgent({}, 'a', (c) => ({ ...c, tools: c.tools + 1 }))
  expect(one).toEqual({ a: { ...emptyAgent(), tools: 1 } })
  expect(bumpAgent(one, 'a', (c) => ({ ...c, tools: c.tools + 1 })).a?.tools).toBe(2)
  expect(bumpAgent(one, undefined, (c) => ({ ...c, tools: 9 }))).toBe(one)
})

test('agentView sums an agent with every agent spawned below it, and nothing else', () => {
  const snap = {
    ...emptySnapshot(),
    totals: totals(100),
    tools: 50,
    costUsd: 3,
    workMs: 9000,
    agents: 4,
    bg: 2,
    lastStepAt: 999,
    byAgent: {
      a: { ...emptyAgent(), totals: totals(1), tools: 1, added: 1, removed: 1, lastStepAt: 10 },
      b: { ...emptyAgent(), totals: totals(2), tools: 2, added: 2, parentId: 'a', lastStepAt: 20 },
      c: { ...emptyAgent(), totals: totals(4), tools: 4, removed: 4, parentId: 'b' },
      other: { ...emptyAgent(), totals: totals(8), tools: 8 },
    },
  }

  expect(agentView(snap, 'a')).toEqual({
    ...emptySnapshot(),
    totals: totals(7),
    tools: 7,
    added: 3,
    removed: 5,
    // The countdown is the agent's own cache, not a descendant's.
    lastStepAt: 10,
  })
})

test('agentView of an agent that raised no event yet is empty', () => {
  expect(agentView(emptySnapshot(), 'nope')).toEqual(emptySnapshot())
})
