import { cacheHitTone, countdownTone, remainingMs, ttlMs } from './countdown'
import { formatCountdown, formatDuration, formatTokens, formatUsd } from './format'
import { PALETTE } from './palette'
import type { Snapshot } from './snapshot'
import { cacheHitPct } from './usage'
import { workElapsed } from './work'

export type Segment = {
  text: string
  color?: string
  bold?: boolean
  strike?: boolean
  inverse?: boolean
}

type Input = {
  snap: Snapshot
  busySince: number | null
  now: number
  ttl: '5m' | '1h'
  columns: number
}

const TONE = { ok: PALETTE.green, warn: PALETTE.yellow, danger: PALETTE.red } as const
const BAR_CELLS = 10
// Between groups; metrics inside a group are separated by two spaces.
const SEP: Segment = { text: ' │ ', color: PALETTE.dim }

// Every metric reads `icon label value`, with the same spacing. Icons are single-width,
// text-presentation characters: emoji are double width and misalign the row.
// `in` goes up to the server, `out` comes back down; `calls` counts tool calls.
const LABEL = {
  in: '↑ in',
  out: '↓ out',
  hit: '◈ hit',
  tools: '⌘ calls',
  work: '◷ work',
  cost: '$ cost',
  diff: '± diff',
  cache: '◔ cache',
} as const

const GROUPS: readonly (readonly Part[])[] = [
  ['in', 'out', 'hit'],
  ['tools', 'work'],
  ['cost', 'diff'],
  ['cache'],
]

// Metrics in the order they are dropped when the band is too narrow (first = dropped first).
const DROP_ORDER = ['bar', 'diff', 'hit', 'tools', 'work', 'cost', 'out', 'in'] as const
type Part = (typeof DROP_ORDER)[number] | 'cache'

const width = (segs: Segment[]): number => segs.reduce((n, s) => n + s.text.length, 0)

// The band as styled segments. Plain single-width characters only: emoji are double width
// and misalign the row. Parts are dropped, least important first, until it fits `columns`.
export const bandSegments = ({ snap, busySince, now, ttl, columns }: Input): Segment[] => {
  const total = ttlMs(ttl)
  const rem = remainingMs(snap.lastStepAt, now, total)
  const tone = countdownTone(rem)
  const expired = tone === 'expired'
  const pct = cacheHitPct(snap.totals)
  const filled = rem === null || rem <= 0 ? 0 : Math.max(1, Math.round((rem / total) * BAR_CELLS))
  // The terminal has no blink attribute: pulse by alternating bold/inverse each second.
  const pulse = tone === 'danger' && Math.floor(now / 1000) % 2 === 0
  const cacheColor = expired ? PALETTE.dim : TONE[tone]

  const parts: Record<Part, Segment[]> = {
    // Every prompt token, cached ones included: `input_tokens` alone is only the uncached
    // remainder, which is near zero once the prompt cache is warm.
    in: [
      {
        text: `${LABEL.in} ${formatTokens(snap.totals.input + snap.totals.cacheRead + snap.totals.cacheWrite)}`,
        color: PALETTE.cyan,
      },
    ],
    out: [{ text: `${LABEL.out} ${formatTokens(snap.totals.output)}`, color: PALETTE.purple }],
    hit: [{ text: `${LABEL.hit} ${pct}%`, color: TONE[cacheHitTone(pct)] }],
    tools: [{ text: `${LABEL.tools} ${snap.tools}`, color: PALETTE.orange }],
    work: [
      {
        text: `${LABEL.work} ${formatDuration(workElapsed({ workMs: snap.workMs, active: 0, busySince }, now))}`,
        color: PALETTE.fg,
        bold: busySince !== null,
      },
    ],
    cost: [{ text: `${LABEL.cost} ${formatUsd(snap.costUsd)}`, color: PALETTE.yellow }],
    diff: [
      { text: `${LABEL.diff} +${snap.added}`, color: PALETTE.green },
      { text: ` -${snap.removed}`, color: PALETTE.red },
    ],
    cache: [
      {
        text: `${LABEL.cache} ${formatCountdown(rem)}`,
        color: cacheColor,
        bold: pulse,
        inverse: pulse,
        strike: expired && rem !== null,
      },
    ],
    bar: [
      { text: ' ' },
      { text: '━'.repeat(filled), color: cacheColor },
      { text: '━'.repeat(BAR_CELLS - filled), color: PALETTE.track },
    ],
  }

  const build = (dropped: ReadonlySet<string>): Segment[] => {
    const segs: Segment[] = []
    for (const group of GROUPS) {
      const present = group.filter((part) => !dropped.has(part))
      if (present.length === 0) continue
      if (segs.length > 0) segs.push(SEP)
      present.forEach((part, i) => {
        if (i > 0) segs.push({ text: '  ' })
        segs.push(...parts[part])
        if (part === 'cache' && !dropped.has('bar')) segs.push(...parts.bar)
      })
    }
    return segs
  }

  const dropped = new Set<string>()
  let segs = build(dropped)
  for (const next of DROP_ORDER) {
    if (width(segs) <= columns) break
    dropped.add(next)
    segs = build(dropped)
  }
  return segs
}
