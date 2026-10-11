import { expect, test } from 'claude-code/testing'
import type { ContextState } from '../types'
import { cellText } from './cell'
import {
  barCells,
  barSegments,
  contextHead,
  contextSummary,
  contextView,
  darker,
  isOverhead,
  overheadHead,
  rowColor,
  sampled,
  sampleOf,
} from './context'
import { PALETTE } from './palette'
import { UNKNOWN_CALLS } from './snapshot'

const CONTEXT = {
  tokens: 84200,
  window: 200000,
  breakdown: {
    categories: [
      { name: 'System prompt', tokens: 3200, kind: 'used' },
      { name: 'System tools', tokens: 8100, kind: 'used' },
      { name: 'MCP tools', tokens: 14200, kind: 'used' },
      { name: 'Memory files', tokens: 4000, kind: 'used' },
      { name: 'Skills', tokens: 1900, kind: 'used' },
      { name: 'Messages', tokens: 52800, kind: 'used' },
      { name: 'Free space', tokens: 82800, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
      { name: 'MCP tools (deferred)', tokens: 9000, kind: 'deferred' },
    ],
    totalTokens: 84000,
    mcpTools: [
      { name: 'mcp__figma__get', serverName: 'figma', tokens: 6000, isLoaded: true },
      { name: 'mcp__figma__set', serverName: 'figma', tokens: 3800, isLoaded: true },
      { name: 'mcp__chrome__click', serverName: 'chrome', tokens: 1800, isLoaded: true },
      { name: 'mcp__linear__issue', serverName: 'linear', tokens: 9000, isLoaded: false },
    ],
    memoryFiles: [
      { path: '/home/CLAUDE.md', type: 'User', tokens: 1100 },
      { path: '/repo/CLAUDE.md', type: 'Project', tokens: 2900 },
    ],
    agents: [],
    skills: { skillFrontmatter: [{ name: 'docs', tokens: 1900 }] },
    autoCompactThreshold: 167000,
    isAutoCompactEnabled: true,
  },
}

const SAMPLE = sampleOf(CONTEXT, 'full')
if (SAMPLE === null) throw new Error('no sample')
const state = (over: Partial<ContextState> = {}): ContextState => ({
  sessionId: 'S1',
  sample: SAMPLE,
  base: 84200,
  turns: 0,
  ...over,
})
const SNAP = { steps: 38, mcpCalls: [] as string[], mainModel: 'claude-opus-5-5' }
const view = (over: Partial<ContextState> = {}, snap: Parameters<typeof contextView>[1] = SNAP) => {
  const v = contextView(state(over), snap)
  if (v === null) throw new Error('no view')
  return v
}
// Dollars rounded to a millionth: float products are not exact.
const usd = (n: number | null): number => Math.round((n ?? Number.NaN) * 1e6) / 1e6
const texts = (cells: Parameters<typeof cellText>[0][]) => cells.map((c) => cellText(c, 0, 0))

test('sampleOf keeps each row with tokens: used by cost, then buffer, free and deferred', () => {
  expect(SAMPLE.detail).toBe('full')
  expect(SAMPLE.tokens).toBe(84200)
  expect(SAMPLE.window).toBe(200000)
  expect(SAMPLE.threshold).toBe(167000)
  expect(SAMPLE.rows.map((r) => [r.name, r.kind])).toEqual([
    ['Messages', 'used'],
    ['MCP tools', 'used'],
    ['System tools', 'used'],
    ['Memory files', 'used'],
    ['System prompt', 'used'],
    ['Skills', 'used'],
    ['Autocompact buffer', 'buffer'],
    ['Free space', 'free'],
    ['MCP tools (deferred)', 'deferred'],
  ])
})

test('the window of a sample is the compaction window', () => {
  const b = { ...CONTEXT.breakdown, rawMaxTokens: 400000 }
  expect(sampleOf({ ...CONTEXT, window: 1_000_000, breakdown: b }, 'full')?.window).toBe(400000)
  // No compaction window (an engine of a different version): the window of the model.
  expect(sampleOf({ ...CONTEXT, window: 1_000_000 }, 'full')?.window).toBe(1_000_000)
  expect(
    sampleOf({ ...CONTEXT, breakdown: { ...CONTEXT.breakdown, rawMaxTokens: 0 } }, 'full')?.window,
  ).toBe(200000)
  // A reply with no window of the model has the compaction window.
  expect(sampleOf({ breakdown: b }, 'summary')?.window).toBe(400000)
})

test('sampleOf groups the loaded MCP tools by server and names the items of a category', () => {
  expect(SAMPLE.servers).toEqual([
    { name: 'figma', tokens: 9800, tools: ['mcp__figma__get', 'mcp__figma__set'] },
    { name: 'chrome', tokens: 1800, tools: ['mcp__chrome__click'] },
  ])
  const items = (name: string) => SAMPLE.rows.find((r) => r.name === name)?.items
  expect(items('MCP tools')).toEqual([
    { name: 'figma', tokens: 9800, count: 2 },
    { name: 'chrome', tokens: 1800, count: 1 },
  ])
  expect(items('Memory files')).toEqual([
    { name: 'Project/CLAUDE.md', tokens: 2900 },
    { name: 'User/CLAUDE.md', tokens: 1100 },
  ])
  expect(items('Skills')).toEqual([{ name: 'docs', tokens: 1900 }])
  expect(items('System prompt')).toEqual([])
  // The tools that are not loaded are the items of the deferred row.
  expect(items('MCP tools (deferred)')).toEqual([{ name: 'linear', tokens: 9000, count: 1 }])
  expect(items('Messages')).toEqual([])
})

test('sampleOf gives null for a reply with no breakdown or no window', () => {
  expect(sampleOf({}, 'summary')).toBeNull()
  expect(sampleOf({ tokens: 10, window: 200000 }, 'summary')).toBeNull()
  expect(sampleOf({ breakdown: CONTEXT.breakdown }, 'summary')).toBeNull()
})

test('sampleOf reads a breakdown with no lists, no tokens and no compaction', () => {
  const s = sampleOf(
    {
      window: 200000,
      breakdown: {
        categories: CONTEXT.breakdown.categories,
        totalTokens: 84000,
        isAutoCompactEnabled: false,
        autoCompactThreshold: 167000,
      },
    },
    'summary',
  )
  expect(s?.tokens).toBe(84000)
  expect(s?.threshold).toBeNull()
  expect(s?.servers).toEqual([])
  expect(s?.rows.every((r) => r.items.length === 0)).toBe(true)
})

test('sampled starts a base, counts the turns that end, and starts again on a compaction', () => {
  const empty: ContextState = { sessionId: null, sample: null, base: null, turns: 0 }
  const first = sampled(empty, 'S1', { ...SAMPLE, tokens: 70000 }, true)
  expect(first).toEqual({
    sessionId: 'S1',
    sample: { ...SAMPLE, tokens: 70000 },
    base: 70000,
    turns: 0,
  })
  const next = sampled(first, 'S1', { ...SAMPLE, tokens: 76000 }, true)
  expect(next.base).toBe(70000)
  expect(next.turns).toBe(1)
  // A sample that is not the end of a turn (the pane opened, a recount) counts no turn.
  expect(sampled(next, 'S1', SAMPLE, false).turns).toBe(1)
  // An estimate with fewer tokens than the last sample: a compaction.
  const compacted = sampled(next, 'S1', { ...SAMPLE, detail: 'summary', tokens: 30000 }, true)
  expect(compacted.base).toBe(30000)
  expect(compacted.turns).toBe(0)
  // A full count is lower than an estimate of the same context: it is no compaction.
  const full = sampled(next, 'S1', { ...SAMPLE, detail: 'full', tokens: 70000 }, false)
  expect(full.base).toBe(70000)
  expect(full.turns).toBe(1)
  // A full count far below the last sample is a compaction: the context got much shorter.
  const cut = sampled(next, 'S1', { ...SAMPLE, detail: 'full', tokens: 30000 }, false)
  expect(cut.base).toBe(30000)
  expect(cut.turns).toBe(0)
  // Another session starts again.
  expect(sampled(next, 'S2', SAMPLE, true)).toEqual({
    sessionId: 'S2',
    sample: SAMPLE,
    base: 84200,
    turns: 0,
  })
})

test('contextView parts the tokens into overhead and messages', () => {
  const v = view()
  expect(v.overhead).toBe(31400)
  expect(v.messages).toBe(52800)
  expect(v.perTurn).toBeNull()
  expect(v.turnsLeft).toBeNull()
  expect(contextView(state({ sample: null }), SNAP)).toBeNull()
  // A sample with no Messages row: the tokens less the overhead.
  const rows = SAMPLE.rows.filter((r) => r.name !== 'Messages')
  expect(view({ sample: { ...SAMPLE, rows } }).messages).toBe(52800)
})

test('contextView gives each row its share of the window and the room to compact', () => {
  const v = view()
  const share = (name: string) => v.rows.find((r) => r.name === name)?.share
  expect(share('Messages')).toBe(26.4)
  expect(share('MCP tools')).toBe(7.1)
  expect(share('Autocompact buffer')).toBe(16.5)
  expect(share('MCP tools (deferred)')).toBeNull()
  expect(v.toCompact).toBe(82800)
  expect(view({ sample: { ...SAMPLE, threshold: null } }).toCompact).toBeNull()
  // More tokens than the threshold: no negative room.
  expect(view({ sample: { ...SAMPLE, tokens: 190000 } }).toCompact).toBe(0)
})

test('a sample of version 0.8.1 gives no view', () => {
  const { rows: _, ...old } = SAMPLE
  expect(contextView(state({ sample: { ...old, categories: [] } as never }), SNAP)).toBeNull()
})

test('rowColor gives the color of the bar part of a used row, and none for the other kinds', () => {
  expect(rowColor({ name: 'Messages', kind: 'used' })).toBe(PALETTE.cyan)
  expect(rowColor({ name: 'System tools', kind: 'used' })).toBe(PALETTE.orange)
  expect(rowColor({ name: 'MCP tools', kind: 'used' })).toBe(PALETTE.green)
  expect(rowColor({ name: 'Skills', kind: 'used' })).toBe(PALETTE.yellow)
  expect(rowColor({ name: 'Memory files', kind: 'used' })).toBe(PALETTE.dim)
  expect(rowColor({ name: 'constructor', kind: 'used' })).toBe(PALETTE.dim)
  expect(rowColor({ name: 'Free space', kind: 'free' })).toBeNull()
  expect(rowColor({ name: 'MCP tools (deferred)', kind: 'deferred' })).toBeNull()
  expect(isOverhead({ name: 'Skills', kind: 'used' })).toBe(true)
  expect(isOverhead({ name: 'Messages', kind: 'used' })).toBe(false)
  expect(isOverhead({ name: 'Free space', kind: 'free' })).toBe(false)
})

test('contextView keeps the overhead at or below the tokens', () => {
  const v = view({ sample: { ...SAMPLE, tokens: 10000 } })
  expect(v.overhead).toBe(10000)
})

test('contextView gives the growth of a turn and the turns before a compaction', () => {
  const v = view({ base: 74900, turns: 3 })
  expect(v.perTurn).toBe(3100)
  expect(v.turnsLeft).toBe(26)
  // No growth, or no auto-compaction: no number of turns.
  expect(view({ base: 84200, turns: 3 }).turnsLeft).toBeNull()
  expect(
    view({ base: 74900, turns: 3, sample: { ...SAMPLE, threshold: null } }).turnsLeft,
  ).toBeNull()
})

test('contextView estimates the carry cost from the steps and the cache read price', () => {
  const v = view()
  expect(v.steps).toBe(38)
  // 31400 tokens at 38 steps at $0.20 per million tokens.
  expect(usd(v.carryUsd)).toBe(0.23864)
  const carryOf = (c: ReturnType<typeof view>, name: string) =>
    c.rows.find((r) => r.name === name)?.carryUsd
  expect(usd(carryOf(v, 'MCP tools') ?? null)).toBe(0.10792)
  // The conversation, the free room and the deferred tools carry no overhead cost.
  expect(carryOf(v, 'Messages')).toBeNull()
  expect(carryOf(v, 'Free space')).toBeNull()
  const unpriced = view({}, { ...SNAP, mainModel: 'm' })
  expect(unpriced.carryUsd).toBeNull()
  expect(carryOf(unpriced, 'MCP tools')).toBeNull()
  expect(view({}, { steps: 38, mcpCalls: [] }).carryUsd).toBeNull()
})

test('contextView lists the servers that the session did not call', () => {
  const v = view()
  expect(v.unused).toEqual([
    { name: 'figma', tokens: 9800, count: 2 },
    { name: 'chrome', tokens: 1800, count: 1 },
  ])
  expect(v.deadWeight).toBe(11600)
  const called = view({}, { ...SNAP, mcpCalls: ['mcp__figma__get'] })
  expect(called.unused.map((s) => s.name)).toEqual(['chrome'])
  expect(called.deadWeight).toBe(1800)
})

test('barCells shares 40 cells between the parts of the window', () => {
  expect(barCells(view())).toEqual({ overhead: 6, messages: 11, free: 16, buffer: 7 })
  // A small overhead has one cell at least.
  expect(barCells({ tokens: 100, window: 200000, overhead: 100, buffer: 0 })).toEqual({
    overhead: 1,
    messages: 0,
    free: 39,
    buffer: 0,
  })
  // More tokens than the window: the bar is full and has no negative part.
  expect(barCells({ tokens: 250000, window: 200000, overhead: 31400, buffer: 33000 })).toEqual({
    overhead: 6,
    messages: 34,
    free: 0,
    buffer: 0,
  })
  expect(barCells({ tokens: 0, window: 0, overhead: 0, buffer: 0 })).toEqual({
    overhead: 0,
    messages: 0,
    free: 40,
    buffer: 0,
  })
})

test('barSegments draws one character for each cell and tells the parts by color', () => {
  const segs = barSegments(view())
  // One glyph for the whole bar: no part is a pixel off from the part beside it.
  expect(segs.map((s) => s.text)).toEqual([
    '█'.repeat(6),
    '█'.repeat(11),
    '█'.repeat(16),
    '█'.repeat(7),
  ])
  // 42 percent: the `ok` tone, and a darker green for the messages.
  expect(segs.map((s) => s.color)).toEqual([PALETTE.green, '#5d7941', PALETTE.strip, PALETTE.dim])
  const hot = barSegments(view({ sample: { ...SAMPLE, tokens: 170000 } }))
  expect(hot.slice(0, 2).map((s) => s.color)).toEqual([PALETTE.red, '#8c354b'])
})

test('darker scales each channel of a hex color', () => {
  expect(darker('#ffd866')).toBe('#8c7738')
  expect(darker('#000000')).toBe('#000000')
})

test('contextHead drops parts until the row fits', () => {
  const v = view({ base: 74900, turns: 3 })
  expect(texts(contextHead(v, 80))).toEqual([
    'ctx 84.2k/200k 42%',
    '·',
    '+3.1k/turn',
    '·',
    '≈26 turns to compact',
  ])
  expect(texts(contextHead(v, 40))).toEqual(['ctx 84.2k/200k 42%', '·', '+3.1k/turn'])
  expect(texts(contextHead(v, 20))).toEqual(['ctx 84.2k/200k 42%'])
  expect(texts(contextHead(v, 10))).toEqual(['ctx 42%'])
  expect(texts(contextHead(v, -5))).toEqual(['ctx 42%'])
  expect(contextHead(v, 80)[0]?.color).toBe(PALETTE.green)
})

test('contextSummary shows the dead weight only when there is one', () => {
  expect(texts(contextSummary(view()))).toEqual([
    'overhead 31.4k',
    '·',
    'messages 52.8k',
    '·',
    'dead weight 11.6k',
  ])
  const called = view({}, { ...SNAP, mcpCalls: ['mcp__figma__get', 'mcp__chrome__click'] })
  expect(texts(contextSummary(called))).toEqual(['overhead 31.4k', '·', 'messages 52.8k'])
})

test('overheadHead shows the share of the window and the carry cost', () => {
  const cells = overheadHead(view())
  expect(texts(cells)).toEqual([
    'overhead 31.4k',
    '·',
    '16% of window',
    '·',
    '≈$0.24 over 38 steps',
  ])
  expect(cells[0]?.bold).toBe(true)
  expect(texts(overheadHead(view({}, { ...SNAP, mainModel: 'm' })))).toEqual([
    'overhead 31.4k',
    '·',
    '16% of window',
  ])
})

test('a sample from the API after an estimate starts the base again', () => {
  // With no response yet the tokens are a local estimate, which is higher than the API count.
  const { tokens: _, ...noTokens } = CONTEXT
  const estimate = sampleOf(noTokens, 'summary')
  const real = sampleOf({ ...CONTEXT, tokens: 90000 }, 'summary')
  if (estimate === null || real === null) throw new Error('no sample')
  expect(estimate.isEstimate).toBe(true)
  const first = sampled(
    { sessionId: null, sample: null, base: null, turns: 0 },
    'S1',
    estimate,
    false,
  )
  const next = sampled(first, 'S1', real, true)
  expect(next.base).toBe(90000)
  expect(next.turns).toBe(0)
})

test('a session with no record of its MCP calls shows no dead weight', () => {
  const v = contextView(state(), { ...SNAP, mcpCalls: [UNKNOWN_CALLS] })
  expect(v?.unused).toEqual([])
  expect(v?.deadWeight).toBe(0)
})

test('a session with no record of its steps shows no carry cost', () => {
  // A snapshot of an older version has no count of steps: a cost from it is too small.
  const v = contextView(state(), { ...SNAP, steps: 4, mcpCalls: [UNKNOWN_CALLS] })
  expect(v?.carryUsd).toBeNull()
  expect(v?.rows.every((r) => r.carryUsd === null)).toBe(true)
})

test('a category with the name of an object method has no items', () => {
  const odd = sampleOf(
    {
      ...CONTEXT,
      breakdown: {
        ...CONTEXT.breakdown,
        categories: [{ name: 'constructor', tokens: 10, kind: 'used' }],
      },
    },
    'full',
  )
  expect(odd?.rows).toEqual([{ name: 'constructor', tokens: 10, kind: 'used', items: [] }])
})

test('a context that got shorter since its base shows no growth', () => {
  const v = contextView(state({ base: 150000, turns: 3 }), SNAP)
  expect(v?.perTurn).toBeNull()
  expect(v?.turnsLeft).toBeNull()
})

test('sampled adds the turns that gave no sample, and a new base drops them', () => {
  const first = sampled(
    { sessionId: null, sample: null, base: null, turns: 0 },
    'S1',
    SAMPLE,
    false,
  )
  // The base is set and no turn is counted yet: two turns ended with no sample before this one.
  const next = sampled(first, 'S1', { ...SAMPLE, tokens: 90000 }, true, 2)
  expect(next.turns).toBe(3)
  // A turn end with no step counts only the turns that gave no sample.
  expect(sampled(first, 'S1', { ...SAMPLE, tokens: 90000 }, false, 1).turns).toBe(1)
  // A compaction starts again: the turns before it are not of the new base.
  const compacted = sampled(next, 'S1', { ...SAMPLE, detail: 'summary', tokens: 20000 }, true, 2)
  expect(compacted.turns).toBe(0)
})

test('the carry cost of a long prompt uses the long rate of the model', () => {
  const haiku = { ...SNAP, mainModel: 'claude-haiku-5-5' }
  const short = view({ sample: { ...SAMPLE, tokens: 100_000 } as never }, haiku)
  const long = view({ sample: { ...SAMPLE, tokens: 100_001 } as never }, haiku)
  expect(usd(long.carryUsd)).toBe(usd((short.carryUsd ?? Number.NaN) * 5))
})
