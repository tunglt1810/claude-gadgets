# flight-deck Context Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pane shows what fills the context window of the main loop: a context block on the agents screen, and a context screen with the overhead by category, its carry cost and the unused MCP servers.

**Architecture:** The hooks read `$.session.usage({ breakdown })` at the end of a main turn (`summary`) and when the context screen opens (`full`). They keep a context sample in a new atom. Pure functions in `src/context.ts` calculate the view and the cells from the sample and the snapshot. `src/pane.tsx` draws the block and the screen with its `cell`, `rest` and `restBox` helpers.

**Tech Stack:** TypeScript, Bun 1.4.2, Claude Code 2.1.292 plugin API, `claude-code/testing`, Biome.

**Spec:** `docs/specs/2026-10-07-flight-deck-context-breakdown-design.md`

## Global Constraints

- All paths below are relative to the repository root. The mod is in `mods/flight-deck/`.
- Run each command from the repository root.
- Do the work on the branch `feat/flight-deck-0.6.0`.
- `bun run check` must pass before a task is complete.
- TDD: write the test, see it fail, then write the code.
- Docs, code comments, identifiers, commit messages and drawn strings are English.
- `mods/flight-deck/types/index.d.ts` has no imports. `src/` imports types from `../types`.
- A function that receives `$` is a module-level `function` declaration in `hooks/register.tsx`.
- `ui.render` does not write state and does not call `$.session.usage`.
- No emoji in drawn text. Each drawn character has a width of one cell.
- A drawn row is one row. Remove parts. Do not wrap.
- On a desktop, each cell in a row with a Button is a `Client` cell. Use the `cell()` helper of `src/pane.tsx`.
- No box of the terminal tree takes its width from `columns`.
- The styling rules are in `docs/design-system.md`. Read it before a change to drawn text.
- The window is `context.window`. Tones: less than 50 `ok` (green), 50 to 79 `warn` (yellow), 80 or more `danger` (red).
- An estimate has the `≈` prefix. An unknown value is `—`.
- Version: 0.6.0.

## Review Focus

1. A usage reply with no breakdown (no session bound, or an older engine). The pane must show no context block and must not fail. Tests: Task 3 (`sampleOf`), Task 4.
2. A snapshot that version 0.5.1 stored, and a live meter from a hot reload: no `steps`, no `mcpCalls`. The numbers must be finite and the list must be an array. Test: Task 2.
3. A `summary` breakdown with no `mcpTools`, `memoryFiles`, `skills` or `agents` list. The categories must have no items and the dead weight must be 0. Test: Task 3.
4. A compaction between two samples. The growth must not be negative and `turnsLeft` must not use the old base. Test: Task 3.
5. A narrow pane, and a pane state from a hot reload (no `isContext`, no `openCategories`). The rows must stay one row, no width must be negative, and a press must not fail. Tests: Task 3 (`contextHead`, `barCells`), Task 5.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `mods/flight-deck/types/index.d.ts` | Modify | `Snapshot.steps`, `Snapshot.mcpCalls`, the context types, `PaneView`, `PaneAction`, `PaneData`, the `context` atom. |
| `mods/flight-deck/src/snapshot.ts` | Modify | Parse and check the two new snapshot fields. |
| `mods/flight-deck/src/price.ts` | Modify | `readPrice`: the cache read price of a model. |
| `mods/flight-deck/src/context.ts` | Create | The context sample, the growth, the view, the bar and the row cells. |
| `mods/flight-deck/src/context.test.ts` | Create | Tests of `src/context.ts`. |
| `mods/flight-deck/src/paneData.ts` | Modify | `PaneData.context`. |
| `mods/flight-deck/src/action.ts` | Modify | The keys `context`, `recount` and `cat:<name>`. |
| `mods/flight-deck/src/pane.tsx` | Modify | The context block and the context screen. |
| `mods/flight-deck/hooks/register.tsx` | Modify | The `context` atom, the breakdown reads, the counters and the actions. |
| `mods/flight-deck/hooks/register.test.ts` | Modify | Tests of the block, the screen and the actions on both surfaces. |
| `docs/design-system.md` | Modify | The rules of the bar. |
| `README.md`, `docs/i18n/README.vi.md`, `CHANGELOG.md`, `mods/flight-deck/.claude-plugin/plugin.json` | Modify | Version 0.6.0. |

---

### Task 1: Spike the breakdown in a live session

This task needs a person at a live terminal session. It changes no committed code.

**Files:**
- Modify (temporary): `mods/flight-deck/hooks/register.tsx`
- Modify: `docs/specs/2026-10-07-flight-deck-context-breakdown-design.md` (section 9)

**Interfaces:**
- Consumes: `$.session.usage({ breakdown })`, `$.store.set`.
- Produces: the confirmed category names for the `MESSAGES` constant and the item map of Task 3.

- [ ] **Step 1: Add a temporary command**

In `register`, in the `session.start` hook, after the `agent-log` registration:

```ts
    await $.command.register({
      name: 'ctx-dump',
      description: 'Temporary: write the context breakdown to the store',
    })
```

After the `command.run` hook of `agent-log`:

```ts
  on('command.run', { command: 'ctx-dump' }, async ($) => {
    const t0 = await $.clock.now()
    const summary = (await $.session.usage({ breakdown: 'summary' })).context
    const t1 = await $.clock.now()
    const full = (await $.session.usage({ breakdown: 'full' })).context
    const t2 = await $.clock.now()
    await $.store.set('ctxdump', { summaryMs: t1 - t0, fullMs: t2 - t1, summary, full })
    return { text: `summary ${t1 - t0} ms, full ${t2 - t1} ms` }
  })
```

- [ ] **Step 2: Run it**

1. Start a session: `claude --plugin-dir mods/flight-deck`. Use a session that has a minimum of one MCP server with loaded tools.
2. Send one prompt, so that the session has a response.
3. Run `/ctx-dump`.
4. Open the store file `plugins/store/flight-deck_inline-*.json` in the Claude config directory (`$CLAUDE_CONFIG_DIR`, or `~/.claude`). Read the key `ctxdump`.

- [ ] **Step 3: Record the results**

