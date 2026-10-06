import { cacheHitTone, countdownTone, remainingMs, ttlMs } from './countdown'
import { formatCountdown, formatDuration, formatTokens, formatUsd } from './format'
import { PALETTE } from './palette'
import type { Snapshot } from './snapshot'
import { type Counts, countsOf } from './tween'
import { cacheHitPct } from './usage'
import { workElapsed } from './work'

export type Segment = {
  text: string
  color?: string
  bold?: boolean
  inverse?: boolean
  // The agents count: the band draws it as the button that toggles the agents pane.
  isButton?: boolean
}

type Input = {
  snap: Snapshot
  busySince: number | null
  now: number
  ttl: '5m' | '1h'
  columns: number
  // The counts as they are drawn during a tween; the snapshot's own counts when absent.
  shown?: Counts
  // One agent's numbers are drawn: the metrics that exist per session only are left out.
  isAgentView?: boolean
  // The agents pane is open: the button carries a mark.
  isPaneOpen?: boolean
  // In an agent view: the agent's model id and effort, drawn after the mark.
  model?: string
}

const TONE = { ok: PALETTE.green, warn: PALETTE.yellow, danger: PALETTE.red } as const
const BAR_CELLS = 10
// Between groups; metrics inside a group are separated by two spaces.
const SEP: Segment = { text: ' │ ', color: PALETTE.dim }

// Every metric reads `icon label value`, with the same spacing. Icons are single-width,
// text-presentation characters: emoji are double width and misalign the row.
// `in` goes up to the server, `out` comes back down; `calls` counts tool calls; `agents`
// and `bg` count the subagents and the background tasks that were started.
const LABEL = {
  in: '↑ in',
  out: '↓ out',
  hit: '◈ cache',
  tools: '⌘ calls',
  bg: '◇ bg',
  work: '◷ work',
  cost: '$ cost',
  diff: '± diff',
  cache: '◔ cache',
  // The countdown beside the percentage: the percentage has the label.
  clock: '◔',
} as const

// The percentage of the prompt tokens that the cache gave, and the time the cache has left.
const GROUPS: readonly (readonly Part[])[] = [
  ['in', 'out'],
  ['hit', 'cache'],
  ['tools', 'agents', 'bg', 'work'],
  ['cost', 'diff'],
]

// Metrics in the order they are dropped when the band is too narrow (first = dropped first).
const DROP_ORDER = [
  'bar',
  'bg',
  'diff',
  'hit',
  'tools',
  'work',
  'cost',
  'out',
  'in',
  'agents',
] as const
type Part = (typeof DROP_ORDER)[number] | 'cache'
// `timer` is the countdown with no label: it is drawn in place of `cache`, never dropped by name.
type Parts = Record<Part | 'timer', Segment[]>

const SESSION_ONLY = ['cost', 'work', 'agents', 'bg'] as const
const AGENT_MARK: Segment = { text: '◆ agent', color: PALETTE.orange, bold: true }

// One agent's own numbers, as the band labels them: no cost (the engine counts it per
// session only) and no countdown (a pane redrawn each second drops a click on a desktop).
export const statSegments = (snap: Snapshot): Segment[] => {
  const pct = cacheHitPct(snap.totals)
  const gap: Segment = { text: '  ' }
  return [
    { text: `${LABEL.in} ${formatTokens(countsOf(snap).in)}`, color: PALETTE.cyan },
    gap,
    { text: `${LABEL.out} ${formatTokens(snap.totals.output)}`, color: PALETTE.purple },
    gap,
    { text: `${LABEL.hit} ${pct}%`, color: TONE[cacheHitTone(pct)] },
    gap,
    { text: `${LABEL.tools} ${snap.tools}`, color: PALETTE.orange },
    gap,
    { text: `${LABEL.diff} +${snap.added}`, color: PALETTE.green },
    { text: ` -${snap.removed}`, color: PALETTE.red },
  ]
}

// The button is drawn as `[ label ]`: four cells of chrome around its text.
const BUTTON_CHROME = 4
const width = (segs: Segment[]): number =>
  segs.reduce((n, s) => n + s.text.length + (s.isButton ? BUTTON_CHROME : 0), 0)

