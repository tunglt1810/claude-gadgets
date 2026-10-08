import type {
  BreakCause,
  BreakEntry,
  BreaksView,
  Cell,
  Fingerprint,
  LastPrompt,
  Snapshot,
} from '../types'
import { ttlMs } from './countdown'
import { shortModel } from './dashboard'
import { formatDuration, formatTokens, formatUsd } from './format'
import { PALETTE } from './palette'
import { rewriteCost } from './price'
import type { Ttl } from './ttl'

// A prefix below this count can be below the minimum that the API caches.
const MIN_EXPECTED = 4000
// A step that reads less than this part of the expected tokens is a break.
const BREAK_SHARE = 0.5
// The entries that the list keeps.
const MAX_BREAKS = 50

// A short hash of a text (djb2): the mod keeps no text of a prompt.
export const hashOf = (text: string): string => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export const hashes = (rows: readonly { name: string; text: string }[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r.name, hashOf(r.text)]))

// The listed tools of a tool list, each as the hash of its description, and the names of the
// deferred ones. A deferred tool has no schema in a request, so its change breaks no cache.
// `known` holds the `tool.describe` results of this process. With no result, a stored name is
// deferred, and so is an MCP tool: the engine defers those by its rule.
export const listedTools = (
  list: readonly { name: string; description: string; mcp: boolean }[],
  known: ReadonlyMap<string, boolean>,
  stored: readonly string[],
): { tools: Record<string, string>; deferred: string[] } => {
  const isDeferred = (t: { name: string; mcp: boolean }) =>
    known.get(t.name) ?? (stored.includes(t.name) || t.mcp)
  return {
    tools: hashes(
      list.filter((t) => !isDeferred(t)).map((t) => ({ name: t.name, text: t.description })),
    ),
    deferred: list.filter(isDeferred).map((t) => t.name),
  }
}

// One main step with a usage. `tokens` is its prompt: the input, the cache reads and the
// cache writes.
export type StepPrompt = {
  tokens: number
  cacheRead: number
  // The tokens that the step wrote to the cache. A step that wrote none ran with no cache.
  cacheWrite: number
  model: string
  messageCount: number
  at: number
  fingerprint: Fingerprint
}

// The compaction of the main loop that came after the last main step.
export type Compaction = { trigger: string; before?: number; after?: number }

// The break of a step, or null. `expected` is what the cache can serve: the prompt of the
// step before, or the prompt of this step when it is shorter (after a compaction).
export const detect = (
  last: LastPrompt | undefined,
  step: StepPrompt,
): { expected: number; rewritten: number } | null => {
  if (last === undefined) return null
  // With the cache off (a setting, or a gateway that does not cache), no step reads or writes it.
  // A break writes the prefix again.
  if (step.cacheWrite === 0) return null
  const expected = Math.min(last.tokens, step.tokens)
  if (expected < MIN_EXPECTED || step.cacheRead >= expected * BREAK_SHARE) return null
  return { expected, rewritten: expected - step.cacheRead }
}

// The first difference of two maps as text, with a count of the others, or null with no
// difference. A map that is absent was not read: it gives no difference.
export const diffOf = (
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): string | null => {
  if (a === undefined || b === undefined) return null
  const removed = Object.keys(a).filter((k) => !(k in b))
  const added = Object.keys(b).filter((k) => !(k in a))
  const changed = Object.keys(a).filter((k) => k in b && a[k] !== b[k])
  const all = [
    ...removed.sort().map((k) => `- ${k}`),
    ...added.sort().map((k) => `+ ${k}`),
    ...changed.sort().map((k) => `${k} changed`),
  ]
  const first = all[0]
  if (first === undefined) return null
  return all.length === 1 ? first : `${first} · +${all.length - 1} more`
}