Add a section `### 9.1 Results` to the spec. Write one line for each question of section 9:

1. The `name` and the `kind` of each row of `full.breakdown.categories`.
2. Whether `summary.breakdown` has the `mcpTools`, `memoryFiles`, `skills` and `agents` lists, and whether their `tokens` are more than 0.
3. `summary.breakdown.totalTokens` and `full.breakdown.totalTokens`.
4. `summaryMs` and `fullMs`.

If a category name is different from section 4.2 of the spec, change the name in section 4.2. Task 3 uses the names of the spec.

If `summary.breakdown` has no lists, add this line to section 9.1: `The pane open reads a full breakdown when the session has no full sample.` Task 4, Step 6 has the code for that case.

- [ ] **Step 4: Remove the temporary command**

Run: `git checkout mods/flight-deck/hooks/register.tsx`
Then run: `git status --short mods/`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/2026-10-07-flight-deck-context-breakdown-design.md
git commit -m "docs(flight-deck): record the context breakdown spike"
```

---

### Task 2: Snapshot counters and the cache read price

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts` (type `Snapshot`)
- Modify: `mods/flight-deck/src/snapshot.ts`
- Modify: `mods/flight-deck/src/price.ts`
- Modify: `mods/flight-deck/hooks/register.tsx` (function `save`)
- Test: `mods/flight-deck/src/snapshot.test.ts`, `mods/flight-deck/src/price.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Snapshot.steps: number`, `Snapshot.mcpCalls: string[]`, `readPrice(model: string): number | null`.

- [ ] **Step 1: Write the failing tests**

Add to `mods/flight-deck/src/snapshot.test.ts` (add `emptySnapshot` and `isComplete` to its import of `./snapshot` if they are absent):

```ts
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
```

Add to `mods/flight-deck/src/price.test.ts` (add `readPrice` to its import of `./price`):

```ts
test('readPrice gives the cache read price of a model, or null with no price', () => {
  expect(readPrice('claude-opus-5-5')).toBe(0.2)
  // No listed read price: a tenth of the input price.
  expect(readPrice('claude-sonnet-4-6')).toBeCloseTo(0.3)
  expect(readPrice('claude-haiku-4-5-20251001')).toBe(0.1)
  expect(readPrice('m')).toBeNull()
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun run test`
Expected: FAIL. The new snapshot tests fail on `steps`, and the price test fails because `readPrice` is not exported.

- [ ] **Step 3: Add the fields to the type**

In `mods/flight-deck/types/index.d.ts`, in `Snapshot`, before `mainModel?: string`:

```ts
  // The steps of the main loop that had a usage: each one read the overhead from the cache.
  steps: number
  // The wire names of the MCP tools that a loop called, each name one time.
  mcpCalls: string[]
```

- [ ] **Step 4: Parse and check the fields**

In `mods/flight-deck/src/snapshot.ts`:

In `emptySnapshot`, after the `advisor` line:

```ts
  steps: 0,
  mcpCalls: [],
```

In `parseSnapshot`, after the `advisor: parseAdvisor(r.advisor),` line:

```ts
    steps: num(r.steps),
    mcpCalls: Array.isArray(r.mcpCalls)
      ? r.mcpCalls.filter((x): x is string => typeof x === 'string')
      : [],
```

Replace `isComplete` with:

```ts
export const isComplete = (s: Partial<Snapshot>): boolean =>
  [s.tools, s.workMs, s.costUsd, s.added, s.removed, s.agents, s.bg, s.steps].every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  ) &&
  isRecord(s.byAgent) &&
  isRecord(s.byModel) &&
  isRecord(s.costByModel) &&
  Array.isArray(s.mcpCalls) &&
  [s.advisor?.calls, s.advisor?.ms, s.advisor?.usd, s.advisor?.base].every(Number.isFinite)
```

- [ ] **Step 5: Store the fields**

In `mods/flight-deck/hooks/register.tsx`, in `save`, after the `advisor: s.advisor,` line:

```ts
    steps: s.steps,
    mcpCalls: s.mcpCalls,
```

- [ ] **Step 6: Add `readPrice`**

In `mods/flight-deck/src/price.ts`, replace `costOf` with:

```ts
// The price row of a model, or undefined for a model with no price. The longest matching id
// wins: `claude-opus-5-5` is not priced as `claude-opus-5`.
const priceOf = (model: string) => {
  const id = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0]
  return id === undefined ? undefined : PRICES[id]
}

// The cache read price of a model in US dollars per million tokens, or null with no price.
export const readPrice = (model: string): number | null => {
  const p = priceOf(model)
  return p === undefined ? null : (p.read ?? p.input * 0.1)
}

// The estimated cost of a model's tokens, or null for a model with no price.
export const costOf = (model: string, t: Totals, ttl: Ttl = '5m'): number | null => {
  const p = priceOf(model)
  if (p === undefined) return null
  const read = p.read ?? p.input * 0.1
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * read +
      t.cacheWrite * p.input * (ttl === '1h' ? 2 : 1.25)) /
    1e6
  )
}
```

- [ ] **Step 7: Run the check**

Run: `bun run check`
Expected: PASS. If a test of `hooks/register.test.ts` compares a whole stored snapshot, add `steps: 0` and `mcpCalls: []` to its expected value.

- [ ] **Step 8: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): count main steps and MCP calls, add the cache read price"
```

---

### Task 3: Context calculations

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts`
- Create: `mods/flight-deck/src/context.ts`
- Test: `mods/flight-deck/src/context.test.ts`

**Interfaces:**
- Consumes: `readPrice` (Task 2), `Snapshot.steps`, `Snapshot.mcpCalls` (Task 2), `contextColor` (`src/window.ts`), `cellText` (`src/cell.ts`), `formatTokens`, `formatUsd` (`src/format.ts`).
- Produces:
  - Types `ContextGroup`, `ContextCategoryRow`, `ContextSample`, `ContextState`, `ContextView` in `types/index.d.ts`.
  - `type UsageContext`
  - `sampleOf(c: UsageContext, detail: 'summary' | 'full'): ContextSample | null`
  - `sampled(c: ContextState, id: string, sample: ContextSample, isTurnEnd: boolean): ContextState`
  - `contextView(state: ContextState, snap: Pick<Snapshot, 'steps' | 'mcpCalls' | 'mainModel'>): ContextView | null`
  - `BAR_CELLS`, `barCells(v, width?)`, `barSegments(v): BarSegment[]`
  - `contextHead(v: ContextView, room: number): Cell[]`, `contextSummary(v): Cell[]`, `overheadHead(v): Cell[]`

