# flight-deck Cache Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mod finds each cache break of the main loop, and shows its cause and its cost on the band and on a new cache screen of the pane.

**Architecture:** Pure functions in a new `src/breaks.ts` find a break from two consecutive main steps and give its cause. Four hooks change nothing: `prompt.compose`, `prompt.context`, `tool.describe` and `session.compact`. They and the `turn.step` hook give the functions their data. The result is in four new optional fields of the session snapshot, so the store keeps it. `src/layout.ts` draws a band part and `src/pane.tsx` draws a row and a screen.

**Tech Stack:** TypeScript, Bun 1.4.2, Claude Code 2.1.293 plugin API, `claude-code/testing`, Biome.

**Spec:** `docs/specs/2026-10-08-flight-deck-cache-break-design.md`

## Global Constraints

- All paths below are relative to the repository root. The mod is in `mods/flight-deck/`.
- Run each command from the repository root.
- Do the work on the branch `feat/flight-deck-cache-break`.
- `bun run check` must pass before a task is complete.
- TDD: write the test, see it fail, then write the code.
- Docs, code comments, identifiers, commit messages and drawn strings are English. Docs follow ASD-STE100.
- `mods/flight-deck/types/index.d.ts` has no imports. `src/` imports types from `../types`.
- A function that receives `$` is a module-level `function` declaration in `hooks/register.tsx`.
- `turn.step` is `async function*` and uses `const res = yield* next(e)`.
- `ui.render` does not write state. A write computes inside the updater: `update($, atom, c => ...)`.
- The four new hooks return the result of `next(e)` with no change. Their own record is in a `try` block.
- No emoji in drawn text. Each drawn character has a width of one cell.
- A drawn row is one row. Remove parts. Do not wrap.
- On a desktop, each cell in a row with a Button is a `Client` cell. Use the `cell()` and `rest()` helpers of `src/pane.tsx`.
- No box of the terminal tree takes its width from `columns`.
- The styling rules are in `docs/design-system.md`. Read it before a change to drawn text.
- A break: the cache read of a main step is less than 50 percent of `expected`, and `expected` is 4,000 tokens or more.
- The break list keeps the newest 50 entries.
- The causes, in order: `compact`, `history`, `model`, `ttl`, `tools`, `prompt`, `context`, `unknown`.
- An estimate has the `≈` prefix. An unknown value is `—`.
- Version: 0.7.0.

## Review Focus

1. A snapshot that version 0.6.0 stored, and a live meter from a hot reload: no `lastPrompt`, no `breaks`. The first step must give no break and no failure. Tests: Task 1 (`withStep`), Task 2.
2. A step with no usage (`res.usage` is null), and a step of a subagent. Neither must change `lastPrompt` or add a break. Test: Task 4.
3. A fingerprint with an absent part (no `prompt.compose` event before step 0, a `$.tool.list()` that fails). The absent part must give no difference, and the cause must go to the next row of the table. Test: Task 1 (`causeOf`).
4. A deferred tool that leaves or joins the tool list. It must not give the cause `tools`. Tests: Task 1 (`listedTools`), Task 4.
5. A narrow pane, and a pane state from a hot reload (no `isCache`). The rows must stay one row, no width must be negative, and a press must not fail. Test: Task 5.

---

### Task 1: Break detection and cause (`src/breaks.ts`)

**Files:**
- Create: `mods/flight-deck/src/breaks.ts`
- Create: `mods/flight-deck/src/breaks.test.ts`
- Modify: `mods/flight-deck/types/index.d.ts` (the `Snapshot` type, and new types after it)
- Modify: `mods/flight-deck/src/price.ts` (new `rewriteCost`)
- Modify: `mods/flight-deck/src/price.test.ts`

**Interfaces:**
- Consumes: `priceOf`, `rateOf`, `readOf` of `price.ts` (private, same file). `formatTokens`, `formatDuration`, `formatUsd` of `format.ts`. `shortModel` of `dashboard.ts`. `ttlMs` of `countdown.ts`. `PALETTE` of `palette.ts`.
- Produces, in `types/index.d.ts`: `BreakCause`, `Fingerprint`, `LastPrompt`, `BreakEntry`, `BreaksView`, and the `Snapshot` fields `lastPrompt?`, `breaks?`, `breakCount?`, `lostUsd?`, `deferred?`.
- Produces, in `price.ts`: `rewriteCost(model: string, tokens: number, ttl: Ttl, prompt: number): number | null`.
- Produces, in `breaks.ts`: `hashOf`, `hashes`, `listedTools`, `detect`, `diffOf`, `causeOf`, `withStep`, `breaksView`, `breaksHead`, `clockText`, `causeColor`, and the types `StepPrompt`, `Compaction`.

- [ ] **Step 1: Add the types**

In `mods/flight-deck/types/index.d.ts`, add these fields at the end of `Snapshot`, after `mainModel?: string`:

```ts
  // The last main step with a usage: its prompt, and what the mod knows of the request.
  lastPrompt?: LastPrompt
  // The cache breaks of the main loop, the oldest first: the newest 50.
  breaks?: BreakEntry[]
  // All breaks of the session, also those that left `breaks`, and the sum of their lost cost.
  breakCount?: number
  lostUsd?: number
  // The tools of the session that a `tool.describe` result gave as deferred.
  deferred?: string[]
```

Add these types after the `Snapshot` type:

```ts
// Why the cache read of a main step was much less than the prompt of the step before it.
export type BreakCause =
  | 'compact'
  | 'history'
  | 'model'
  | 'ttl'
  | 'tools'
  | 'prompt'
  | 'context'
  | 'unknown'

// Hashes of what a request carries before the conversation, each part by name: the sections
// of the system prompt, the blocks of the first user message, and the listed tools. A part is
// absent when the mod did not read it.
export type Fingerprint = {
  sections?: Record<string, string>
  context?: Record<string, string>
  tools?: Record<string, string>
}

// `tokens` is the prompt: the input, the cache reads and the cache writes. `at` is the time
// of the request. `cause` is present when the step was a cache break.
export type LastPrompt = {
  tokens: number
  model: string
  messageCount: number
  at: number
  fingerprint: Fingerprint
  cause?: BreakCause
}

// One cache break. `rewritten` is the tokens that the API wrote again. `lostUsd` is their
// cost as cache writes less their cost as cache reads; null for a model with no price.
export type BreakEntry = {
  at: number
  cause: BreakCause
  detail: string
  rewritten: number
  lostUsd: number | null
}

// What the pane draws of the cache breaks of a session.
export type BreaksView = { count: number; lostUsd: number; entries: BreakEntry[] }
```

- [ ] **Step 2: Write the failing price test**

Add to `mods/flight-deck/src/price.test.ts`. Change its import line to `import { costOf, engineGap, priceNote, readPrice, rewriteCost } from './price'`.

```ts
test('rewriteCost is the cost of a cache write less the cost of a cache read', () => {
  // Sonnet 5.5: a 1-hour write is 2 x $2, a 5-minute write 1.25 x $2, a read $0.10.
  expect(usd(rewriteCost('claude-sonnet-5-5', 1e6, '1h', 0))).toBe(3.9)
  expect(usd(rewriteCost('claude-sonnet-5-5', 1e6, '5m', 0))).toBe(2.4)
  // Haiku 5.5 with a long prompt: 1.25 x $0.50 less $0.05.
  expect(usd(rewriteCost('claude-haiku-5-5', 1e6, '5m', 150_000))).toBe(0.575)
  expect(usd(rewriteCost('claude-haiku-5-5', 1e6, '5m', 100_000))).toBe(0.115)
  expect(rewriteCost('m', 1e6, '5m', 0)).toBeNull()
})
```