// Why a step broke the cache: the first cause that applies, in the order of the spec.
export const causeOf = (
  last: LastPrompt,
  step: StepPrompt,
  lifetimeMs: number,
  compaction: Compaction | null,
): { cause: BreakCause; detail: string } => {
  if (compaction !== null) {
    const counts =
      compaction.before === undefined || compaction.after === undefined
        ? ''
        : ` · ${formatTokens(compaction.before)} → ${formatTokens(compaction.after)}`
    return { cause: 'compact', detail: `${compaction.trigger}${counts}` }
  }
  if (step.messageCount < last.messageCount)
    return { cause: 'history', detail: `${last.messageCount} → ${step.messageCount} messages` }
  if (step.model !== last.model)
    return { cause: 'model', detail: `${shortModel(last.model)} → ${shortModel(step.model)}` }
  if (step.at - last.at > lifetimeMs)
    return { cause: 'ttl', detail: `idle ${formatDuration(step.at - last.at)}` }
  const parts = [
    ['tools', 'tools'],
    ['prompt', 'sections'],
    ['context', 'context'],
  ] as const
  for (const [cause, part] of parts) {
    const detail = diffOf(last.fingerprint[part], step.fingerprint[part])
    if (detail !== null) return { cause, detail }
  }
  return { cause: 'unknown', detail: 'no change seen' }
}

type Kept = Pick<Snapshot, 'lastPrompt' | 'breaks' | 'breakCount' | 'lostUsd'>

// The break fields of a snapshot after one main step with a usage. `ttl` is the cache
// lifetime of the main loop. A part of the fingerprint that the step did not read stays as
// the step before had it.
export const withStep = (
  s: Kept,
  step: StepPrompt,
  ttl: Ttl,
  compaction: Compaction | null,
): Required<Omit<Kept, 'lastPrompt'>> & { lastPrompt: LastPrompt } => {
  const fingerprint = { ...s.lastPrompt?.fingerprint, ...step.fingerprint }
  const now = { ...step, fingerprint }
  const found = detect(s.lastPrompt, now)
  const why =
    found === null || s.lastPrompt === undefined
      ? null
      : causeOf(s.lastPrompt, now, ttlMs(ttl), compaction)
  const entry: BreakEntry | null =
    found === null || why === null
      ? null
      : {
          at: step.at,
          ...why,
          rewritten: found.rewritten,
          lostUsd: rewriteCost(step.model, found.rewritten, ttl, step.tokens),
        }
  return {
    lastPrompt: {
      tokens: step.tokens,
      model: step.model,
      messageCount: step.messageCount,
      at: step.at,
      fingerprint,
      ...(entry === null ? {} : { cause: entry.cause }),
    },
    breaks: entry === null ? (s.breaks ?? []) : [...(s.breaks ?? []), entry].slice(-MAX_BREAKS),
    breakCount: (s.breakCount ?? 0) + (entry === null ? 0 : 1),
    lostUsd: (s.lostUsd ?? 0) + (entry?.lostUsd ?? 0),
  }
}

// What the pane draws of the breaks of a snapshot. A record of an older version has none.
export const breaksView = (s: Pick<Snapshot, 'breaks' | 'breakCount' | 'lostUsd'>): BreaksView => ({
  count: s.breakCount ?? 0,
  lostUsd: s.lostUsd ?? 0,
  entries: s.breaks ?? [],
})

// The cell after the cache button, and the headline of the cache screen.
export const breaksHead = (v: BreaksView): Cell =>
  v.count === 0
    ? { text: 'no break', dim: true }
    : {
        text: `${v.count} ${v.count === 1 ? 'break' : 'breaks'} · ≈$${formatUsd(v.lostUsd)} lost`,
        color: PALETTE.yellow,
      }

// The local time of a moment as `HH:MM`. `offsetMin` is the minutes that the local time is
// behind UTC, as `Date.getTimezoneOffset` gives them.
export const clockText = (at: number, offsetMin = new Date(at).getTimezoneOffset()): string => {
  const d = new Date(at - offsetMin * 60_000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
}

// A person can know an expired cache and a compaction before they occur: the warning tone.
// Each other cause is in the danger tone.
export const causeColor = (cause: BreakCause): string =>
  cause === 'ttl' || cause === 'compact' ? PALETTE.yellow : PALETTE.red