- [ ] **Step 1: Add the types**

In `mods/flight-deck/types/index.d.ts`, before `declare module 'claude-code'`:

```ts
// One item below a category of the context: an MCP server (`count` is its loaded tools), a
// memory file, a skill or a custom agent.
export type ContextGroup = { name: string; tokens: number; count?: number }

// One category of the overhead, with its items; a category with no list has none.
export type ContextCategoryRow = { name: string; tokens: number; items: ContextGroup[] }

// What the mod keeps of one `$.session.usage({ breakdown })` reply. `threshold` is the count
// at which auto-compaction starts, null when it is off. `servers` holds the loaded tools of
// each MCP server by their wire names.
export type ContextSample = {
  detail: 'summary' | 'full'
  tokens: number
  window: number
  threshold: number | null
  categories: ContextCategoryRow[]
  servers: { name: string; tokens: number; tools: string[] }[]
}

// The context of one session: its latest sample, the tokens of the first sample after the
// start or a compaction (`base`), and the main turns that ended since then.
export type ContextState = {
  sessionId: string | null
  sample: ContextSample | null
  base: number | null
  turns: number
}

// What the pane draws of a context. `overhead` is the categories, `messages` the rest of the
// tokens, `buffer` the room that auto-compaction keeps. `carryUsd` is the estimated cost of
// reading tokens from the cache at each of `steps` steps; null for a model with no price.
export type ContextView = {
  detail: 'summary' | 'full'
  tokens: number
  window: number
  overhead: number
  messages: number
  buffer: number
  perTurn: number | null
  turnsLeft: number | null
  steps: number
  carryUsd: number | null
  categories: (ContextCategoryRow & { carryUsd: number | null })[]
  unused: ContextGroup[]
  deadWeight: number
}
```

- [ ] **Step 2: Write the failing tests**

Create `mods/flight-deck/src/context.test.ts`:

```ts
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
const view = (
  over: Partial<ContextState> = {},
  snap: Parameters<typeof contextView>[1] = SNAP,
) => {
  const v = contextView(state(over), snap)
  if (v === null) throw new Error('no view')
  return v
}
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
  expect(first).toEqual({ sessionId: 'S1', sample: { ...SAMPLE, tokens: 70000 }, base: 70000, turns: 0 })
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
  expect(view({ base: 74900, turns: 3, sample: { ...SAMPLE, threshold: null } }).turnsLeft).toBeNull()
  expect(view({ sample: { ...SAMPLE, threshold: null } }).buffer).toBe(0)
})

test('contextView estimates the carry cost from the steps and the cache read price', () => {
  const v = view()
  expect(v.steps).toBe(38)
  // 31400 tokens at 38 steps at $0.20 per million tokens.
  expect(v.carryUsd).toBeCloseTo(0.23864)
  expect(v.categories[0]?.carryUsd).toBeCloseTo((14200 * 38 * 0.2) / 1e6)
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
    `${'█'.repeat(6)}${'▓'.repeat(11)}${'░'.repeat(16)}${'▒'.repeat(7)}`,
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `bun run test`
Expected: FAIL. `src/context.test.ts` cannot import `./context`.

- [ ] **Step 4: Write the implementation**

Create `mods/flight-deck/src/context.ts`:

```ts
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
import { readPrice } from './price'
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
    window: c.window,
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
// so is a sample with fewer tokens than the last one: a compaction. `isTurnEnd` counts a turn.
export const sampled = (
  c: ContextState,
  id: string,
  sample: ContextSample,
  isTurnEnd: boolean,
): ContextState => {
  const last = c.sessionId === id ? c.sample?.tokens : undefined
  if (c.sessionId !== id || c.base === null || (last !== undefined && sample.tokens < last))
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
  const unused = s.servers
    .filter((v) => !v.tools.some((t) => snap.mcpCalls.includes(t)))
    .map((v) => ({ name: v.name, tokens: v.tokens, count: v.tools.length }))
  return {
    detail: s.detail,
    tokens: s.tokens,
    window: s.window,
    overhead,
    messages: s.tokens - overhead,
    buffer: s.threshold === null ? 0 : Math.max(0, s.window - s.threshold),
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

export type BarSegment = { text: string; color?: string }

// The bar as segments of block characters, which a desktop draws at one width. The used
// parts have the color of the context tone; a part with no color is drawn dim.
export const barSegments = (v: ContextView): BarSegment[] => {
  const c = barCells(v)
  const color = contextColor(v)
  const segs: BarSegment[] = [
    { text: '█'.repeat(c.overhead), color },
    { text: '▓'.repeat(c.messages), color },
    { text: '░'.repeat(c.free) },
    { text: '▒'.repeat(c.buffer) },
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
    ...(v.deadWeight > 0
      ? [{ text: `dead weight ${formatTokens(v.deadWeight)}`, dim: true }]
      : []),
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
```

- [ ] **Step 5: Run the check**

Run: `bun run check`
Expected: PASS. Run `bun run fix` if Biome reports only a format difference, then run the check again.

- [ ] **Step 6: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): calculate the context overhead, growth and dead weight"
```

---

### Task 4: Record the context and draw the context block

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts` (`PaneData`, `PluginState`)
- Modify: `mods/flight-deck/src/paneData.ts`
- Modify: `mods/flight-deck/src/pane.tsx`
- Modify: `mods/flight-deck/hooks/register.tsx`
- Test: `mods/flight-deck/src/paneData.test.ts`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: `sampleOf`, `sampled`, `contextView`, `barSegments`, `contextHead`, `contextSummary`, `UsageContext` (Task 3). `Snapshot.steps`, `Snapshot.mcpCalls` (Task 2).
- Produces:
  - `PaneData.context: ContextView | null`
  - `paneData(sessionId, entries, viewed, snap, now, context: ContextView | null): PaneData`
  - `AgentPane` prop `context: ContextView | null`
  - In `hooks/register.tsx`: `contextAtom`, `recordContext($, id, context, detail, isTurnEnd)`, `measureContext($, detail)`.

- [ ] **Step 1: Write the failing tests**

In `mods/flight-deck/src/paneData.test.ts`, add `null` as the sixth argument of each existing `paneData(...)` call. Then add:

```ts
test('paneData gives the context to the tree screen only', () => {
  const context = { tokens: 1 } as never
  expect(paneData('S1', {}, null, emptySnapshot(), 0, context).context).toBe(context)
  expect(paneData('S1', {}, 'a1', emptySnapshot(), 0, context).context).toBeNull()
})
```

Add `emptySnapshot` to the imports of that file if it is absent: `import { emptySnapshot } from './snapshot'`.

In `mods/flight-deck/hooks/register.test.ts`, after the `mountPane` and `paneText` helpers, add:

```ts
// A usage reply with a breakdown: 31.4k of overhead, 52.8k of messages, two MCP servers.
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
    ],
    totalTokens: 84200,
    mcpTools: [
      { name: 'mcp__figma__get', serverName: 'figma', tokens: 6000, isLoaded: true },
      { name: 'mcp__figma__set', serverName: 'figma', tokens: 3800, isLoaded: true },
      { name: 'mcp__chrome__click', serverName: 'chrome', tokens: 1800, isLoaded: true },
    ],
    memoryFiles: [{ path: '/repo/CLAUDE.md', type: 'Project', tokens: 4000 }],
    agents: [],
    skills: { skillFrontmatter: [{ name: 'docs', tokens: 1900 }] },
    autoCompactThreshold: 167000,
    isAutoCompactEnabled: true,
  },
}

// The engine with a usage that has the breakdown above.
const contextEngine = (on: Parameters<typeof mock.store>[0]) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, undefined, {}, () => ({ context: CONTEXT }))
  paneEngine(on)
}

