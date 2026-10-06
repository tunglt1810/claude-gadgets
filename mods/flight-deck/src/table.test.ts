import { expect, test } from 'claude-code/testing'
import type { AgentEntry } from '../types'
import { agentTable } from './table'

const agent = (over: Partial<AgentEntry>): AgentEntry => ({
  id: 'a',
  status: 'idle',
  runs: 1,
  startedAt: 0,
  endedAt: null,
  ...over,
})

test('agentTable sizes the runs column to its longest cell; the name takes the rest', () => {
  // mark 2, then a one-column gap before each column after it. The runs column is a bare
  // count, as wide as its header.
  expect(agentTable([agent({ runs: 12345 }), agent({ runs: 1 })], 80)).toEqual({
    name: 80 - 3 - (5 + 1) - (9 + 1),
    runs: 5,
    time: 9,
  })
  expect(agentTable([agent({})], 80)).toEqual({
    name: 80 - 3 - (4 + 1) - (9 + 1),
    runs: 4,
    time: 9,
  })
})

test('agentTable keeps a usable name', () => {
  expect(agentTable([agent({})], 10).name).toBe(8)
})
