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
    agents: 0,
    bg: 0,
    byAgent: {},
    byModel: { 'claude-opus-5-5': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
    costByModel: { 'claude-opus-5-5': 0.5 },
    advisor: { calls: 2, ms: 900, usd: 0.5, base: 0.25, model: 'opus', pending: true },
    steps: 7,
    mcpCalls: ['mcp__a__b'],
    mainModel: 'claude-opus-5-5',
  }
  expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
})

test('isComplete: state written before a field existed, or holding NaN, is not complete', () => {
  expect(isComplete(emptySnapshot())).toBe(true)
  const { added: _added, ...old } = emptySnapshot()
  expect(isComplete(old)).toBe(false)
  expect(isComplete({ ...emptySnapshot(), removed: Number.NaN })).toBe(false)
  // An advisor record from before its cost existed: `undefined + n` is NaN.
  const advisor = { calls: 1, ms: 5 } as never
  expect(isComplete({ ...emptySnapshot(), advisor })).toBe(false)
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

test('parseSnapshot keeps spawn counts and per-agent data, and drops garbage agents', () => {
  const agent = {
    totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    tools: 5,
    added: 6,
    removed: 7,
    lastStepAt: 800,
    parentId: 'p',
  }
  const s = { ...emptySnapshot(), agents: 2, bg: 3, byAgent: { a: agent } }
  expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
  expect(parseSnapshot({ agents: 'x', bg: null, byAgent: { a: 1, b: { tools: 2 } } })).toEqual({
    ...emptySnapshot(),
    byAgent: {
      b: {
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        tools: 2,
        added: 0,
        removed: 0,
        lastStepAt: null,
      },
    },
  })
})

test('isComplete: state written before spawn counts and per-agent data existed is not complete', () => {
  const { byAgent: _byAgent, ...noAgents } = emptySnapshot()
  expect(isComplete(noAgents)).toBe(false)
  const { bg: _bg, ...noBg } = emptySnapshot()
  expect(isComplete(noBg)).toBe(false)
})

test('parseSnapshot gives a 0.5.1 snapshot no steps and no MCP calls', () => {
  const s = parseSnapshot({ tools: 3 })
  expect(s.steps).toBe(0)
  expect(s.mcpCalls).toEqual([])
})

test('parseSnapshot keeps the steps and only the names that are strings', () => {
  const s = parseSnapshot({ steps: 4, mcpCalls: ['mcp__a__b', 7, null] })
  expect(s.steps).toBe(4)
  expect(s.mcpCalls).toEqual(['mcp__a__b'])
})

test('isComplete refuses a state with no steps or no MCP calls', () => {
  expect(isComplete(emptySnapshot())).toBe(true)
  expect(isComplete({ ...emptySnapshot(), steps: undefined } as never)).toBe(false)
  expect(isComplete({ ...emptySnapshot(), mcpCalls: undefined } as never)).toBe(false)
})