const turn = async ($: Engine, turnId: string) => {
  await $.turn.start({ text: 'hi', turnId })
  await $.turn.complete({ ...DONE, turnId })
}

test('the agents screen shows the context block after a turn', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const text = await paneText(ui)
    expect(text).toContain('ctx 84.2k/200k 42%')
    expect(text).toContain(`${'█'.repeat(6)}${'▓'.repeat(11)}`)
    expect(text).toContain('overhead 31.4k')
    expect(text).toContain('messages 52.8k')
    expect(text).toContain('dead weight 11.6k')
    await ui.unmount()
  }
})

test('a called MCP server is not dead weight', async ($, on) => {
  contextEngine(on)
  await $.tool.call({ tool: 'mcp__figma__get' } as never)
  await turn($, 't1')
  const ui = await mountPane($, 'terminal')
  const text = await paneText(ui)
  expect(text).toContain('dead weight 1.8k')
  await ui.unmount()
})

test('a usage with no breakdown draws no context block', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).not.toContain('overhead')
    await ui.unmount()
  }
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun run test`
Expected: FAIL. The three new tests of `register.test.ts` fail: the pane text has no `ctx 84.2k/200k 42%`. `bun run typecheck` reports the sixth argument of `paneData`.

- [ ] **Step 3: Add the types**

In `mods/flight-deck/types/index.d.ts`:

In `PaneData`, after `dashboard: Dashboard | null`:

```ts
  // The context of the main loop, on the tree screen; null with no sample.
  context: ContextView | null
```

In `PluginState['flight-deck']`, after `paneData: PaneData`:

```ts
      context: ContextState
```

- [ ] **Step 4: Give the context to the pane data**

Replace the function of `mods/flight-deck/src/paneData.ts` with (keep the comment above it):

```ts
export const paneData = (
  sessionId: string,
  entries: Registry,
  viewed: string | null,
  snap: Snapshot,
  now: number,
  context: ContextView | null,
): PaneData => {
  if (viewed === null)
    return { sessionId, entries, stats: null, dashboard: dashboard(snap, entries, now), context }
  const agent = entries[viewed]
  return {
    sessionId,
    entries: agent === undefined ? {} : { [viewed]: agent },
    stats: agentView(snap, viewed),
    dashboard: null,
    context: null,
  }
}
```

Change its type import to `import type { ContextView, PaneData, Registry, Snapshot } from '../types'`.

- [ ] **Step 5: Record the context in the hooks**

In `mods/flight-deck/hooks/register.tsx`:

Add the import, after the import of `../src/band`:

```ts
import { contextView, sampled, sampleOf, type UsageContext } from '../src/context'
```

Add `ContextState` to the type import of `../types`.

Change `initialData` to:

```ts
const initialData: PaneData = {
  sessionId: null,
  entries: {},
  stats: null,
  dashboard: null,
  context: null,
}
```

After the `shownData` atom:

```ts
// The context of the main loop: the latest breakdown that an event read, and its growth.
const initialContext: ContextState = { sessionId: null, sample: null, base: null, turns: 0 }
const contextAtom = atom({ plugin: 'flight-deck', key: 'context' } as const, initialContext)
```

In `syncPane`, replace the `const next = paneData(...)` statement with:

```ts
  const snap = await currentMeter($)
  const ctx = await read($, contextAtom)
  const next = paneData(
    id,
    reg.sessionId === id ? reg.entries : {},
    view.agentId,
    snap,
    await $.clock.now(),
    ctx.sessionId === id ? contextView(ctx, snap) : null,
  )
```

After `syncPane`, add:

```ts
// Keeps the breakdown of a usage reply as the context sample of the session `id`. A reply
// with no breakdown changes nothing. `isTurnEnd` counts a turn of the growth.
async function recordContext(
  $: Api,
  id: string,
  context: UsageContext,
  detail: 'summary' | 'full',
  isTurnEnd: boolean,
): Promise<void> {
  const sample = sampleOf(context, detail)
  if (sample === null) return
  await update($, contextAtom, (c) => sampled(c, id, sample, isTurnEnd))
}

