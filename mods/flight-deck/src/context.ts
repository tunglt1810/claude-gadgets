import type {
  Cell,
  ContextGroup,
  ContextSample,
  ContextState,
  ContextView,
  Snapshot,
} from '../types'
import { cellText } from './cell'
import { formatTokens, formatUsd } from './format'
import { PALETTE } from './palette'
import { readPrice } from './price'
import { UNKNOWN_CALLS } from './snapshot'
import { contextColor } from './window'

// The category that is the conversation, by the name the engine gives it: no `kind` parts it
// from the overhead.
const MESSAGES = 'Messages'

// The part of `$.session.usage({ breakdown })`'s context that a sample reads. A list can be
// absent: a summary breakdown, or an engine of another version.
export type UsageContext = {
  tokens?: number
  window?: number
  breakdown?: {
    categories: { name: string; tokens: number; kind: string }[]
    totalTokens: number
    mcpTools?: { name: string; serverName: string; tokens: number; isLoaded: boolean }[]
    memoryFiles?: { path: string; type: string; tokens: number }[]
    agents?: { agentType: string; tokens: number }[]
    skills?: { skillFrontmatter: { name: string; tokens: number }[] }
    autoCompactThreshold?: number
    isAutoCompactEnabled: boolean
  }
}

// The rows that have tokens, the costliest first.
const byTokens = <T extends { tokens: number }>(rows: T[]): T[] =>
  rows.filter((r) => r.tokens > 0).sort((a, b) => b.tokens - a.tokens)

// `Project/CLAUDE.md`: the type of a memory file and the last part of its path.
const memoryName = (f: { path: string; type: string }): string =>
  `${f.type}/${f.path.slice(f.path.lastIndexOf('/') + 1)}`

// What the mod keeps of a usage reply, or null for a reply with no breakdown or no window.
// The items of a category go by the category's name: a category of another name has none.
export const sampleOf = (c: UsageContext, detail: 'summary' | 'full'): ContextSample | null => {
  const b = c.breakdown
  if (b === undefined || c.window === undefined || c.window <= 0) return null
  // A tool that loads on demand is not in the window.
  const loaded = (b.mcpTools ?? []).filter((t) => t.isLoaded)
  const servers = byTokens(
    [...new Set(loaded.map((t) => t.serverName))].map((name) => {
      const tools = loaded.filter((t) => t.serverName === name)
      return {
        name,
        tokens: tools.reduce((n, t) => n + t.tokens, 0),
        tools: tools.map((t) => t.name),
      }
    }),
  )
  const items: Record<string, ContextGroup[]> = {
    'MCP tools': servers.map((s) => ({ name: s.name, tokens: s.tokens, count: s.tools.length })),
    'Memory files': byTokens(
      (b.memoryFiles ?? []).map((f) => ({ name: memoryName(f), tokens: f.tokens })),
    ),
    Skills: byTokens(
      (b.skills?.skillFrontmatter ?? []).map((s) => ({ name: s.name, tokens: s.tokens })),
    ),
    'Custom agents': byTokens(
      (b.agents ?? []).map((a) => ({ name: a.agentType, tokens: a.tokens })),
    ),
  }
  return {
    detail,
    tokens: c.tokens ?? b.totalTokens,
    isEstimate: c.tokens === undefined,
    window: c.window,
    // The threshold is measured in the compaction window, which can be smaller than the
    // window of the model: the buffer is the row of the breakdown, not their difference.
    buffer: b.categories.filter((r) => r.kind === 'buffer').reduce((n, r) => n + r.tokens, 0),
    threshold:
      b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined
        ? b.autoCompactThreshold
        : null,
    categories: byTokens(
      b.categories
        .filter((r) => r.kind === 'used' && r.name !== MESSAGES)
        .map((r) => ({ name: r.name, tokens: r.tokens, items: items[r.name] ?? [] })),
    ),
    servers,
  }
}

// The state with a new sample. The first sample of a session is the base of its growth, and
// so is an estimate with fewer tokens than the last sample: a compaction. A full count is
// lower than an estimate of the same context, and its reply can come late, so it starts no
// base. An estimate is higher than the count of the API for the same context, so the first
// sample of the API after an estimate is a base too. `isTurnEnd` counts a turn.
export const sampled = (
  c: ContextState,
  id: string,
  sample: ContextSample,
  isTurnEnd: boolean,
): ContextState => {
  const last = c.sessionId === id ? c.sample?.tokens : undefined
  const isCompacted = sample.detail === 'summary' && last !== undefined && sample.tokens < last
  const isFirstCount = c.sample?.isEstimate === true && !sample.isEstimate
  if (c.sessionId !== id || c.base === null || isCompacted || isFirstCount)
    return { sessionId: id, sample, base: sample.tokens, turns: 0 }
  return { ...c, sample, turns: c.turns + (isTurnEnd ? 1 : 0) }
}

