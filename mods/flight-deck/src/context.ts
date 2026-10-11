import type {
  Cell,
  ContextGroup,
  ContextKind,
  ContextRow,
  ContextSample,
  ContextState,
  ContextView,
  Snapshot,
} from '../types'
import { dotted, rowWidth } from './cell'
import { formatTokens, formatUsd } from './format'
import { PALETTE } from './palette'
import { readPrice } from './price'
import { UNKNOWN_CALLS } from './snapshot'
import { contextColor } from './window'

// The category that is the conversation, by the name the engine gives it: no `kind` parts it
// from the overhead.
const MESSAGES = 'Messages'

// The color of each row that has its own part of the bar. Each other used row is in one part.
export const PART_COLORS: Record<string, string> = {
  [MESSAGES]: PALETTE.cyan,
  'System tools': PALETTE.orange,
  'MCP tools': PALETTE.green,
  Skills: PALETTE.yellow,
}

// The order of the kinds on the screen.
const KINDS: ContextKind[] = ['used', 'buffer', 'free', 'deferred']

// A row of the overhead: content of the window that is not the conversation.
export const isOverhead = (r: Pick<ContextRow, 'name' | 'kind'>): boolean =>
  r.kind === 'used' && r.name !== MESSAGES

// The color of the part of the bar that holds a used row; null for a row of another kind,
// whose part is too dark for text.
export const rowColor = (r: Pick<ContextRow, 'name' | 'kind'>): string | null =>
  r.kind !== 'used'
    ? null
    : Object.hasOwn(PART_COLORS, r.name)
      ? (PART_COLORS[r.name] ?? PALETTE.dim)
      : PALETTE.dim