// The band as styled segments. Plain single-width characters only: emoji are double width
// and misalign the row. Parts are dropped, least important first, until it fits `columns`.
// The fit uses the target counts, so a part does not come and go while a count animates.
export const bandSegments = ({
  snap,
  busySince,
  now,
  ttl,
  columns,
  shown,
  isAgentView = false,
  isPaneOpen = false,
  model,
}: Input): Segment[] => {
  const total = ttlMs(ttl)
  const rem = remainingMs(snap.lastStepAt, now, total)
  const tone = countdownTone(rem)
  const expired = tone === 'expired'
  const pct = cacheHitPct(snap.totals)
  const filled = rem === null || rem <= 0 ? 0 : Math.max(1, Math.round((rem / total) * BAR_CELLS))
  // The terminal has no blink attribute: pulse by alternating bold/inverse each second.
  const pulse = tone === 'danger' && Math.floor(now / 1000) % 2 === 0
  const cacheColor = expired ? PALETTE.dim : TONE[tone]
  const countdown = (label: string): Segment[] => [
    { text: `${label} ${formatCountdown(rem)}`, color: cacheColor, bold: pulse, inverse: pulse },
  ]

  const partsFor = (c: Counts): Parts => ({
    // Every prompt token, cached ones included: `input_tokens` alone is only the uncached
    // remainder, which is near zero once the prompt cache is warm.
    in: [{ text: `${LABEL.in} ${formatTokens(c.in)}`, color: PALETTE.cyan }],
    out: [{ text: `${LABEL.out} ${formatTokens(c.out)}`, color: PALETTE.purple }],
    hit: [{ text: `${LABEL.hit} ${pct}%`, color: TONE[cacheHitTone(pct)] }],
    tools: [{ text: `${LABEL.tools} ${c.tools}`, color: PALETTE.orange }],
    agents: [
      {
        // The icon is the pane's disclosure mark: closed or open.
        text: `${isPaneOpen ? '▾' : '▸'} agents ${snap.agents}`,
        color: PALETTE.orange,
        isButton: true,
      },
    ],
    bg: [{ text: `${LABEL.bg} ${snap.bg}`, color: PALETTE.orange }],
    work: [
      {
        text: `${LABEL.work} ${formatDuration(workElapsed({ workMs: snap.workMs, active: 0, busySince }, now))}`,
        color: PALETTE.fg,
        bold: busySince !== null,
      },
    ],
    cost: [{ text: `${LABEL.cost} ${formatUsd(c.cost)}`, color: PALETTE.yellow }],
    diff: [
      { text: `${LABEL.diff} +${c.added}`, color: PALETTE.green },
      { text: ` -${c.removed}`, color: PALETTE.red },
    ],
    cache: countdown(LABEL.cache),
    timer: countdown(LABEL.clock),
    bar: [
      { text: ' ' },
      { text: '━'.repeat(filled), color: cacheColor },
      { text: '━'.repeat(BAR_CELLS - filled), color: PALETTE.track },
    ],
  })

  const build = (parts: Parts, dropped: ReadonlySet<string>): Segment[] => {
    const mark: Segment[] = model === undefined ? [] : [{ text: ` ${model}`, color: PALETTE.fg }]
    const segs: Segment[] = isAgentView ? [AGENT_MARK, ...mark, SEP] : []
    const start = segs.length
    for (const group of GROUPS) {
      const present = group.filter((part) => !dropped.has(part))
      if (present.length === 0) continue
      if (segs.length > start) segs.push(SEP)
      present.forEach((part, i) => {
        if (i > 0) segs.push({ text: '  ' })
        // Beside the percentage the countdown has no label of its own.
        segs.push(...(part === 'cache' && !dropped.has('hit') ? parts.timer : parts[part]))
        // An expired cache has no time left to show: the bar is drawn for a live one only.
        if (part === 'cache' && !expired && !dropped.has('bar')) segs.push(...parts.bar)
      })
    }
    return segs
  }

  const dropped = new Set<string>(isAgentView ? SESSION_ONLY : [])
  const target = partsFor(countsOf(snap))
  let segs = build(target, dropped)
  for (const next of DROP_ORDER) {
    if (width(segs) <= columns) break
    dropped.add(next)
    segs = build(target, dropped)
  }
  return shown === undefined ? segs : build(partsFor(shown), dropped)
}