// Reads a breakdown and draws it. A `full` one sends a token-count request for each tool and
// each memory file: only a press asks for it.
async function measureContext($: Api, detail: 'summary' | 'full'): Promise<void> {
  const id = await $.session.id()
  const usage = await $.session.usage({ breakdown: detail })
  await recordContext($, id, usage.context, detail, false)
  await syncPane($)
}
```

In `togglePane`, replace the line `await syncPane($)` with:

```ts
  // A summary breakdown estimates locally: it sends no request.
  await measureContext($, 'summary')
```

In the `turn.step` hook, in the updater of `nextMeter`, after the `advisor: advised(...)` line:

```ts
        steps: c.steps + (isMain && res.usage !== null ? 1 : 0),
```

In the `tool.call` hook, in the updater of `nextMeter`, after the `bg: ...` line:

```ts
      mcpCalls:
        e.tool.startsWith('mcp__') && !c.mcpCalls.includes(e.tool)
          ? [...c.mcpCalls, e.tool]
          : c.mcpCalls,
```

In the `turn.complete` hook, in the main-loop part, replace the line `const usd = (await $.session.usage()).cost?.usd` with:

```ts
    // The same reply gives the context as it is at the end of the turn.
    const usage = await $.session.usage({ breakdown: 'summary' })
    const usd = usage.cost?.usd
    await recordContext($, id, usage.context, 'summary', true)
```

In the `ui.render` hook of the pane, add this prop to `<AgentPane>`, after the `dashboard` prop:

```tsx
        // State of an older shape (a hot reload) has no context.
        context={isCurrent ? (data.context ?? null) : null}
```

- [ ] **Step 6: Only if the spike found no lists in a summary breakdown**

Skip this step unless section 9.1 of the spec has the line `The pane open reads a full breakdown when the session has no full sample.`

In `togglePane`, replace the `measureContext` line of Step 5 with:

```ts
  // A summary breakdown has no lists: the first open of a session reads a full one.
  const seen = await read($, contextAtom)
  const id = await $.session.id()
  const hasFull = seen.sessionId === id && seen.sample?.detail === 'full'
  await measureContext($, hasFull ? 'summary' : 'full')
```

In the `turn.complete` hook, a `summary` sample then replaces the lists of a `full` sample. Change `recordContext` so that a `summary` sample keeps the lists of the last `full` sample of the same session:

```ts
  await update($, contextAtom, (c) => {
    const last = c.sessionId === id ? c.sample : null
    const kept =
      detail === 'summary' && last !== null && sample.servers.length === 0
        ? { ...sample, servers: last.servers, categories: last.categories }
        : sample
    return sampled(c, id, kept, isTurnEnd)
  })
```

- [ ] **Step 7: Draw the block**

In `mods/flight-deck/src/pane.tsx`:

Add `ContextView` to the type import of `../types`. Add the import:

```ts
import { barSegments, contextHead, contextSummary } from './context'
```

In `Props`, after `dashboard: Dashboard | null`:

```ts
  // The context of the main loop, below the dashboard; null with no sample.
  context: ContextView | null
```

Add `context,` to the destructured props of `AgentPane`, after `dashboard,`.

Inside `if (viewed === null) {`, after the `board` function, add:

```tsx
    // The bar of a context: one text, in a box of one row that cuts it. Its length is a
    // fixed count of cells, so no box here takes a width from `columns`.
    const bar = (key: string, c: ContextView) => (
      <Box key={key} height={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate">
          {barSegments(c).map((s, i) => (
            <Text
              key={String(i)}
              {...(s.color === undefined ? { dimColor: true } : { color: s.color })}
            >
              {s.text}
            </Text>
          ))}
        </Text>
      </Box>
    )
    // A row of cells with one cell between them.
    const cells = (key: string, row: Cell[]) => (
      <Box key={key} flexDirection="row" alignItems="center" gap={1} overflow="hidden">
        {row.map((c, i) => cell(`${key}:${i}`, c))}
      </Box>
    )
    // The context of the main loop: its length, the bar of the window and the totals.
    const contextBlock = () =>
      context === null ? null : (
        <Box key="ctxblock" flexDirection="column">
          {cells('ctx:head', contextHead(context, columns))}
          {bar('ctx:bar', context)}
          {cells('ctx:sum', contextSummary(context))}
          {rule('ctx:rule')}
        </Box>
      )
```

In the two `return` statements of the tree screen that draw `{board()}`, add `{contextBlock()}` on the line after `{board()}`.

- [ ] **Step 8: Run the check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): show the context of the main loop on the agents screen"
```

---

### Task 5: Context screen and its actions

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts` (`PaneView`, `PaneAction`)
- Modify: `mods/flight-deck/src/action.ts`
- Modify: `mods/flight-deck/src/pane.tsx`
- Modify: `mods/flight-deck/hooks/register.tsx`
- Test: `mods/flight-deck/src/action.test.ts`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: `measureContext` (Task 4), `overheadHead`, `contextHead` (Task 3), `toggled` (`src/action.ts`), `shareColor` (`src/dashboard.ts`), `formatTokens`, `formatUsd` (`src/format.ts`).
- Produces:
  - `PaneView.isContext: boolean`, `PaneView.openCategories: string[]`
  - `PaneAction` kinds `{ kind: 'context' }`, `{ kind: 'recount' }`, `{ kind: 'category'; name: string }`
  - `AgentPane` props `onContext: () => void`, `onRecount: () => void`, `onCategory: (name: string) => void`
  - Button keys `context`, `recount`, `cat:<name>`

- [ ] **Step 1: Write the failing tests**

Add to `mods/flight-deck/src/action.test.ts`:

```ts
test('focusAction reads the keys of the context screen', () => {
  expect(focusAction('context', null)).toEqual({ kind: 'context' })
  expect(focusAction('recount', null)).toEqual({ kind: 'recount' })
  expect(focusAction('cat:MCP tools', null)).toEqual({ kind: 'category', name: 'MCP tools' })
  // A header and an item row are buttons that do nothing.
  expect(focusAction('head:cat', null)).toBeNull()
  expect(focusAction('item:MCP tools:0', null)).toBeNull()
  expect(focusAction('cat:', null)).toBeNull()
})
```

Add to `mods/flight-deck/hooks/register.test.ts`, after the tests of Task 4:

```ts
test('the context button opens the context screen and back returns', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).not.toContain('share(%)')
    await ui.press({ key: 'context' })
    const text = await paneText(ui)
    // The press read a full breakdown.
    expect(text).toContain('full')
    expect(text).toContain('ctx 84.2k/200k 42%')
    expect(text).toContain('overhead 31.4k')
    expect(text).toContain('16% of window')
    expect(text).toContain('share(%)')
    expect(text).toContain('▸ MCP tools')
    expect(text).toContain('14.2k')
    expect(text).toContain('45%')
    // The model of the test has no price.
    expect(text).toContain('—')
    expect(text).toContain('dead weight 11.6k')
    expect(text).toContain('figma')
    // The agents table is not on this screen.
    expect(text).not.toContain('No agents yet.')

    await ui.press({ key: 'recount' })
    expect(await paneText(ui)).toContain('share(%)')

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'context' })).toBeDefined()
    expect(await paneText(ui)).not.toContain('share(%)')
    await ui.unmount()
  }
})