- [ ] **Step 3: Write the failing tests of `breaks.ts`**

Create `mods/flight-deck/src/breaks.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import type { LastPrompt } from '../types'
import {
  breaksHead,
  breaksView,
  causeColor,
  causeOf,
  clockText,
  detect,
  diffOf,
  hashes,
  hashOf,
  listedTools,
  type StepPrompt,
  withStep,
} from './breaks'
import { PALETTE } from './palette'

const HOUR = 3_600_000
// Dollars rounded to a millionth: float sums are not exact.
const usd = (n: number | null | undefined): number => Math.round((n ?? Number.NaN) * 1e6) / 1e6
const last = (over: Partial<LastPrompt> = {}): LastPrompt => ({
  tokens: 100_000,
  model: 'claude-opus-5-5',
  messageCount: 40,
  at: 1000,
  fingerprint: {},
  ...over,
})
const step = (over: Partial<StepPrompt> = {}): StepPrompt => ({
  tokens: 101_000,
  cacheRead: 0,
  model: 'claude-opus-5-5',
  messageCount: 42,
  at: 2000,
  fingerprint: {},
  ...over,
})

test('hashOf gives one short text for one text', () => {
  expect(hashOf('abc')).toBe(hashOf('abc'))
  expect(hashOf('abc')).not.toBe(hashOf('abd'))
  expect(hashes([{ name: 'memory', text: 'a' }])).toEqual({ memory: hashOf('a') })
})

test('listedTools leaves out the deferred tools', () => {
  const list = [
    { name: 'Read', description: 'reads', mcp: false },
    { name: 'NotebookEdit', description: 'edits', mcp: false },
    { name: 'mcp__a__b', description: 'b', mcp: true },
    { name: 'mcp__a__c', description: 'c', mcp: true },
    { name: 'WebFetch', description: 'fetches', mcp: false },
  ]
  // A `tool.describe` result is first, then the stored names, then the rule: an MCP tool is
  // deferred.
  const known = new Map([
    ['NotebookEdit', true],
    ['mcp__a__c', false],
  ])
  const res = listedTools(list, known, ['WebFetch'])
  expect(Object.keys(res.tools).sort()).toEqual(['Read', 'mcp__a__c'])
  expect(res.tools.Read).toBe(hashOf('reads'))
  expect(res.deferred.sort()).toEqual(['NotebookEdit', 'WebFetch', 'mcp__a__b'])
})

test('detect finds a step that reads less than half of the expected tokens', () => {
  expect(detect(undefined, step())).toBeNull()
  expect(detect(last(), step({ cacheRead: 49_999 }))).toEqual({ expected: 100_000, rewritten: 50_001 })
  // Half is no break.
  expect(detect(last(), step({ cacheRead: 50_000 }))).toBeNull()
  // A step with a large new tool result reads the full prefix.
  expect(detect(last(), step({ tokens: 400_000, cacheRead: 100_000 }))).toBeNull()
  // After a compaction the prompt is shorter than the prefix.
  expect(detect(last(), step({ tokens: 38_000, cacheRead: 0 }))).toEqual({
    expected: 38_000,
    rewritten: 38_000,
  })
  // A short prompt can be below the minimum that the API caches.
  expect(detect(last({ tokens: 3999 }), step({ cacheRead: 0 }))).toBeNull()
  expect(detect(last({ tokens: 4000 }), step({ cacheRead: 0 }))).not.toBeNull()
})

test('diffOf names the first difference of two maps and counts the others', () => {
  expect(diffOf({ a: '1' }, { a: '1' })).toBeNull()
  expect(diffOf(undefined, { a: '1' })).toBeNull()
  expect(diffOf({ a: '1' }, undefined)).toBeNull()
  expect(diffOf({ Write: '1', Read: '2' }, { Read: '2' })).toBe('- Write')
  expect(diffOf({ Read: '2' }, { Read: '2', mcp__a__b: '3' })).toBe('+ mcp__a__b')
  expect(diffOf({ Bash: '1' }, { Bash: '9' })).toBe('Bash changed')
  // Removed names first, then added, then changed.
  expect(diffOf({ a: '1', b: '1', c: '1' }, { b: '2', c: '1', d: '1' })).toBe('- a · +2 more')
})

test('causeOf gives each cause', () => {
  const none = { ttlMs: HOUR, compaction: null }
  expect(causeOf(last(), step(), HOUR, { trigger: 'auto', before: 171_000, after: 38_000 })).toEqual({
    cause: 'compact',
    detail: 'auto · 171.0k → 38.0k',
  })
  expect(causeOf(last(), step(), HOUR, { trigger: 'manual' })).toEqual({
    cause: 'compact',
    detail: 'manual',
  })
  expect(causeOf(last(), step({ messageCount: 12 }), none.ttlMs, none.compaction)).toEqual({
    cause: 'history',
    detail: '40 → 12 messages',
  })
  expect(
    causeOf(last(), step({ model: 'claude-sonnet-5-5' }), none.ttlMs, none.compaction),
  ).toEqual({ cause: 'model', detail: 'opus-5-5 → sonnet-5-5' })
  expect(causeOf(last(), step({ at: 1000 + HOUR + 4_324_000 }), HOUR, null)).toEqual({
    cause: 'ttl',
    detail: 'idle 2:12:04',
  })
  const fp = { tools: { Read: '1', Write: '2' }, sections: { memory: '1' }, context: { claudeMd: '1' } }
  const at = (over: object) => step({ fingerprint: { ...fp, ...over } })
  expect(causeOf(last({ fingerprint: fp }), at({ tools: { Read: '1' } }), HOUR, null)).toEqual({
    cause: 'tools',
    detail: '- Write',
  })
  expect(causeOf(last({ fingerprint: fp }), at({ sections: { memory: '9' } }), HOUR, null)).toEqual({
    cause: 'prompt',
    detail: 'memory changed',
  })
  expect(causeOf(last({ fingerprint: fp }), at({ context: { claudeMd: '9' } }), HOUR, null)).toEqual({
    cause: 'context',
    detail: 'claudeMd changed',
  })
  expect(causeOf(last({ fingerprint: fp }), at({}), HOUR, null)).toEqual({
    cause: 'unknown',
    detail: 'no change seen',
  })
})

test('causeOf takes the first cause of the order', () => {
  // A model change at the limit of the lifetime is a model change.
  const late = step({ model: 'claude-sonnet-5-5', at: 1000 + HOUR + 1, messageCount: 3 })
  expect(causeOf(last(), late, HOUR, { trigger: 'auto' }).cause).toBe('compact')
  expect(causeOf(last(), late, HOUR, null).cause).toBe('history')
  expect(causeOf(last(), { ...late, messageCount: 42 }, HOUR, null).cause).toBe('model')
  // A time equal to the lifetime is not an expired cache.
  expect(causeOf(last(), step({ at: 1000 + HOUR }), HOUR, null).cause).toBe('unknown')
  // An absent part gives no difference.
  const fp = { tools: { Read: '1' } }
  expect(causeOf(last({ fingerprint: fp }), step({ fingerprint: {} }), HOUR, null).cause).toBe(
    'unknown',
  )
})

test('withStep keeps the prompt of the step and adds an entry for a break', () => {
  // The first step of a session, or of a record of an older version: no prefix, no break.
  const first = withStep({}, step({ cacheRead: 0, fingerprint: { sections: { a: '1' } } }), '1h', null)
  expect(first.breaks).toEqual([])
  expect(first.breakCount).toBe(0)
  expect(first.lostUsd).toBe(0)
  expect(first.lastPrompt).toEqual({
    tokens: 101_000,
    model: 'claude-opus-5-5',
    messageCount: 42,
    at: 2000,
    fingerprint: { sections: { a: '1' } },
  })
  // A step with no sections keeps the sections of the step before it.
  const warm = withStep(first, step({ cacheRead: 101_000, tokens: 102_000, at: 3000 }), '1h', null)
  expect(warm.breaks).toEqual([])
  expect(warm.lastPrompt?.fingerprint).toEqual({ sections: { a: '1' } })
  expect(warm.lastPrompt?.cause).toBeUndefined()
  const broken = withStep(
    warm,
    step({ model: 'claude-sonnet-5-5', tokens: 102_500, cacheRead: 500, at: 4000 }),
    '1h',
    null,
  )
  expect(broken.lastPrompt?.cause).toBe('model')
  expect(broken.breakCount).toBe(1)
  expect(broken.breaks.length).toBe(1)
  expect(broken.breaks[0]).toMatchObject({
    at: 4000,
    cause: 'model',
    detail: 'opus-5-5 → sonnet-5-5',
    rewritten: 101_500,
  })
  // 101,500 tokens at Sonnet 5.5: a 1-hour write $4, a read $0.10.
  expect(usd(broken.breaks[0]?.lostUsd)).toBe(0.39585)
  expect(usd(broken.lostUsd)).toBe(0.39585)
  // The next step that reads the cache has no cause.
  const after = withStep(broken, step({ model: 'claude-sonnet-5-5', cacheRead: 102_500, at: 5000 }), '1h', null)
  expect(after.lastPrompt?.cause).toBeUndefined()
  expect(after.breakCount).toBe(1)
})

test('withStep keeps the newest 50 entries and the sum of all', () => {
  let s: ReturnType<typeof withStep> = withStep({}, step({ model: 'm' }), '5m', null)
  for (let i = 0; i < 52; i++)
    s = withStep(s, step({ model: i % 2 === 0 ? 'a' : 'b', at: 3000 + i }), '5m', null)
  expect(s.breaks.length).toBe(50)
  expect(s.breaks[0]?.at).toBe(3002)
  expect(s.breakCount).toBe(52)
  // A model with no price has no lost cost, and adds nothing to the sum.
  expect(s.breaks[0]?.lostUsd).toBeNull()
  expect(s.lostUsd).toBe(0)
})

test('breaksView and breaksHead give what the pane draws', () => {
  expect(breaksView({})).toEqual({ count: 0, lostUsd: 0, entries: [] })
  expect(breaksHead({ count: 0, lostUsd: 0, entries: [] })).toEqual({ text: 'no break', dim: true })
  expect(breaksHead({ count: 1, lostUsd: 0.914, entries: [] })).toEqual({
    text: '1 break · ≈$0.91 lost',
    color: PALETTE.yellow,
  })
  expect(breaksHead({ count: 3, lostUsd: 1.84, entries: [] }).text).toBe('3 breaks · ≈$1.84 lost')
})

test('clockText is the local time of a moment, and causeColor the tone of a cause', () => {
  // 14:02 UTC, in a zone 7 hours east of UTC.
  expect(clockText(Date.UTC(2026, 9, 8, 14, 2, 59), -420)).toBe('21:02')
  expect(clockText(Date.UTC(2026, 9, 8, 23, 30), 60)).toBe('22:30')
  expect(causeColor('ttl')).toBe(PALETTE.yellow)
  expect(causeColor('compact')).toBe(PALETTE.yellow)
  expect(causeColor('model')).toBe(PALETTE.red)
  expect(causeColor('unknown')).toBe(PALETTE.red)
})
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `claude plugin test mods/flight-deck 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)"`
Expected: `(fail) the file did not load` for `breaks.test.ts` and for `price.test.ts`.