// The part of `$.session.usage({ breakdown })`'s context that a sample reads. A list can be
// absent: a summary breakdown, or an engine of another version.
export type UsageContext = {
  tokens?: number
  window?: number
  breakdown?: {
    categories: { name: string; tokens: number; kind: string }[]
    totalTokens: number
    // The window that the engine measures against: the compaction window.
    rawMaxTokens?: number
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
// The items of a row go by the row's name: a row of another name has none.
export const sampleOf = (c: UsageContext, detail: 'summary' | 'full'): ContextSample | null => {
  const b = c.breakdown
  if (b === undefined) return null
  // The engine measures the context against the compaction window.
  const window = b.rawMaxTokens !== undefined && b.rawMaxTokens > 0 ? b.rawMaxTokens : c.window
  if (window === undefined || window <= 0) return null
  type Tool = NonNullable<typeof b.mcpTools>[number]
  const serversOf = (tools: Tool[]) =>
    byTokens(
      [...new Set(tools.map((t) => t.serverName))].map((name) => {
        const own = tools.filter((t) => t.serverName === name)
        return {
          name,
          tokens: own.reduce((n, t) => n + t.tokens, 0),
          tools: own.map((t) => t.name),
        }
      }),
    )
  const group = (s: { name: string; tokens: number; tools: string[] }): ContextGroup => ({
    name: s.name,
    tokens: s.tokens,
    count: s.tools.length,
  })
  const tools = b.mcpTools ?? []
  // A tool that loads on demand is not in the window.
  const servers = serversOf(tools.filter((t) => t.isLoaded))
  const items: Record<string, ContextGroup[]> = {
    'MCP tools': servers.map(group),
    'MCP tools (deferred)': serversOf(tools.filter((t) => !t.isLoaded)).map(group),
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
    window,
    threshold:
      b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined
        ? b.autoCompactThreshold
        : null,
    rows: KINDS.flatMap((kind) =>
      byTokens(
        b.categories
          .filter((r) => r.kind === kind)
          .map((r) => ({
            name: r.name,
            tokens: r.tokens,
            kind,
            items: Object.hasOwn(items, r.name) ? (items[r.name] ?? []) : [],
          })),
      ),
    ),
    servers,
  }
}

// The part of the last sample below which a full count is a compaction.
const COMPACTED = 0.8

// The state with a new sample. The first sample of a session is the base of its growth, and
// so is an estimate with fewer tokens than the last sample: a compaction. A full count is
// lower than an estimate of the same context, and its reply can come late, so it starts no
// base. An estimate is higher than the count of the API for the same context, so the first
// sample of the API after an estimate is a base too. `isTurnEnd` counts a turn, and
// `missedTurns` the turns before it whose end gave no sample.
export const sampled = (
  c: ContextState,
  id: string,
  sample: ContextSample,
  isTurnEnd: boolean,
  missedTurns = 0,
): ContextState => {
  const last = c.sessionId === id ? c.sample?.tokens : undefined
  // A full count can be a little lower than an estimate: only a clear drop is a compaction.
  const isCompacted =
    last !== undefined &&
    sample.tokens < last &&
    (sample.detail === 'summary' || sample.tokens < last * COMPACTED)
  const isFirstCount = c.sample?.isEstimate === true && !sample.isEstimate
  if (c.sessionId !== id || c.base === null || isCompacted || isFirstCount)
    return { sessionId: id, sample, base: sample.tokens, turns: 0 }
  return { ...c, sample, turns: c.turns + (isTurnEnd ? 1 : 0) + missedTurns }
}

// What the pane draws of a context, or null with no sample. The carry cost prices the
// overhead of the latest sample at each step of the main loop: an estimate.
export const contextView = (
  state: ContextState,
  snap: Pick<Snapshot, 'steps' | 'mcpCalls' | 'mainModel'>,
): ContextView | null => {
  const s = state.sample
  // A sample of an older shape (a hot reload) has no rows: the next turn end gives a new one.
  if (s === null || !Array.isArray(s.rows)) return null
  const overhead = Math.min(
    s.tokens,
    s.rows.filter(isOverhead).reduce((n, r) => n + r.tokens, 0),
  )
  const conversation = s.rows.find((r) => r.kind === 'used' && r.name === MESSAGES)
  const perTurn =
    state.base === null || state.turns === 0
      ? null
      : Math.round((s.tokens - state.base) / state.turns)
  // A context that is shorter than its base has no growth to show.
  const growth = perTurn !== null && perTurn > 0 ? perTurn : null
  const toCompact = s.threshold === null ? null : Math.max(0, s.threshold - s.tokens)
  const turnsLeft = growth === null || toCompact === null ? null : Math.floor(toCompact / growth)
  const price = snap.mainModel === undefined ? null : readPrice(snap.mainModel, s.tokens)
  // A session of an older version has no record of its steps and its calls: a carry cost from
  // it is too small, and no server is known as unused.
  const isPartial = snap.mcpCalls.includes(UNKNOWN_CALLS)
  const carry = (tokens: number): number | null =>
    price === null || isPartial ? null : (tokens * snap.steps * price) / 1e6
  const unused = (isPartial ? [] : s.servers)
    .filter((v) => !v.tools.some((t) => snap.mcpCalls.includes(t)))
    .map((v) => ({ name: v.name, tokens: v.tokens, count: v.tools.length }))
  return {
    detail: s.detail,
    tokens: s.tokens,
    window: s.window,
    overhead,
    messages: conversation?.tokens ?? s.tokens - overhead,
    toCompact,
    perTurn: growth,
    turnsLeft,
    steps: snap.steps,
    carryUsd: carry(overhead),
    rows: s.rows.map((r) => ({
      ...r,
      share: r.kind === 'deferred' ? null : Math.round((r.tokens / s.window) * 1000) / 10,
      carryUsd: isOverhead(r) ? carry(r.tokens) : null,
    })),
    unused,
    deadWeight: unused.reduce((n, v) => n + v.tokens, 0),
  }
}

// The cells of the bar: a fixed count, so no box takes its width from the pane.
export const BAR_CELLS = 40

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
// only the color tells the parts: a color for each large category, the dim color for the rest
// of the used rows, its darker shade for the compact buffer and the strip color for the free
// room. A part with tokens has one cell at least, and the free room has the cells that stay.
export const barSegments = (v: Pick<ContextView, 'rows' | 'window'>): BarSegment[] => {
  const used = v.rows.filter((r) => r.kind === 'used')
  const sum = (rows: { tokens: number }[]) => rows.reduce((n, r) => n + r.tokens, 0)
  const isNamed = (r: { name: string }) => Object.hasOwn(PART_COLORS, r.name)
  const parts =
    v.window <= 0
      ? []
      : [
          ...used
            .filter(isNamed)
            .map((r) => ({ tokens: r.tokens, color: PART_COLORS[r.name] ?? PALETTE.dim })),
          { tokens: sum(used.filter((r) => !isNamed(r))), color: PALETTE.dim },
          {
            tokens: sum(v.rows.filter((r) => r.kind === 'buffer')),
            color: darker(PALETTE.dim),
          },
        ].filter((p) => p.tokens > 0)
  let left = BAR_CELLS
  const segs = parts.map((p) => {
    const n = Math.min(left, Math.max(1, Math.round((p.tokens / v.window) * BAR_CELLS)))
    left -= n
    return { text: '█'.repeat(n), color: p.color }
  })
  return [...segs, { text: '█'.repeat(left), color: PALETTE.strip }].filter((s) => s.text !== '')
}

// The row of a context length: the length, the growth of a turn, the tokens before a
// compaction and the turns before it. A row wider than `room` drops the turns, then the
// growth, then the tokens before a compaction, then the counts.
export const contextHead = (v: ContextView, room: number): Cell[] => {
  const ctx = (isFull: boolean): Cell => ({
    text: '',
    ctx: { tokens: v.tokens, window: v.window, isFull },
    color: contextColor(v),
  })
  const growth: Cell[] =
    v.perTurn === null ? [] : [{ text: `+${formatTokens(v.perTurn)}/turn`, dim: true }]
  const toCompact: Cell[] =
    v.toCompact === null ? [] : [{ text: `${formatTokens(v.toCompact)} to compact`, dim: true }]
  const turns: Cell[] = v.turnsLeft === null ? [] : [{ text: `≈${v.turnsLeft} turns`, dim: true }]
  const rows = [
    dotted([ctx(true), ...growth, ...toCompact, ...turns]),
    dotted([ctx(true), ...growth, ...toCompact]),
    dotted([ctx(true), ...toCompact]),
    [ctx(true)],
  ]
  return rows.find((cells) => rowWidth(cells) <= room) ?? [ctx(false)]
}

// The totals below the bar of the agents screen.
export const contextSummary = (v: ContextView): Cell[] =>
  dotted([
    { text: `overhead ${formatTokens(v.overhead)}`, dim: true },
    { text: `messages ${formatTokens(v.messages)}`, dim: true },
    ...(v.deadWeight > 0 ? [{ text: `dead weight ${formatTokens(v.deadWeight)}`, dim: true }] : []),
  ])

// The headline of the overhead table: its tokens, its share of the window and its carry cost.
export const overheadHead = (v: ContextView): Cell[] =>
  dotted([
    { text: `overhead ${formatTokens(v.overhead)}`, bold: true },
    { text: `${Math.round((v.overhead / v.window) * 100)}% of window`, dim: true },
    ...(v.carryUsd === null
      ? []
      : [{ text: `≈$${formatUsd(v.carryUsd)} over ${v.steps} steps`, dim: true }]),
  ])