test('a category row opens and closes its items', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'context' })
    expect(await paneText(ui)).not.toContain('figma · 2 tools')
    await ui.press({ key: 'cat:MCP tools' })
    const open = await paneText(ui)
    expect(open).toContain('▾ MCP tools')
    expect(open).toContain('figma · 2 tools')
    expect(open).toContain('chrome · 1 tools')
    await ui.press({ key: 'cat:MCP tools' })
    expect(await paneText(ui)).not.toContain('figma · 2 tools')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the context screen stays one row wide in a narrow pane', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, true, 20)
    await ui.press({ key: 'context' })
    await ui.press({ key: 'cat:MCP tools' })
    const widths = (await ui.findAll({ type: 'Box' }))
      .map((b) => b.props.width)
      .filter((w): w is number => typeof w === 'number')
    expect(widths.every((w) => w >= 0)).toBe(true)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun run test`
Expected: FAIL. `focusAction('context', null)` gives `null`, and `ui.press({ key: 'context' })` finds no button.

- [ ] **Step 3: Add the types**

In `mods/flight-deck/types/index.d.ts`:

Replace the comment and the type of `PaneView` with:

```ts
// What the pane shows. `agentId` null is the agent tree; `expanded` holds the tool_use ids
// of the open tool calls; `collapsedAgents` the ids of the agents whose detail row is closed (a row is open at first);
// `isWrapped` draws a transcript's long text on several rows. `isContext` puts the context
// screen in place of the tree; `openCategories` holds the names of its open category rows.
export type PaneView = {
  isOpen: boolean
  isWrapped: boolean
  agentId: string | null
  expanded: string[]
  collapsedAgents: string[]
  transcript: Transcript | null
  isContext: boolean
  openCategories: string[]
}
```

In `PaneAction`, after `| { kind: 'wrap' }`:

```ts
  | { kind: 'context' }
  | { kind: 'recount' }
  | { kind: 'category'; name: string }
```

- [ ] **Step 4: Read the new keys**

In `mods/flight-deck/src/action.ts`, in `focusAction`:

Replace the first line of the body with:

```ts
  if (element === 'back' || element === 'wrap' || element === 'context' || element === 'recount')
    return { kind: element }
```

After the line `if (kind === 'expand') return { kind: 'expand', agentId: id }`, add:

```ts
  // A category row of the context screen.
  if (kind === 'cat') return { kind: 'category', name: id }
```

- [ ] **Step 5: Add the actions to the hooks**

In `mods/flight-deck/hooks/register.tsx`:

Change `initialPane` to:

```ts
const initialPane: PaneView = {
  isOpen: false,
  isWrapped: true,
  agentId: null,
  expanded: [],
  collapsedAgents: [],
  transcript: null,
  isContext: false,
  openCategories: [],
}
```

In `loadAgents`, in the `update($, pane, ...)` call, after `transcript: null,`:

```ts
    isContext: false,
    openCategories: [],
```

After `backToTree`, add:

```ts
// The context screen, with the focus on its back button. The press asks for the full
// breakdown: the summary of the last turn is on the screen until it comes.
async function openContext($: Api): Promise<void> {
  await focusAfter($, 'back', async () => {
    await update($, pane, (c) => ({ ...c, isContext: true }))
  })
  await measureContext($, 'full')
}

// Back to the tree, with the focus on the button that opened the context screen.
async function closeContext($: Api): Promise<void> {
  await focusAfter($, 'context', async () => {
    await update($, pane, (c) => ({ ...c, isContext: false }))
  })
}
```

In `act`, replace the line `if (action.kind === 'back') return backToTree($)` with:

```ts
  if (action.kind === 'back')
    // State of an older shape (a hot reload) has no flag.
    return (await read($, pane)).isContext === true ? closeContext($) : backToTree($)
  if (action.kind === 'context') return openContext($)
  if (action.kind === 'recount') return measureContext($, 'full')
  if (action.kind === 'category') {
    await update($, pane, (c) => ({
      ...c,
      openCategories: toggled(c.openCategories, action.name),
    }))
    return
  }
```

In the `ui.render` hook of the pane, add these props to `<AgentPane>`, after `onTool`:

```tsx
        onContext={() => act($, { kind: 'context' })}
        onRecount={() => act($, { kind: 'recount' })}
        onCategory={(name) => act($, { kind: 'category', name })}
```

- [ ] **Step 6: Draw the button and the screen**

In `mods/flight-deck/src/pane.tsx`:

Change the import of `./context` to:

```ts
import { barSegments, contextHead, contextSummary, overheadHead } from './context'
```

Change the import of `./format` to `import { formatDuration, formatTokens, formatUsd } from './format'`.

In `Props`, after `onTool`:

```ts
  onContext: () => void
  onRecount: () => void
  onCategory: (name: string) => void