// What the pane draws of a context, or null with no sample. The carry cost prices the
// overhead of the latest sample at each step of the main loop: an estimate.
export const contextView = (
  state: ContextState,
  snap: Pick<Snapshot, 'steps' | 'mcpCalls' | 'mainModel'>,
): ContextView | null => {
  const s = state.sample
  if (s === null) return null
  const overhead = Math.min(
    s.tokens,
    s.categories.reduce((n, r) => n + r.tokens, 0),
  )
  const perTurn =
    state.base === null || state.turns === 0
      ? null
      : Math.round((s.tokens - state.base) / state.turns)
  const turnsLeft =
    perTurn === null || perTurn <= 0 || s.threshold === null
      ? null
      : Math.max(0, Math.floor((s.threshold - s.tokens) / perTurn))
  const price = snap.mainModel === undefined ? null : readPrice(snap.mainModel)
  const carry = (tokens: number): number | null =>
    price === null ? null : (tokens * snap.steps * price) / 1e6
  // A session of an older version has no record of its calls: no server is known as unused.
  const unused = (snap.mcpCalls.includes(UNKNOWN_CALLS) ? [] : s.servers)
    .filter((v) => !v.tools.some((t) => snap.mcpCalls.includes(t)))
    .map((v) => ({ name: v.name, tokens: v.tokens, count: v.tools.length }))
  return {
    detail: s.detail,
    tokens: s.tokens,
    window: s.window,
    overhead,
    messages: s.tokens - overhead,
    // A sample of an older shape (a hot reload) has no buffer.
    buffer: s.threshold === null ? 0 : (s.buffer ?? 0),
    perTurn,
    turnsLeft,
    steps: snap.steps,
    carryUsd: carry(overhead),
    categories: s.categories.map((r) => ({ ...r, carryUsd: carry(r.tokens) })),
    unused,
    deadWeight: unused.reduce((n, v) => n + v.tokens, 0),
  }
}

// The cells of the bar: a fixed count, so no box takes its width from the pane.
export const BAR_CELLS = 40

// How many cells of the bar each part of the window has. The used parts come first, then the
// free room, then the room that auto-compaction keeps. An overhead has one cell at least.
export const barCells = (
  v: Pick<ContextView, 'tokens' | 'window' | 'overhead' | 'buffer'>,
  width = BAR_CELLS,
): { overhead: number; messages: number; free: number; buffer: number } => {
  if (v.window <= 0) return { overhead: 0, messages: 0, free: width, buffer: 0 }
  const cells = (n: number) => Math.min(width, Math.max(0, Math.round((n / v.window) * width)))
  const overhead = v.overhead > 0 ? Math.max(1, cells(v.overhead)) : 0
  const used = Math.max(overhead, cells(v.tokens))
  const buffer = Math.min(width - used, cells(v.buffer))
  return { overhead, messages: used - overhead, free: width - used - buffer, buffer }
}

export type BarSegment = { text: string; color: string }

// A hex color with each channel at 55 percent: the darker shade of a tone.
export const darker = (hex: string): string =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * 0.55)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

// The bar as segments of one character, the full block: a second glyph (a shade, a lower
// block) is from another font or has another height, and is a few pixels off beside it. So
// only the color tells the parts: the context tone for the overhead, its darker shade for the
// messages, the strip color for the free room and the dim color for the compact buffer.
export const barSegments = (v: ContextView): BarSegment[] => {
  const c = barCells(v)
  const tone = contextColor(v)
  const segs: BarSegment[] = [
    { text: '█'.repeat(c.overhead), color: tone },
    { text: '█'.repeat(c.messages), color: darker(tone) },
    { text: '█'.repeat(c.free), color: PALETTE.strip },
    { text: '█'.repeat(c.buffer), color: PALETTE.dim },
  ]
  return segs.filter((s) => s.text !== '')
}

const DOT: Cell = { text: '·', dim: true }
const joined = (parts: Cell[]): Cell[] => parts.flatMap((p, i) => (i === 0 ? [p] : [DOT, p]))
// The width of a row of cells that has one cell between its cells.
const widthOf = (cells: Cell[]): number =>
  cells.reduce((n, c) => n + cellText(c, 0, 0).length, 0) + Math.max(0, cells.length - 1)

// The row of a context length: the length, the growth of a turn and the turns before a
// compaction. A row wider than `room` drops the turns, then the growth, then the counts.
export const contextHead = (v: ContextView, room: number): Cell[] => {
  const ctx = (isFull: boolean): Cell => ({
    text: '',
    ctx: { tokens: v.tokens, window: v.window, isFull },
    color: contextColor(v),
  })
  const growth: Cell[] =
    v.perTurn === null ? [] : [{ text: `+${formatTokens(v.perTurn)}/turn`, dim: true }]
  const left: Cell[] =
    v.turnsLeft === null ? [] : [{ text: `≈${v.turnsLeft} turns to compact`, dim: true }]
  const rows = [
    joined([ctx(true), ...growth, ...left]),
    joined([ctx(true), ...growth]),
    [ctx(true)],
  ]
  return rows.find((cells) => widthOf(cells) <= room) ?? [ctx(false)]
}

// The totals below the bar of the agents screen.
export const contextSummary = (v: ContextView): Cell[] =>
  joined([
    { text: `overhead ${formatTokens(v.overhead)}`, dim: true },
    { text: `messages ${formatTokens(v.messages)}`, dim: true },
    ...(v.deadWeight > 0 ? [{ text: `dead weight ${formatTokens(v.deadWeight)}`, dim: true }] : []),
  ])

// The headline of the overhead table: its tokens, its share of the window and its carry cost.
export const overheadHead = (v: ContextView): Cell[] =>
  joined([
    { text: `overhead ${formatTokens(v.overhead)}`, bold: true },
    { text: `${Math.round((v.overhead / v.window) * 100)}% of window`, dim: true },
    ...(v.carryUsd === null
      ? []
      : [{ text: `≈$${formatUsd(v.carryUsd)} over ${v.steps} steps`, dim: true }]),
  ])