- [ ] **Step 5: Write `rewriteCost`**

Add to `mods/flight-deck/src/price.ts`, after `engineGap`:

```ts
// What a cache break costs for `tokens` tokens of one request: their cost as cache writes
// less their cost as cache reads, or null for a model with no price. `prompt` is the tokens
// of the prompt of the request: it selects the long rate of the model.
export const rewriteCost = (model: string, tokens: number, ttl: Ttl, prompt: number): number | null => {
  const base = priceOf(model)
  if (base === undefined) return null
  const p = rateOf(base, prompt)
  return (tokens * (p.input * (ttl === '1h' ? 2 : 1.25) - readOf(p))) / 1e6
}
```

- [ ] **Step 6: Write `breaks.ts`**

Create `mods/flight-deck/src/breaks.ts`:

```ts
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
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `bun run check 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)|error TS"`
Expected: no `(fail)` line, no `error TS` line, `0 fail` two times.

- [ ] **Step 8: Commit**

```bash
git add mods/flight-deck/src/breaks.ts mods/flight-deck/src/breaks.test.ts mods/flight-deck/src/price.ts mods/flight-deck/src/price.test.ts mods/flight-deck/types/index.d.ts
git commit -m "feat(flight-deck): find a cache break of the main loop and its cause"
```

---

### Task 2: The snapshot keeps the break fields

**Files:**
- Modify: `mods/flight-deck/src/snapshot.ts` (`parseSnapshot`)
- Modify: `mods/flight-deck/src/snapshot.test.ts`
- Modify: `mods/flight-deck/hooks/register.tsx` (`save`)

**Interfaces:**
- Consumes: the types `LastPrompt`, `BreakEntry`, `Fingerprint`, `BreakCause` of Task 1.
- Produces: `parseSnapshot` returns `lastPrompt`, `breaks`, `breakCount`, `lostUsd` and `deferred` when the record has them in a valid shape. `save` stores them.

- [ ] **Step 1: Write the failing test**

Add to `mods/flight-deck/src/snapshot.test.ts`:

```ts
test('parseSnapshot keeps the cache break fields, and a record without them has none', () => {
  const old = parseSnapshot({ tools: 3 })
  expect(old.lastPrompt).toBeUndefined()
  expect(old.breaks).toBeUndefined()
  expect(old.deferred).toBeUndefined()

  const entry = { at: 5, cause: 'model', detail: 'a → b', rewritten: 9000, lostUsd: null }
  const last = {
    tokens: 9000,
    model: 'm',
    messageCount: 4,
    at: 5,
    fingerprint: { tools: { Read: 'x' }, sections: { memory: 'y' } },
    cause: 'model',
  }
  const s = parseSnapshot({
    tools: 3,
    lastPrompt: last,
    breaks: [entry, { at: 'bad' }, { ...entry, cause: 'nonsense' }, { ...entry, lostUsd: 0.5 }],
    breakCount: 7,
    lostUsd: 1.25,
    deferred: ['WebFetch', 3],
  })
  expect(s.lastPrompt).toEqual(last)
  // An entry of a bad shape is left out.
  expect(s.breaks).toEqual([entry, { ...entry, lostUsd: 0.5 }])
  expect(s.breakCount).toBe(7)
  expect(s.lostUsd).toBe(1.25)
  expect(s.deferred).toEqual(['WebFetch'])
  // A prompt of a bad shape is no prompt: the next step then finds no break.
  expect(parseSnapshot({ lastPrompt: { tokens: 'x' } }).lastPrompt).toBeUndefined()
  expect(parseSnapshot({ lastPrompt: { ...last, cause: 'nonsense' } }).lastPrompt?.cause).toBeUndefined()
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `claude plugin test mods/flight-deck 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)"`
Expected: `(fail) parseSnapshot keeps the cache break fields, and a record without them has none`.

- [ ] **Step 3: Parse the fields**

In `mods/flight-deck/src/snapshot.ts`, change the first import to:

```ts
import type {
  AgentUsage,
  BreakCause,
  BreakEntry,
  Fingerprint,
  LastPrompt,
  Snapshot,
  Totals,
} from '../types'
```

Add after `parseAgents`:

```ts
const CAUSES: readonly BreakCause[] = [
  'compact',
  'history',
  'model',
  'ttl',
  'tools',
  'prompt',
  'context',
  'unknown',
]
const isCause = (v: unknown): v is BreakCause => CAUSES.includes(v as BreakCause)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const parseHashes = (raw: unknown): Record<string, string> | undefined =>
  isRecord(raw)
    ? Object.fromEntries(
        Object.entries(raw).filter((kv): kv is [string, string] => typeof kv[1] === 'string'),
      )
    : undefined

const parseFingerprint = (raw: unknown): Fingerprint => {
  const f = isRecord(raw) ? raw : {}
  const part = (name: 'sections' | 'context' | 'tools') => {
    const map = parseHashes(f[name])
    return map === undefined ? {} : { [name]: map }
  }
  return { ...part('sections'), ...part('context'), ...part('tools') }
}

const parseLastPrompt = (raw: unknown): LastPrompt | undefined => {
  if (!isRecord(raw)) return undefined
  const { tokens, model, messageCount, at } = raw
  if (!isCount(tokens) || typeof model !== 'string' || !isCount(messageCount) || !isCount(at))
    return undefined
  return {
    tokens,
    model,
    messageCount,
    at,
    fingerprint: parseFingerprint(raw.fingerprint),
    ...(isCause(raw.cause) ? { cause: raw.cause } : {}),
  }
}

const parseBreaks = (raw: unknown): BreakEntry[] =>
  (Array.isArray(raw) ? raw : []).flatMap((b): BreakEntry[] =>
    isRecord(b) &&
    isCount(b.at) &&
    isCause(b.cause) &&
    typeof b.detail === 'string' &&
    isCount(b.rewritten)
      ? [
          {
            at: b.at,
            cause: b.cause,
            detail: b.detail,
            rewritten: b.rewritten,
            lostUsd: isCount(b.lostUsd) ? b.lostUsd : null,
          },
        ]
      : [],
  )
```

In `parseSnapshot`, add before the line `...(typeof r.mainModel === 'string' ? { mainModel: r.mainModel } : {}),`:

```ts
    ...(parseLastPrompt(r.lastPrompt) === undefined
      ? {}
      : { lastPrompt: parseLastPrompt(r.lastPrompt) as LastPrompt }),
    ...(Array.isArray(r.breaks) ? { breaks: parseBreaks(r.breaks) } : {}),
    ...(isCount(r.breakCount) ? { breakCount: r.breakCount } : {}),
    ...(isCount(r.lostUsd) ? { lostUsd: r.lostUsd } : {}),
    ...(Array.isArray(r.deferred)
      ? { deferred: r.deferred.filter((x): x is string => typeof x === 'string') }
      : {}),
```

- [ ] **Step 4: Store the fields**

In `mods/flight-deck/hooks/register.tsx`, in the function `save`, add after the line `mcpCalls: s.mcpCalls,`:

```ts
    ...(s.lastPrompt === undefined ? {} : { lastPrompt: s.lastPrompt }),
    ...(s.breaks === undefined ? {} : { breaks: s.breaks }),
    ...(s.breakCount === undefined ? {} : { breakCount: s.breakCount }),
    ...(s.lostUsd === undefined ? {} : { lostUsd: s.lostUsd }),
    ...(s.deferred === undefined ? {} : { deferred: s.deferred }),
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun run check 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)|error TS"`
Expected: no `(fail)` line, no `error TS` line.

- [ ] **Step 6: Commit**

```bash
git add mods/flight-deck/src/snapshot.ts mods/flight-deck/src/snapshot.test.ts mods/flight-deck/hooks/register.tsx
git commit -m "feat(flight-deck): the session record keeps the cache breaks"
```

---

### Task 3: The band shows the cause of a break

**Files:**
- Modify: `mods/flight-deck/src/layout.ts` (`GROUPS`, `DROP_ORDER`, `Parts`, `bandSegments`)
- Modify: `mods/flight-deck/src/layout.test.ts`

**Interfaces:**
- Consumes: `Snapshot.lastPrompt?.cause` of Task 1.
- Produces: `bandSegments` adds the segment `✗ <cause>` in `PALETTE.red` after the countdown when `snap.lastPrompt?.cause` is present and the band is not an agent view. No new input field: the band reads the snapshot that it has.

- [ ] **Step 1: Write the failing test**

Open `mods/flight-deck/src/layout.test.ts` and find the helper that the tests use to call `bandSegments` with a snapshot (the first test of the file shows it). Add this test with the same helper names. If the file builds its input inline, use this form:

```ts
test('the band shows the cause of a cache break after the countdown, and drops it first', () => {
  const snap = {
    ...emptySnapshot(),
    lastStepAt: 0,
    lastPrompt: {
      tokens: 9000,
      model: 'm',
      messageCount: 1,
      at: 0,
      fingerprint: {},
      cause: 'model' as const,
    },
  }
  const input = { snap, busySince: null, now: 1000, ttl: '1h' as const, columns: 200 }
  const text = (segs: { text: string }[]) => segs.map((s) => s.text).join('')
  const wide = bandSegments(input)
  expect(text(wide)).toContain('◔ 59:59  ✗ model │')
  expect(wide.find((s) => s.text === '✗ model')?.color).toBe(PALETTE.red)
  // No cause, no part.
  const calm = { ...snap, lastPrompt: { ...snap.lastPrompt, cause: undefined } }
  expect(text(bandSegments({ ...input, snap: calm as never }))).not.toContain('✗')
  // The band of an agent view has no part.
  expect(text(bandSegments({ ...input, isAgentView: true }))).not.toContain('✗')
  // One cell too narrow for the whole band: the cause goes, and `bg` stays.
  const full = wide.reduce((n, s) => n + s.text.length + (s.isButton ? 4 : 0), 0)
  const narrow = text(bandSegments({ ...input, columns: full - 1 }))
  expect(narrow).not.toContain('✗')
  expect(narrow).toContain('◇ bg')
})
```

Make sure the file imports `emptySnapshot` from `./snapshot` and `PALETTE` from `./palette`. Add the imports that are absent.

- [ ] **Step 2: Run the test to see it fail**

Run: `claude plugin test mods/flight-deck 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)"`
Expected: `(fail) the band shows the cause of a cache break after the countdown, and drops it first`.

- [ ] **Step 3: Add the part**

In `mods/flight-deck/src/layout.ts`:

Change the `hit cache` group of `GROUPS` to `['hit', 'cache', 'break'],`.

Change `DROP_ORDER` to start with `'break',` before `'bg',`:

```ts
const DROP_ORDER = [
  'break',
  'bg',
  'diff',
  'hit',
  'tools',
  'work',
  'cost',
  'out',
  'in',
  'ctx',
  'agents',
] as const
```

In `bandSegments`, add after the line `const cacheColor = expired ? PALETTE.dim : TONE[tone]`:

```ts
  // The cause of the cache break of the last main step. An agent view has none.
  const cause = isAgentView ? undefined : snap.lastPrompt?.cause
```

In `partsFor`, add after the `diff` entry:

```ts
    break: cause === undefined ? [] : [{ text: `✗ ${cause}`, color: PALETTE.red }],
```

Add after the line `if (context === undefined) dropped.add('ctx')`:

```ts
  if (cause === undefined) dropped.add('break')
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun run check 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)|error TS"`
Expected: no `(fail)` line, no `error TS` line.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck/src/layout.ts mods/flight-deck/src/layout.test.ts
git commit -m "feat(flight-deck): the band shows the cause of a cache break"
```

---

### Task 4: The hooks record the fingerprint and the breaks

**Files:**
- Modify: `mods/flight-deck/hooks/register.tsx`
- Modify: `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: `hashes`, `listedTools`, `withStep`, `type Compaction` of `src/breaks.ts`. `contextTokens` of `src/window.ts` (already imported). The band part of Task 3.
- Produces: after each main step with a usage, the meter has `lastPrompt`, `breaks`, `breakCount`, `lostUsd` and `deferred`. Four new hooks: `prompt.compose`, `prompt.context`, `tool.describe`, `session.compact`.

- [ ] **Step 1: Give the test engine a tool list**

In `mods/flight-deck/hooks/register.test.ts`, add after the `DONE` constant:

```ts
// What `$.tool.list()` answers. A test sets it before a step.
let toolList: { name: string; description: string; mcp: boolean }[] = []
```

In the function `engine`, add as its first statement `toolList = []`, and add after the line `on('agent.list', () => ({ value: [] }))`:

```ts
  on('tool.list', () => ({ value: toolList }) as never)
```

- [ ] **Step 2: Write the failing tests**

Add at the end of `mods/flight-deck/hooks/register.test.ts`:

```ts
// A main step with a prompt of `read + write + 2` tokens.
const stepOf = (read: number, write: number) =>
  async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield* [] as never[]
    const usage = {
      input_tokens: 2,
      output_tokens: 5,
      cache_read_input_tokens: read,
      cache_creation_input_tokens: write,
      model: 'm',
    }
    return { ...stepResult(usage), turnId: e.turnId, index: e.index }
  }

// The steps of a test read their usage from here.
let nextUsage = { read: 0, write: 0 }
const breakEngine = (on: Parameters<typeof mock.store>[0], id: () => string = () => 'S1') => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, id)
  paneEngine(on)
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return yield* stepOf(nextUsage.read, nextUsage.write)($, e)
  } as never)
  return clock
}
const mainStep = async ($: Engine, read: number, write: number, over: object = {}) => {
  nextUsage = { read, write }
  await runStep($, { ...STEP, model: 'claude-opus-5-5', messageCount: 10, ...over } as never)
}

test('a step that reads the prefix is no cache break', async ($, on) => {
  const clock = breakEngine(on)
  await mainStep($, 0, 50_000)
  await mainStep($, 50_002, 100, { index: 1 })
  expect(await settled($, clock)).not.toContain('✗')
})

test('a model change breaks the cache, and the mark goes at the next warm step', async ($, on) => {
  const clock = breakEngine(on)
  await mainStep($, 0, 50_000)
  await mainStep($, 0, 50_100, { model: 'claude-sonnet-5-5' })
  expect(await settled($, clock)).toContain('✗ model')
  await mainStep($, 50_102, 50, { model: 'claude-sonnet-5-5', index: 1 })
  expect(await settled($, clock)).not.toContain('✗')
})

test('a step after the cache lifetime gives the cause ttl', { options: { cacheTtl: '5m' } }, async ($, on) => {
  const clock = breakEngine(on)
  await mainStep($, 0, 50_000)
  await clock.advance(301_000)
  await mainStep($, 0, 50_100)
  expect(await bandText($)).toContain('✗ ttl')
})

test('a step of a subagent and a step with no usage change no cache break', async ($, on) => {
  const clock = breakEngine(on)
  await mainStep($, 0, 50_000)
  await spawn($)
  // A subagent has its own cache: its cold step is not a break of the main loop.
  await mainStep($, 0, 9000, { agentId: 'a1' })
  expect(await settled($, clock)).not.toContain('✗')
  // The main loop still reads its own prefix.
  await mainStep($, 50_002, 100, { index: 1 })
  expect(await settled($, clock)).not.toContain('✗')
})

test('a removed listed tool gives the cause tools, a removed deferred tool does not', async ($, on) => {
  const clock = breakEngine(on)
  on('tool.describe', (_$, e) => ({
    description: e.description,
    ...(e.tool === 'NotebookEdit' ? { isDeferred: true } : {}),
  }))
  const tool = (name: string) => ({ name, description: name, mcp: false })
  for (const name of ['Read', 'Write', 'NotebookEdit'])
    await $.tool.describe({ tool: name, description: name, provider: {} } as never)
  toolList = [tool('Read'), tool('Write'), tool('NotebookEdit')]
  await mainStep($, 0, 50_000)
  // The deferred tool leaves the list: the cold step has no known cause.
  toolList = [tool('Read'), tool('Write')]
  await mainStep($, 0, 50_100, { index: 1 })
  expect(await settled($, clock)).toContain('✗ unknown')
  toolList = [tool('Read')]
  await mainStep($, 0, 50_200, { index: 2 })
  expect(await settled($, clock)).toContain('✗ tools')
})

test('a changed section of the system prompt gives the cause prompt', async ($, on) => {
  const clock = breakEngine(on)
  let memory = 'one'
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'hello', scope: 'shared' },
      { id: 'memory', text: memory, scope: 'session' },
    ],
  }))
  const compose = (traits: string[] = []) =>
    $.prompt.compose({
      model: 'm',
      promptModel: 'm',
      surfaces: [],
      tools: [],
      outputStyle: null,
      traits,
    } as never)
  // The hook changes nothing.
  expect((await compose()).sections.map((s) => s.id)).toEqual(['intro', 'memory'])
  await mainStep($, 0, 50_000)
  memory = 'two'
  await compose()
  // A render that sends nothing is not the prompt of a request.
  memory = 'analysis'
  await compose(['analysis'])
  await mainStep($, 0, 50_100, { turnId: 't2' })
  expect(await settled($, clock)).toContain('✗ prompt')
})

test('a changed context block gives the cause context', async ($, on) => {
  const clock = breakEngine(on)
  let claudeMd = 'one'
  on('prompt.context', () => ({ blocks: [{ name: 'claudeMd', text: claudeMd }] }))
  expect(await $.prompt.context({ blocks: [] } as never)).toEqual({
    blocks: [{ name: 'claudeMd', text: 'one' }],
  })
  await mainStep($, 0, 50_000)
  claudeMd = 'two'
  await $.prompt.context({ blocks: [] } as never)
  await mainStep($, 0, 50_100, { turnId: 't2' })
  expect(await settled($, clock)).toContain('✗ context')
})

test('a compaction of the main loop gives the cause compact', async ($, on) => {
  const clock = breakEngine(on)
  on('session.compact', () => ({ messages: [], tokensBefore: 171_000, tokensAfter: 38_000 }))
  await mainStep($, 0, 171_000)
  // A precompute installs nothing, and a compaction of a subagent is not of the main loop.
  await $.session.compact({ trigger: 'precompute', messages: [] } as never)
  await $.session.compact({ trigger: 'auto', messages: [], agentId: 'a1' } as never)
  await mainStep($, 171_002, 10, { index: 1 })
  expect(await settled($, clock)).not.toContain('✗')
  await $.session.compact({ trigger: 'auto', messages: [] } as never)
  await mainStep($, 0, 38_000, { turnId: 't2', messageCount: 3 })
  expect(await settled($, clock)).toContain('✗ compact')
})

test('a cache break stays with its session', async ($, on) => {
  let id = 'S1'
  const clock = breakEngine(on, () => id)
  await mainStep($, 0, 50_000)
  await mainStep($, 0, 50_100, { model: 'claude-sonnet-5-5' })
  expect(await settled($, clock)).toContain('✗ model')
  id = 'S2'
  await measure($, 0.1)
  expect(await settled($, clock)).not.toContain('✗')
  // The first step of the other session has no prefix: no break.
  await mainStep($, 0, 50_000)
  expect(await settled($, clock)).not.toContain('✗')
  id = 'S1'
  await measure($, 0.1)
  expect(await settled($, clock)).toContain('✗ model')
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `claude plugin test mods/flight-deck 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)"`
Expected: the tests that expect a `✗` mark fail. The two tests that expect no mark pass.