```

Add `onContext, onRecount, onCategory,` to the destructured props of `AgentPane`.

After the constant `RULE_LENGTH`, add:

```ts
// The button of the context screen, and the button that reads its breakdown again.
const CONTEXT = 'context'
const RECOUNT = 'recount'
// The columns of the context screen: a count of tokens fits `123.4k`, a share its header
// `share(%)`, a carry cost its header `carry($)`, a count of tools its header.
const TOKENS_WIDTH = 7
const SHARE_WIDTH = 8
const CARRY_WIDTH = 8
const TOOLS_WIDTH = 7
```

Replace the `contextBlock` function of Task 4 with:

```tsx
    // The context of the main loop: its length, the bar of the window and the totals. A
    // Button takes no color, so the context length is a cell after the button.
    const contextBlock = () =>
      context === null ? null : (
        <Box key="ctxblock" flexDirection="column">
          <Box key="ctx:row" flexDirection="row" alignItems="center" gap={1} overflow="hidden">
            <Button key="context" label={CONTEXT} onPress={onContext} />
            {contextHead(context, columns - CONTEXT.length - BUTTON_CHROME - 1).map((c, i) =>
              cell(`ctx:head:${i}`, c),
            )}
          </Box>
          {bar('ctx:bar', context)}
          {cells('ctx:sum', contextSummary(context))}
          {rule('ctx:rule')}
        </Box>
      )

    // The first cell of a row that is not pressed. On a desktop it is a button that does
    // nothing: a desktop draws a button's label after a margin of its own, so only a button
    // starts where the category buttons start.
    const quiet = (key: string, text: string, width: number) =>
      restBox(
        `${key}:box`,
        width,
        text,
        isClient ? (
          <Button key={key} plain dimColor label={text} onPress={() => {}} />
        ) : (
          rest(key, text, width, { dim: true })
        ),
      )
    const num = (key: string, text: string, width: number, tone: Tone = {}) =>
      cell(key, { text, ...tone, width, align: 'right' })

    // The context screen: the overhead by category, what it costs to carry, and the MCP
    // servers that the session did not call.
    const contextScreen = () => {
      const nameWidth = Math.max(
        MIN_MODEL,
        columns - (TOKENS_WIDTH + 1) - (SHARE_WIDTH + 1) - (CARRY_WIDTH + 1),
      )
      const serverWidth = Math.max(MIN_MODEL, columns - (TOOLS_WIDTH + 1) - (TOKENS_WIDTH + 1))
      const titleWidth = Math.max(
        1,
        columns -
          (BACK.length + BUTTON_CHROME + 1) -
          ('summary'.length + 1) -
          (RECOUNT.length + BUTTON_CHROME + 1),
      )
      // State of an older shape (a hot reload) has no list.
      const open = view.openCategories ?? []
      return (
        <Box flexDirection="column">
          <Box key="ctx:toolbar" flexDirection="row" alignItems="center" gap={1}>
            <Button key="back" label={BACK} onPress={onBack} />
            {rest('ctx:title', CONTEXT, titleWidth, { bold: true })}
            {context !== null && cell('ctx:detail', { text: context.detail, dim: true })}
            <Button key="recount" label={RECOUNT} onPress={onRecount} />
          </Box>
          {context === null ? (
            <Text key="ctx:none" dimColor>
              No context yet.
            </Text>
          ) : (
            <Box key="ctx:body" flexDirection="column">
              {cells('ctx:head', contextHead(context, columns))}
              {bar('ctx:bar', context)}
              {rule('ctx:rule')}
              {cells('ovh:head', overheadHead(context))}
              <Box key="ovh:cols" flexDirection="row" alignItems="center" gap={1}>
                {quiet('head:cat', '  category', nameWidth)}
                {head('head:tokens', 'tokens', TOKENS_WIDTH, 'right')}
                {head('head:share', 'share(%)', SHARE_WIDTH, 'right')}
                {head('head:carry', 'carry($)', CARRY_WIDTH, 'right')}
              </Box>
              {context.categories.map((r) => {
                const isOpen = open.includes(r.name)
                // A category with no items has no mark, and its press does nothing.
                const mark = r.items.length === 0 ? ' ' : isOpen ? '▾' : '▸'
                const label = cut(`${mark} ${r.name}`, nameWidth)
                const pct =
                  context.overhead > 0 ? Math.round((r.tokens / context.overhead) * 100) : 0
                return (
                  <Box key={`catrow:${r.name}`} flexDirection="column">
                    <Box flexDirection="row" alignItems="center" gap={1}>
                      {restBox(
                        `catbox:${r.name}`,
                        nameWidth,
                        label,
                        <Button
                          key={`cat:${r.name}`}
                          plain
                          label={label}
                          onPress={r.items.length === 0 ? () => {} : () => onCategory(r.name)}
                        />,
                      )}
                      {num(`catnum:tokens:${r.name}`, formatTokens(r.tokens), TOKENS_WIDTH)}
                      {num(`catnum:share:${r.name}`, `${pct}%`, SHARE_WIDTH, {
                        color: shareColor(pct),
                      })}
                      {num(
                        `catnum:carry:${r.name}`,
                        r.carryUsd === null ? '—' : `≈${formatUsd(r.carryUsd)}`,
                        CARRY_WIDTH,
                      )}
                    </Box>
                    {isOpen &&
                      r.items.map((it, i) => (
                        <Box
                          key={`itemrow:${r.name}:${String(i)}`}
                          flexDirection="row"
                          alignItems="center"
                          gap={1}
                        >
                          {quiet(
                            `item:${r.name}:${String(i)}`,
                            cut(
                              `    ${it.name}${it.count === undefined ? '' : ` · ${it.count} tools`}`,
                              nameWidth,
                            ),
                            nameWidth,
                          )}
                          {num(
                            `itemnum:${r.name}:${String(i)}`,
                            formatTokens(it.tokens),
                            TOKENS_WIDTH,
                            { dim: true },
                          )}
                        </Box>
                      ))}
                  </Box>
                )
              })}
              {context.unused.length > 0 && (
                <Box key="dead" flexDirection="column">
                  {rule('dead:rule')}
                  {cell('dead:head', {
                    text: `dead weight ${formatTokens(context.deadWeight)}`,
                    bold: true,
                  })}
                  <Box key="dead:cols" flexDirection="row" gap={1}>
                    {rest('dead:head:server', 'server', serverWidth, { dim: true })}
                    {head('dead:head:tools', 'tools', TOOLS_WIDTH, 'right')}
                    {head('dead:head:tokens', 'tokens', TOKENS_WIDTH, 'right')}
                  </Box>
                  {context.unused.map((s) => (
                    <Box key={`dead:${s.name}`} flexDirection="row" gap={1}>
                      {rest(`dead:name:${s.name}`, s.name, serverWidth)}
                      {num(`dead:tools:${s.name}`, String(s.count ?? 0), TOOLS_WIDTH, {
                        dim: true,
                      })}
                      {num(`dead:tokens:${s.name}`, formatTokens(s.tokens), TOKENS_WIDTH)}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }
    // State of an older shape (a hot reload) has no flag.
    if (view.isContext === true) return contextScreen()
```

The last line must be before the statement `const rows = treeRows(entries)`.

- [ ] **Step 7: Run the check**

Run: `bun run check`
Expected: PASS. If an existing test counts the buttons of the tree screen, its engine has no breakdown and its count does not change.

- [ ] **Step 8: Examine the pane in a live terminal session**

1. Run `claude --plugin-dir mods/flight-deck`. Send one prompt.
2. Run `/agent-log`. Make sure that the block shows the context length, the bar and the totals on three rows.
3. Press `context`. Make sure that the detail word changes from `summary` to `full`, and that the table columns line up.
4. Press a category with a `▸` mark. Make sure that its items show below it and that the mark is `▾`.
5. Drag the pane to a smaller width. Make sure that no row wraps.
6. Press `← agents`. Make sure that the agents screen shows and that the next press of `context` works with one click.

- [ ] **Step 9: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): add the context screen with the overhead and the dead weight"
```

---

### Task 6: Docs and version 0.6.0

**Files:**
- Modify: `docs/design-system.md`
- Modify: `README.md`
- Modify: `docs/i18n/README.vi.md`
- Modify: `CHANGELOG.md`
- Modify: `mods/flight-deck/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: the drawn strings of Tasks 4 and 5.
- Produces: nothing.

- [ ] **Step 1: Add the bar to the design system**

In `docs/design-system.md`, add this section before the section `Known duplicates in the code`. Give it the next section number and move the numbers of the sections after it.

```markdown
## Bar

Source: `barCells` and `barSegments` in `mods/flight-deck/src/context.ts`, `bar` in `mods/flight-deck/src/pane.tsx`.

The pane has one bar: the context window of the main loop. The band has no bar.

- The bar has 40 cells (`BAR_CELLS`). It takes no width from the pane.
- Each cell is a block element. A desktop draws the block elements at one width.
- `█` is the overhead and `▓` is the messages. Both have the color of the context tone.
- `░` is the free room and `▒` is the compact buffer. Both are dim.
- An overhead of more than 0 tokens has one cell at least.
- The bar is one `Text` with a `Text` for each segment, in a `Box` with `height={1}` and `overflow="hidden"`.
```

In the glyph section of the same file, add one row or one list item, in the form that the section uses: the characters `█ ▓ ░ ▒`, with the use `the parts of the context bar`.

- [ ] **Step 2: Add the context screen to the README**

In `README.md`, after the `Limits:` list of the section `## Agents pane`, add:

```markdown
## Context screen

The pane shows what fills the context window of the main loop.

- Below the dashboard, a block shows the context length (`ctx 84.2k/200k 42%`), a bar and three totals. In the bar, `█` is the overhead, `▓` is the messages, `░` is the free room and `▒` is the room that auto-compaction keeps.
- The overhead is the content that each request carries before the conversation: the system prompt, the tools, the memory files and the skills.
- Press `context` to see the overhead by category. Press a category with a `▸` mark to see its MCP servers, its memory files or its skills.
- `carry($)` is an estimate of what the overhead cost in this session: its tokens, multiplied by the steps of the main loop and by the cache read price.
- `dead weight` lists the MCP servers that have loaded tools and that the session did not call.
- The screen opens with a full count, which sends one token-count request for each tool and each memory file. Press `recount` to count again.

Limits:

- The numbers are for the main loop. The engine gives no breakdown of the context of a subagent.
- A tool that loads on demand is not in the window, and thus not in the overhead.
```

- [ ] **Step 3: Commit the README, then update the translation**

```bash
git add docs/design-system.md README.md
git commit -m "docs(flight-deck): describe the context screen and the bar"
git rev-parse --short HEAD
```

In `docs/i18n/README.vi.md`:

1. Add a Vietnamese translation of the section of Step 2, at the same place.
2. In the note below the title, replace the commit `66934e4` with the short hash that `git rev-parse` printed.

- [ ] **Step 4: Add the changelog entry and the version**

Run: `claude --version`. Use its version in the `Tested on` line.

In `CHANGELOG.md`, below `### [Unreleased]`, add (use the date of the day as `YYYY-MM-DD`):

```markdown
### [0.6.0] - YYYY-MM-DD

Tested on Claude Code 2.1.292.

#### Added

- The agents screen shows the context length of the main loop, a bar of what fills the window, and the tokens of the overhead and of the messages.
- A context screen shows the overhead by category, its estimated cost and the MCP servers that the session did not call.
```

In `mods/flight-deck/.claude-plugin/plugin.json`, change `"version": "0.5.1"` to `"version": "0.6.0"`.

- [ ] **Step 5: Run the check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/i18n/README.vi.md CHANGELOG.md mods/flight-deck/.claude-plugin/plugin.json
git commit -m "chore(flight-deck): release 0.6.0"
```

- [ ] **Step 7: Examine the pane on a live desktop**

A test cannot measure a position. A person must do these steps in the Code tab of Claude Desktop, with `CLAUDE_CODE_PLUGIN_DIRS` set to the absolute path of `mods/flight-deck`.

1. Type `/reload-plugins --force`. Send one prompt. Open the pane.
2. Make sure that the bar is one row and that its length does not change when the context grows.
3. Open the context screen. Make sure that the category names, the header `category` and the item rows start at one position.
4. Make sure that one click on `context`, on a category and on `← agents` does its action.
