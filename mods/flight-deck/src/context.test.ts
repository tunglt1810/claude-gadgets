import { expect, test } from 'claude-code/testing'
import type { ContextState } from '../types'
import { cellText } from './cell'
import {
  barCells,
  barSegments,
  contextHead,
  contextSummary,
  contextView,
  overheadHead,
  sampled,
  sampleOf,
} from './context'
import { PALETTE } from './palette'

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

test('sampleOf keeps the used categories without the messages, the costliest first', () => {
  expect(SAMPLE.detail).toBe('full')
  expect(SAMPLE.tokens).toBe(84200)
  expect(SAMPLE.window).toBe(200000)
  expect(SAMPLE.threshold).toBe(167000)
  expect(SAMPLE.categories.map((r) => r.name)).toEqual([
    'MCP tools',
    'System tools',
    'Memory files',
    'System prompt',
    'Skills',
  ])
})

test('sampleOf groups the loaded MCP tools by server and names the items of a category', () => {
  expect(SAMPLE.servers).toEqual([
    { name: 'figma', tokens: 9800, tools: ['mcp__figma__get', 'mcp__figma__set'] },
    { name: 'chrome', tokens: 1800, tools: ['mcp__chrome__click'] },
  ])
  const items = (name: string) => SAMPLE.categories.find((r) => r.name === name)?.items
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
  expect(s?.categories.every((r) => r.items.length === 0)).toBe(true)
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
  // Fewer tokens than the last sample: a compaction.
  const compacted = sampled(next, 'S1', { ...SAMPLE, tokens: 30000 }, true)
  expect(compacted.base).toBe(30000)
  expect(compacted.turns).toBe(0)
  // Another session starts again.
  expect(sampled(next, 'S2', SAMPLE, true)).toEqual({
    sessionId: 'S2',
    sample: SAMPLE,
    base: 84200,
    turns: 0,
  })
})

test('contextView parts the tokens into overhead, messages and buffer', () => {
  const v = view()
  expect(v.overhead).toBe(31400)
  expect(v.messages).toBe(52800)
  expect(v.buffer).toBe(33000)
  expect(v.perTurn).toBeNull()
  expect(v.turnsLeft).toBeNull()
  expect(contextView(state({ sample: null }), SNAP)).toBeNull()
})

test('contextView keeps the overhead at or below the tokens', () => {
  const v = view({ sample: { ...SAMPLE, tokens: 10000 } })
  expect(v.overhead).toBe(10000)
  expect(v.messages).toBe(0)
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
  expect(view({ sample: { ...SAMPLE, threshold: null } }).buffer).toBe(0)
})

test('contextView estimates the carry cost from the steps and the cache read price', () => {
  const v = view()
  expect(v.steps).toBe(38)
  // 31400 tokens at 38 steps at $0.20 per million tokens.
  expect(usd(v.carryUsd)).toBe(0.23864)
  expect(usd(v.categories[0]?.carryUsd ?? null)).toBe(0.10792)
  const unpriced = view({}, { ...SNAP, mainModel: 'm' })
  expect(unpriced.carryUsd).toBeNull()
  expect(unpriced.categories[0]?.carryUsd).toBeNull()
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

test('barSegments draws the used parts in the context tone and the rest with no color', () => {
  const segs = barSegments(view())
  expect(segs.map((s) => s.text).join('')).toBe(
    `${'█'.repeat(6)}${'▄'.repeat(11)}${'▁'.repeat(16)}${'▂'.repeat(7)}`,
  )
  // 42 percent: the `ok` tone.
  expect(segs.map((s) => s.color)).toEqual([PALETTE.green, PALETTE.green, undefined, undefined])
  const hot = barSegments(view({ sample: { ...SAMPLE, tokens: 170000 } }))
  expect(hot[0]?.color).toBe(PALETTE.red)
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