A test can fail with an error that names an event with no answer: `prompt.compose`, `prompt.context`, `tool.describe`, `session.compact` or `tool.list`. The test `$` then needs that answer. Check that the `on(...)` call of the test is before the call that raises the event.

- [ ] **Step 4: Add the module state and the imports**

In `mods/flight-deck/hooks/register.tsx`, add to the imports:

```ts
import { type Compaction, hashes, listedTools, withStep } from '../src/breaks'
```

Add after the line `let missedTurns = 0`:

```ts
// What the mod knows of the next request of the main loop, for the cause of a cache break.
// Kept here, not in state: no drawing reads it, and the session record gets it with a step.
// The sections of the last render of the system prompt that sends a request.
let pendingSections: Record<string, string> | null = null
// The blocks of the first user message, as the engine last computed them.
let contextHashes: Record<string, string> | null = null
// Whether each tool is deferred, by the `tool.describe` results of this process.
const deferral = new Map<string, boolean>()
// The compaction of the main loop that came after its last step.
let compaction: Compaction | null = null
```

- [ ] **Step 5: Record a main step**

In the `turn.step` hook of `mods/flight-deck/hooks/register.tsx`, add before the line `try {` that follows the `runner` block:

```ts
    // The listed tools of this request: a main step compares them with those of the step
    // before it. A list that fails gives no tools part.
    const tools =
      e.agentId === undefined ? await $.tool.list().catch(() => null) : null
```

In the same hook, add after the line `const stepCost = costOf(e.model, stepTotals, isMain ? ttls.main : ttls.agent, true)`:

```ts
      // A main step with a usage: is it a cache break? The compaction is read one time.
      const usage = res.usage
      const squeezed = compaction
      if (isMain && usage !== null) compaction = null
      const sections = e.index === 0 ? pendingSections : null
```

In the updater of that hook (`const nextMeter = await update($, meter, (c) => ({`), add after the line `engineGap: (c.engineGap ?? 0) + engineGap(e.model, stepTotals),`:

```ts
        ...(isMain && usage !== null
          ? (() => {
              const listed = tools === null ? null : listedTools(tools, deferral, c.deferred ?? [])
              return {
                ...withStep(
                  c,
                  {
                    tokens: contextTokens(usage),
                    cacheRead: usage.cache_read_input_tokens ?? 0,
                    model: e.model,
                    messageCount: e.messageCount,
                    at: sentAt,
                    fingerprint: {
                      ...(sections === null ? {} : { sections }),
                      ...(contextHashes === null ? {} : { context: contextHashes }),
                      ...(listed === null ? {} : { tools: listed.tools }),
                    },
                  },
                  ttls.main,
                  squeezed,
                ),
                ...(listed === null ? {} : { deferred: listed.deferred }),
              }
            })()
          : {}),
```

- [ ] **Step 6: Add the four hooks**

In `register`, add after the `turn.step` hook:

```ts
  // The four hooks below change nothing: each returns what the engine gave. A failure of the
  // mod's own record must not fail the event.

  // The system prompt of the next request. A render that measures the prompt sends nothing,
  // and a teammate renders the prompt of its lead.
  on('prompt.compose', async (_$, e, next) => {
    const res = await next(e)
    try {
      if (!e.traits.includes('analysis') && !e.traits.includes('teammate'))
        pendingSections = hashes(res.sections.map((s) => ({ name: s.id, text: s.text })))
    } catch {
      // The next render gives the sections.
    }
    return res
  })

  on('prompt.context', async (_$, e, next) => {
    const res = await next(e)
    try {
      contextHashes = hashes(res.blocks)
    } catch {
      // The next read gives the blocks.
    }
    return res
  })

  on('tool.describe', async (_$, e, next) => {
    const res = await next(e)
    deferral.set(e.tool, (res.isDeferred ?? e.isDeferred) === true)
    return res
  })

  // A precompute installs nothing. A compaction of a subagent is not of the main loop.
  on('session.compact', async (_$, e, next) => {
    const res = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && res.skip === undefined)
      compaction = {
        trigger: e.trigger,
        ...(res.tokensBefore === undefined ? {} : { before: res.tokensBefore }),
        ...(res.tokensAfter === undefined ? {} : { after: res.tokensAfter }),
      }
    return res
  })
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `bun run check 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)|error TS|✘"`
Expected: no `(fail)` line, no `error TS` line. `claude plugin validate` can print a warning that `session.compact` is a gating hook without `.catch`. The hook has no code that can fail before `next`. Accept the warning.

- [ ] **Step 8: Commit**

```bash
git add mods/flight-deck/hooks/register.tsx mods/flight-deck/hooks/register.test.ts
git commit -m "feat(flight-deck): record the cache breaks of the main loop"
```

---

### Task 5: The cache row and the cache screen

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts` (`PaneView`, `PaneAction`, `PaneData`)
- Modify: `mods/flight-deck/src/paneData.ts`, `mods/flight-deck/src/paneData.test.ts`
- Modify: `mods/flight-deck/src/action.ts`, `mods/flight-deck/src/action.test.ts`
- Modify: `mods/flight-deck/src/pane.tsx`
- Modify: `mods/flight-deck/hooks/register.tsx`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: `breaksView`, `breaksHead`, `clockText`, `causeColor` of `src/breaks.ts`. The type `BreaksView` of Task 1. `mainStep` and `breakEngine` of the tests of Task 4.
- Produces: `PaneView.isCache: boolean`. `PaneAction` gets `{ kind: 'cache' }`. `PaneData.breaks: BreaksView | null`. `AgentPane` gets the props `breaks: BreaksView | null` and `onCache: () => void`. Element keys: `cache` (button), `cache:head`, `cache:sum`, `cache:hidden`, `cache:none`, `cache:cause:<i>`, `cache:detail:<i>`, `cache:rewritten:<i>`, `cache:lost:<i>`, `cache:time:<i>`.

- [ ] **Step 1: Change the types**

In `mods/flight-deck/types/index.d.ts`:

In `PaneView`, add after `isContext: boolean`:

```ts
  // The cache screen is in place of the tree.
  isCache: boolean
```

In `PaneAction`, add after `| { kind: 'context' }`:

```ts
  | { kind: 'cache' }
```

In `PaneData`, add after the `context` field:

```ts
  // The cache breaks of the main loop, on the tree screen; null on a transcript screen.
  breaks: BreaksView | null
```

- [ ] **Step 2: Write the failing unit tests**

Add to `mods/flight-deck/src/action.test.ts`:

```ts
test('the cache button has the cache action', () => {
  expect(focusAction('cache', null)).toEqual({ kind: 'cache' })
})
```

Add to `mods/flight-deck/src/paneData.test.ts`. Import `emptySnapshot` from `./snapshot` if the file does not import it:

```ts
test('the tree screen takes the cache breaks, a transcript screen does not', () => {
  const entry = { at: 5, cause: 'model' as const, detail: 'a → b', rewritten: 9000, lostUsd: 0.5 }
  const snap = { ...emptySnapshot(), breaks: [entry], breakCount: 3, lostUsd: 1.5 }
  expect(paneData('S1', {}, null, snap, 0, null).breaks).toEqual({
    count: 3,
    lostUsd: 1.5,
    entries: [entry],
  })
  expect(paneData('S1', {}, 'a1', snap, 0, null).breaks).toBeNull()
})
```

- [ ] **Step 3: Write the failing pane tests**

Add at the end of `mods/flight-deck/hooks/register.test.ts`:

```ts
test('the agents screen shows the cache row, and the cache screen lists the breaks', async ($, on) => {
  breakEngine(on)
  await mainStep($, 0, 50_000)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await cellOf(ui, 'cache:head')).toContain('no break')
    await ui.press({ key: 'cache' })
    expect(await paneText(ui)).toContain('No cache break yet.')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  // 50,002 tokens at Sonnet 5.5 and a 1-hour lifetime: (4 - 0.1) x 50,002 / 1,000,000.
  await mainStep($, 0, 50_100, { model: 'claude-sonnet-5-5' })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await cellOf(ui, 'cache:head')).toContain('1 break · ≈$0.20 lost')
    await ui.press({ key: 'cache' })
    const text = await paneText(ui)
    expect(text).toContain('1 break · ≈$0.20 lost')
    expect(text).toContain('rewritten')
    expect(text).toContain('lost($)')
    expect(await cellOf(ui, 'cache:cause:0')).toContain('model')
    expect(await cellOf(ui, 'cache:detail:0')).toContain('opus-5-5 → sonnet-5-5')
    expect(await cellOf(ui, 'cache:rewritten:0')).toContain('50.0k')
    expect(await cellOf(ui, 'cache:lost:0')).toContain('≈0.20')
    // The agents table and the dashboard are not on this screen.
    expect(text).not.toContain('No agents yet.')
    expect(text).not.toContain('cost(%)')
    await ui.press({ key: 'back' })
    expect(await paneText(ui)).toContain('No agents yet.')
    await ui.unmount()
  }
})

test('the cache screen stays one row wide in a narrow pane', async ($, on) => {
  breakEngine(on)
  await mainStep($, 0, 50_000)
  await mainStep($, 0, 50_100, { model: 'claude-sonnet-5-5' })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, true, 20)
    await ui.press({ key: 'cache' })
    const widths = (await ui.findAll({ type: 'Box' }))
      .map((b) => b.props.width)
      .filter((w): w is number => typeof w === 'number')
    expect(widths.every((w) => w >= 0)).toBe(true)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the cache screen says how many older breaks the list does not show', async ($, on) => {
  breakEngine(on)
  await mainStep($, 0, 50_000)
  // 52 breaks: the model changes at each step.
  for (let i = 0; i < 52; i++)
    await mainStep($, 0, 50_000, { model: i % 2 === 0 ? 'claude-sonnet-5-5' : 'claude-opus-5-5' })
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'cache' })
  const text = await paneText(ui)
  expect(text).toContain('52 breaks')
  expect(text).toContain('2 earlier breaks not shown')
  await ui.unmount()
})
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `bun run check 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)|error TS" | head -20`
Expected: `error TS` lines for the new fields (`isCache`, `breaks`), and the new tests fail.

- [ ] **Step 5: Give the pane its data and its action**

In `mods/flight-deck/src/paneData.ts`, add the import `import { breaksView } from './breaks'`. Change the two `return` values:

```ts
  if (viewed === null)
    return {
      sessionId,
      entries,
      stats: null,
      dashboard: dashboard(snap, entries, now),
      context,
      breaks: breaksView(snap),
    }
  const agent = entries[viewed]
  return {
    sessionId,
    entries: agent === undefined ? {} : { [viewed]: agent },
    stats: agentView(snap, viewed),
    dashboard: null,
    context: null,
    breaks: null,
  }
```

In `mods/flight-deck/src/action.ts`, change the first `if` of `focusAction` to:

```ts
  if (
    element === 'back' ||
    element === 'wrap' ||
    element === 'context' ||
    element === 'recount' ||
    element === 'cache'
  )
    return { kind: element }
```

- [ ] **Step 6: Draw the row and the screen**

In `mods/flight-deck/src/pane.tsx`:

Add to the imports: `import { breaksHead, causeColor, clockText } from './breaks'`. Add `BreaksView` to the type import from `'../types'`. Make sure `formatTokens` and `formatUsd` are in the import from `./format`.

Add after the line `const RECOUNT = 'recount'`:

```ts
// The button of the cache screen, and the columns of that screen: a time fits `HH:MM`, the
// rewritten tokens their header, a lost cost its header `lost($)`.
const CACHE = 'cache'
const CLOCK_WIDTH = 5
const REWRITTEN_WIDTH = 9
const LOST_WIDTH = 8
```

In `type Props`, add after the `context` field:

```ts
  // The cache breaks of the main loop; null on a transcript screen.
  breaks: BreaksView | null
```

and after `onContext: () => void`:

```ts
  onCache: () => void
```

In the parameter list of `AgentPane`, add `breaks,` after `context,` and `onCache,` after `onContext,`.

Add after the `contextBlock` function:

```ts
    // The cache breaks of the main loop: the button of the cache screen, then their count
    // and their lost cost. A Button takes no color, so the count is a cell after it.
    const cacheRow = () =>
      breaks === null ? null : (
        <Box
          key="cache:row"
          flexDirection="row"
          alignItems="center"
          gap={1}
          overflow="hidden"
          {...oneRowOnly}
        >
          <Button key="cache" label={CACHE} onPress={onCache} />
          {cell('cache:head', breaksHead(breaks))}
        </Box>
      )
```

Add after the `contextScreen` function:

```ts
    // The cache screen: each cache break of the main loop, with its cause and its cost.
    const cacheScreen = () => {
      const b = breaks ?? { count: 0, lostUsd: 0, entries: [] }
      const causeWidth = Math.max(
        MIN_MODEL,
        columns - (CLOCK_WIDTH + 1) - (REWRITTEN_WIDTH + 1) - (LOST_WIDTH + 1),
      )
      const titleWidth = Math.max(1, columns - (BACK.length + BUTTON_CHROME + 1))
      const detailWidth = Math.max(1, columns - (CLOCK_WIDTH + 1))
      const hidden = b.count - b.entries.length
      return (
        <Box flexDirection="column">
          <Box key="cache:toolbar" flexDirection="row" alignItems="center" gap={1} {...oneRowOnly}>
            <Button key="back" label={BACK} onPress={onBack} />
            {rest('cache:title', CACHE, titleWidth, { bold: true })}
          </Box>
          {b.count === 0 ? (
            <Text key="cache:none" dimColor>
              No cache break yet.
            </Text>
          ) : (
            <Box key="cache:body" flexDirection="column">
              {cell('cache:sum', { ...breaksHead(b), bold: true })}
              {hidden > 0 &&
                cell('cache:hidden', { text: `${hidden} earlier breaks not shown`, dim: true })}
              <Box key="cache:headrow" flexDirection="row" gap={1}>
                {head('cache:head:time', 'time', CLOCK_WIDTH)}
                {rest('cache:head:cause', 'cause', causeWidth, { dim: true })}
                {head('cache:head:rewritten', 'rewritten', REWRITTEN_WIDTH, 'right')}
                {head('cache:head:lost', 'lost($)', LOST_WIDTH, 'right')}
              </Box>
              {b.entries.flatMap((e, i) => [
                <Box key={`cache:row:${i}`} flexDirection="row" gap={1}>
                  {cell(`cache:time:${i}`, { text: clockText(e.at), dim: true, width: CLOCK_WIDTH })}
                  {rest(`cache:cause:${i}`, e.cause, causeWidth, { color: causeColor(e.cause) })}
                  {num(`cache:rewritten:${i}`, formatTokens(e.rewritten), REWRITTEN_WIDTH)}
                  {num(
                    `cache:lost:${i}`,
                    e.lostUsd === null ? '—' : `≈${formatUsd(e.lostUsd)}`,
                    LOST_WIDTH,
                  )}
                </Box>,
                // The detail starts below the cause.
                <Box key={`cache:detailrow:${i}`} flexDirection="row" gap={1}>
                  {cell(`cache:pad:${i}`, { text: '', width: CLOCK_WIDTH })}
                  {rest(`cache:detail:${i}`, e.detail, detailWidth, { dim: true })}
                </Box>,
              ])}
              {rule('cache:rule')}
            </Box>
          )}
        </Box>
      )
    }
```

Add after the line `if (view.isContext === true) return contextScreen()`:

```ts
    if (view.isCache === true) return cacheScreen()
```

In the two places that draw `{contextBlock()}` (the empty tree and the tree with agents), add `{cacheRow()}` on the next line.

- [ ] **Step 7: Wire the action**

In `mods/flight-deck/hooks/register.tsx`:

In `initialPane`, add `isCache: false,` after `isContext: false,`.

In `initialData`, add `breaks: null,` after `context: null,`.

Add after the function `closeContext`:

```ts
// The cache screen, with the focus on its back button.
async function openCache($: Api): Promise<void> {
  await focusAfter($, 'back', async () => {
    await update($, pane, (c) => ({ ...c, isCache: true }))
  })
}

// Back to the tree, with the focus on the button that opened the cache screen.
async function closeCache($: Api): Promise<void> {
  await focusAfter($, 'cache', async () => {
    await update($, pane, (c) => ({ ...c, isCache: false }))
  })
}
```

In `act`, change the `back` branch and add the `cache` branch after `if (action.kind === 'context') return openContext($)`:

```ts
  if (action.kind === 'back') {
    // State of an older shape (a hot reload) has no flag.
    const cur = await read($, pane)
    return cur.isContext === true ? closeContext($) : cur.isCache === true ? closeCache($) : backToTree($)
  }
  if (action.kind === 'context') return openContext($)
  if (action.kind === 'cache') return openCache($)
```

In the `ui.render` hook of the pane, add to the `AgentPane` element after the `context` prop:

```tsx
        // State of an older shape (a hot reload) has no breaks.
        breaks={isCurrent ? (data.breaks ?? null) : null}
```

and after `onContext={() => act($, { kind: 'context' })}`:

```tsx
        onCache={() => act($, { kind: 'cache' })}
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `bun run check 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)|error TS"`
Expected: no `(fail)` line, no `error TS` line.

If a test of an earlier task compares a whole `PaneData` or `PaneView` value with `toEqual`, add `breaks` or `isCache` to its expected value.

- [ ] **Step 9: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): a cache screen lists the cache breaks of the main loop"
```

---

### Task 6: Docs and version 0.7.0

**Files:**
- Modify: `docs/design-system.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`, `docs/i18n/README.vi.md`
- Modify: `mods/flight-deck/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: the drawn text of Tasks 3 and 5.
- Produces: the docs and the version of the release.

- [ ] **Step 1: Update the design system**

In `docs/design-system.md`:

In the glyph table of section 4, change the row of `✓` / `✗` to:

```markdown
| `✓` / `✗` | Tool call done / failed. `✗ <cause>` is also the cache break part of the band. | `TOOL_MARK` in `pane.tsx`, `bandSegments` in `layout.ts` |
```

In section 6 (Band layout), change the groups line and the drop order line to:

```markdown
- The groups, in order: `ctx`, then `in out`, then `hit cache break`, then `tools bg work`, then `cost diff`.
```

```markdown
- A band that is too narrow drops parts in this order (first dropped first): `break`, `bg`, `diff`, `hit`, `tools`, `work`, `cost`, `out`, `in`, `ctx`, `agents`.
```

Add to section 6:

```markdown
- `break` is `✗ <cause>` in `red`. It is present when the last main step was a cache break. The band of an agent view does not have it.
```

Add a section after section 2.7:

```markdown
### 2.8 Cache break cause

Source: `causeColor` in `breaks.ts`.

| Cause | Color |
|---|---|
| `ttl`, `compact` | `yellow` |
| `history`, `model`, `tools`, `prompt`, `context`, `unknown` | `red` |

The cell after the `cache` button is dim with no break, and `yellow` with a break (`breaksHead` in `breaks.ts`).
```

Add to section 7 (Tables):

```markdown
- The cache screen table has the columns `time cause rewritten lost($)`. Widths: `CLOCK_WIDTH` 5, `REWRITTEN_WIDTH` 9, `LOST_WIDTH` 8. `cause` takes the rest of the width. The detail of an entry is a second row, dim, that starts below the cause.
```

- [ ] **Step 2: Update the changelog and the version**

In `mods/flight-deck/.claude-plugin/plugin.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`.

In `CHANGELOG.md`, change the heading `### [Unreleased]` of the `flight-deck` part to these lines, and keep the entries that are below it:

```markdown
### [0.7.0] - 2026-10-08

Tested on Claude Code 2.1.293.

#### Added

- The band shows `✗` and a cause when a step of the main loop does not read the prompt cache.
- A cache screen lists each cache break of the session: the time, the cause, the tokens that the API wrote again and the estimated cost.
```

Add a new empty `### [Unreleased]` heading above the `### [0.7.0]` heading.

- [ ] **Step 3: Update the README**

In `README.md`, add this section after the `## Context screen` section:

```markdown
## Cache screen

A cache break is a step of the main loop that reads much less from the prompt cache than the step before it wrote or read. The API then writes the prompt again, at the cache write price.

- The band shows `✗` and the cause after a break.
- Press `cache` on the agents screen to see each break of the session.
- The causes: `compact` (a compaction), `history` (messages were removed), `model` (another model), `ttl` (the cache expired), `tools` (the tool list changed), `prompt` (the system prompt changed), `context` (an instruction file or the date changed), `unknown`.
- `rewritten` is the tokens that the API wrote again. `lost($)` is an estimate: their cost as cache writes less their cost as cache reads.
- The mod finds the breaks of the main loop only. A subagent has its own cache.
```

Make the same change in `docs/i18n/README.vi.md`, in Vietnamese. Commit `README.md` first (Step 5), then set the line of `docs/i18n/README.vi.md` that names the commit of `README.md` to the hash of that commit, and commit the translation.

- [ ] **Step 4: Run the full check**

Run: `bun run check 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)|error TS|Checked"`
Expected: no `(fail)` line, no `error TS` line, `0 fail` two times.

Run: `python3 ~/.claude/skills/asd-ste100/scripts/ste-lint.py docs/design-system.md README.md 2>&1 | tail -3`
Expected: no new hard violation in the lines that this task added.

- [ ] **Step 5: Commit**

```bash
git add docs/design-system.md CHANGELOG.md README.md mods/flight-deck/.claude-plugin/plugin.json
git commit -m "docs(flight-deck): cache break in the design system, the changelog and the README (0.7.0)"
git add docs/i18n/README.vi.md
git commit -m "docs(i18n): the Vietnamese README follows $(git rev-parse --short HEAD)"
```

- [ ] **Step 6: Check the mod live**

This step needs a person. Load the mod with `claude --plugin-dir mods/flight-deck` and do these checks on a terminal:

1. Send two prompts. The band shows no `✗`.
2. Change the model with `/model`, then send a prompt. The band shows `✗ model`. Type `/agent-log` and press `cache`: the screen lists one break with a time, `model`, the rewritten tokens and a cost.
3. Send one more prompt. The `✗ model` part leaves the band.
4. Press `← agents`. The row shows `1 break` and the lost cost.

Write the result of each check in the pull request.
