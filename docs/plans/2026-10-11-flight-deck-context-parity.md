# flight-deck Context Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The context screen of the flight-deck pane shows the same numbers as the context window of Claude Desktop, and the mod has no note about the cache read price of Sonnet 5.5.

**Architecture:** A context sample keeps each row of the engine's breakdown with its `kind`, and its window is the compaction window (`breakdown.rawMaxTokens`). Pure functions in `src/context.ts` give the rows, their share of the window, the room to compact and the parts of the bar. `src/pane.tsx` draws them. The band does not change.

**Tech Stack:** TypeScript, Bun 1.4.2, the Claude Code plugin API 2.1.296, tests from `claude-code/testing`.

**Spec:** `docs/specs/2026-10-11-flight-deck-context-parity-design.md`. It changes `docs/specs/2026-10-07-flight-deck-context-breakdown-design.md`.

## Global Constraints

- Work on the branch `feat/flight-deck-0.9.0`. Do not push.
- TDD: write the test, run it, see it fail, then write the code.
- `bun run check` must be green at the end of each task.
- Run the tests of the mod with `claude plugin test mods/flight-deck`.
- Docs, comments, identifiers, commit messages and drawn text are English.
- Draw a color from `PALETTE` only. Write no hex value in another file.
- No emoji in drawn text. Each drawn row is one row.
- `ui.render` writes no state.
- The band does not change. The context length of an agent keeps the window of its model.
- No check of `$.session.version()` is necessary: the engine 2.1.295 gives the same breakdown fields.
- A token count uses `formatTokens`: `33000` is `33.0k`.
- A changelog entry is one short sentence for the person who uses the mod.
- Scratch files go in `.tmp/`.

## Review Focus

1. A breakdown with no `rawMaxTokens` (an engine of a different version): the window is `context.window`, and the screen draws.
2. A context sample of version 0.8.1 in state after a hot reload (it has `categories`, no `rows`): the pane draws no context block and does not throw.
3. More tokens than the window: the bar has 40 cells, and no part has a negative count.
4. A breakdown with auto-compaction off: no `to compact` part, no turns, and the row stays one row.
5. A row whose name the bar does not know, or whose name is an object method (`constructor`): it is in the `dim` part and has no items.

Task 2 has the tests of items 1, 2 and 5. Task 3 has the tests of items 3 and 4.

## File Structure

| File | Change |
|---|---|
| `mods/flight-deck/src/price.ts` | Remove `engineRead`, `engineGap`, `priceNote`. |
| `mods/flight-deck/src/dashboard.ts`, `src/usage.ts`, `src/snapshot.ts` | Remove the note and the gap. |
| `mods/flight-deck/types/index.d.ts` | `ContextRow`, `ContextSample.rows`, `ContextView.rows`, `toCompact`. Remove `engineGap`, `note`, `buffer`. |
| `mods/flight-deck/src/context.ts` | `sampleOf`, `contextView`, `isOverhead`, `rowColor`, `barSegments`, `contextHead`. |
| `mods/flight-deck/src/pane.tsx` | The table of the context screen. Remove the note row. |
| `mods/flight-deck/hooks/register.tsx` | Remove the gap. Read `rows` in the category press. |
| `docs/design-system.md`, `README.md`, `docs/i18n/README.vi.md`, `CHANGELOG.md`, `CLAUDE.md`, `plugin.json` | Task 4. |

---

### Task 1: Remove the Sonnet 5.5 price note

**Files:**
- Modify: `mods/flight-deck/src/price.ts`, `src/dashboard.ts`, `src/usage.ts`, `src/snapshot.ts`, `src/pane.tsx:410-417`, `hooks/register.tsx:23,206,990`, `types/index.d.ts:35-37,247-248`
- Test: `src/price.test.ts`, `src/dashboard.test.ts`, `src/usage.test.ts`, `src/snapshot.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Snapshot` has no `engineGap`. `ModelRow` has no `note`. `price.ts` exports no `engineGap` and no `priceNote`.

- [ ] **Step 1: Change the tests**

In `src/price.test.ts`:
- Change the import to `import { costOf, readPrice, rewriteCost } from './price'`.
- Delete the tests `priceNote names a price that the engine counts at another rate` and `engineGap is the cost that the engine counts over the listed price`.
- In the test `a [1m] suffix does not change the price of a model`, delete the line that calls `priceNote`.

In `src/dashboard.test.ts`, replace the two tests `dashboard notes the row of a model…` and `dashboard keeps the cost that the engine counts over the listed price out of the side row` with:

```ts
test('dashboard has no note for a row of Sonnet 5.5', () => {
  const totals = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }
  const snap = { ...emptySnapshot(), byModel: { 'claude-sonnet-5-5': totals } }
  const row = dashboard(snap, {}, 0).rows.find((r) => r.model === 'sonnet-5-5')
  expect(row).toBeDefined()
  expect(Object.hasOwn(row ?? {}, 'note')).toBe(false)
})

test('dashboard ignores the engine gap of a stored snapshot', () => {
  const read = { input: 0, output: 0, cacheRead: 1e7, cacheWrite: 0 }
  // The rows hold $1 at the listed price, and the ledger has $2: the rest is a side request.
  const snap = {
    ...emptySnapshot(),
    costUsd: 2,
    byModel: { 'claude-sonnet-5-5': read },
    engineGap: 1,
  }
  expect(dashboard(snap as never, {}, 0).rows.map((r) => r.model)).toEqual(['sonnet-5-5', SIDE])
})
```

Add `SIDE` to the import from `./dashboard` if the file does not import it.

In `src/usage.test.ts`, replace the test `restOf is the ledger cost that no step holds` with:

```ts
test('restOf is the ledger cost that no step holds', () => {
  expect(restOf({ costUsd: 5, costByModel: { a: 3, b: 1.5 } })).toBe(0.5)
  // A stored snapshot of version 0.8.1 can have an engine gap: it does not count.
  expect(restOf({ costUsd: 5, costByModel: { a: 3, b: 1.5 }, engineGap: 0.25 } as never)).toBe(0.5)
})
```

In `src/snapshot.test.ts`, add:

```ts
test('parseSnapshot drops the engine gap of a 0.8.1 snapshot', () => {
  expect(Object.hasOwn(parseSnapshot({ engineGap: 0.25 }), 'engineGap')).toBe(false)
})
```

In `hooks/register.test.ts`, replace the test `the dashboard warns below the row of a model that the engine prices at another rate` and the comment above it with:

```ts
test('the dashboard has no price note below the row of Sonnet 5.5', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).toContain('sonnet-5-5')
    expect(await ui.find({ key: 'dash:note:sonnet-5-5' })).toBe(undefined)
    expect(await paneText(ui)).not.toContain(', engine $')
    await ui.unmount()
  }
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL. The five new or changed tests fail (`note` is present, the side row is absent, `restOf` gives 0.25, `engineGap` is kept, `dash:note:sonnet-5-5` is found).

- [ ] **Step 3: Remove the code**

`src/price.ts`:
- Delete the comment block that starts with `` // `engineRead` is the cache read price `` and ends with `web_search:0.01}` (it is directly above `type Rate`).
- Change the type of `PRICES` to `Record<string, Rate & { long?: Rate & { above: number } }>`.
- Change the Sonnet 5.5 row to `'claude-sonnet-5-5': { input: 2, output: 10, read: 0.1 },`.
- Delete `engineGap` and `priceNote` with their comments.
- Remove an import that is now unused (`formatUsd`, `Totals`), if `tsc` or Biome reports it.

`src/dashboard.ts`:
- Import `{ costOf }` only from `./price`.
- In `row`, delete `const note = priceNote(model)` and the line `...(note === null ? {} : { note }),`.
- Change `rest` to:

```ts
  const rest = sorted.every((r) => r.costUsd !== null)
    ? snap.costUsd - sorted.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
    : 0
```

`src/usage.ts`, replace `restOf` and its comment:

```ts
// The ledger cost that no step holds.
export const restOf = (s: Pick<Snapshot, 'costUsd' | 'costByModel'>): number =>
  s.costUsd - Object.values(s.costByModel).reduce((sum, c) => sum + c, 0)
```

`src/snapshot.ts`: delete the line `...(typeof r.engineGap === 'number' ? { engineGap: num(r.engineGap) } : {}),`.

`types/index.d.ts`: delete `engineGap?: number` with its two comment lines in `Snapshot`, and `note?: string` with its comment line in `ModelRow`.

`hooks/register.tsx`:
- Line 23: `import { costOf } from '../src/price'`.
- Delete the line `engineGap: s.engineGap ?? 0,`.
- Delete the line `engineGap: (c.engineGap ?? 0) + engineGap(e.model, stepTotals),`. If `stepTotals` is then unused, delete its declaration too.

`src/pane.tsx`: delete the comment `// A warning has the row below its model, in the warning tone.` and the spread `...(r.note === undefined ? [] : [ … ])` below it. Keep the `</Box>,` of the row.

- [ ] **Step 4: Run the check**

Run: `bun run check`
Expected: PASS. If a test builds a `Snapshot` literal with `engineGap`, delete that field.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck
git commit -m "fix(flight-deck): remove the Sonnet 5.5 cache read note

Claude Code 2.1.296 prices a cache read of Sonnet 5.5 at \$0.10 per
million tokens, as the price table of the mod does."
```

---

### Task 2: Rows of the breakdown and the compaction window

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts:266-315`, `src/context.ts:16-174`, `src/pane.tsx` (the constants near line 130, the context screen near lines 541-604), `hooks/register.tsx:742`
- Test: `src/context.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `type ContextKind = 'used' | 'buffer' | 'free' | 'deferred'`
  - `type ContextRow = { name: string; tokens: number; kind: ContextKind; items: ContextGroup[] }`
  - `ContextSample.rows: ContextRow[]` (replaces `categories`). `ContextSample.window` is the compaction window.
  - `ContextView.rows: (ContextRow & { share: number | null; carryUsd: number | null })[]` (replaces `categories`). `ContextView.toCompact: number | null`.
  - `isOverhead(r: Pick<ContextRow, 'name' | 'kind'>): boolean`
  - `rowColor(r: Pick<ContextRow, 'name' | 'kind'>): string | null`
  - `PART_COLORS: Record<string, string>` (module constant of `context.ts`, used by Task 3)

- [ ] **Step 1: Change the unit tests**

In `src/context.test.ts`:

Replace the test `sampleOf keeps the used categories without the messages, the costliest first` with:

```ts
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
```

In the test `sampleOf groups the loaded MCP tools by server and names the items of a category`, change `SAMPLE.categories` to `SAMPLE.rows` and add at its end:

```ts
  // The tools that are not loaded are the items of the deferred row.
  expect(items('MCP tools (deferred)')).toEqual([{ name: 'linear', tokens: 9000, count: 1 }])
  expect(items('Messages')).toEqual([])
```

In the test `sampleOf reads a breakdown with no lists, no tokens and no compaction`, change `s?.categories` to `s?.rows`.

Replace the test `contextView parts the tokens into overhead, messages and buffer` with:

```ts
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
```

In the test `contextView keeps the overhead at or below the tokens`, delete the line `expect(v.messages).toBe(0)`.

In the test `contextView gives the growth of a turn and the turns before a compaction`, delete the last line (`expect(view({ sample: { ...SAMPLE, threshold: null } }).buffer).toBe(0)`).

In the test `contextView estimates the carry cost…`, replace the two lines that read `categories[0]` with:

```ts
  const carryOf = (v: ReturnType<typeof view>, name: string) =>
    v.rows.find((r) => r.name === name)?.carryUsd
  expect(usd(carryOf(v, 'MCP tools') ?? null)).toBe(0.10792)
  // The conversation, the free room and the deferred tools carry no overhead cost.
  expect(carryOf(v, 'Messages')).toBeNull()
  expect(carryOf(v, 'Free space')).toBeNull()
```

and replace `expect(unpriced.categories[0]?.carryUsd).toBeNull()` with `expect(carryOf(unpriced, 'MCP tools')).toBeNull()`.

Delete the test `the buffer is the buffer row of the breakdown, not the window less the threshold`.

In the test `a session with no record of its steps shows no carry cost`, change `v?.categories` to `v?.rows`.

Replace the body of the test `a category with the name of an object method has no items`:

```ts
  expect(odd?.rows).toEqual([{ name: 'constructor', tokens: 10, kind: 'used', items: [] }])
```

Add `isOverhead` and `rowColor` to the import from `./context`.

Leave the tests of `barCells`, `barSegments` and `contextHead`: Task 3 changes them.

- [ ] **Step 2: Change the pane tests**

In `hooks/register.test.ts`, change `contextEngine` to take a context:

```ts
const contextEngine = (on: Parameters<typeof mock.store>[0], context: object = CONTEXT) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, undefined, {}, () => ({ context }))
  paneEngine(on)
}
```

In the test `the context button opens the context screen and back returns`:
- Change each `'share(%)'` to `'window(%)'` (four places).
- Replace `expect(text).toContain('45%')` with:

```ts
    // The share of a row is its share of the window.
    expect(text).toContain('7.1%')
    expect(text).toContain('Messages')
    expect(text).toContain('26.4%')
    expect(text).toContain('Free space')
```

Add after the test `a category row opens and closes its items`:

```ts
test('the context of the main loop uses the compaction window', async ($, on) => {
  // A model window of 1M with a compaction window of 200k.
  contextEngine(on, {
    ...CONTEXT,
    window: 1_000_000,
    breakdown: {
      ...CONTEXT.breakdown,
      rawMaxTokens: 200000,
      categories: [
        ...CONTEXT.breakdown.categories,
        { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
        { name: 'MCP tools (deferred)', tokens: 9000, kind: 'deferred' },
      ],
      mcpTools: [
        ...CONTEXT.breakdown.mcpTools,
        { name: 'mcp__linear__issue', serverName: 'linear', tokens: 9000, isLoaded: false },
      ],
    },
  })
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).toContain('ctx 84.2k/200k 42%')
    await ui.press({ key: 'context' })
    const text = await paneText(ui)
    expect(text).toContain('ctx 84.2k/200k 42%')
    expect(text).not.toContain('/1M')
    expect(text).toContain('Autocompact buffer')
    expect(text).toContain('16.5%')
    expect(text).toContain('▸ MCP tools (deferred)')
    await ui.press({ key: 'cat:MCP tools (deferred)' })
    expect(await paneText(ui)).toContain('linear · 1 tools')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL. `src/context.test.ts` does not load (`isOverhead` is not exported), and the pane tests fail on `window(%)`.

- [ ] **Step 4: Change the types**

In `types/index.d.ts`, replace `ContextCategoryRow`, `ContextSample` and `ContextView` (keep `ContextGroup` and `ContextState`):

```ts
// What a row of the breakdown is: content in the window, the room that auto-compaction
// keeps, the free room, or tools that load on demand and are not in the window.
export type ContextKind = 'used' | 'buffer' | 'free' | 'deferred'

// One row of the breakdown, with its items; a row with no list has none.
export type ContextRow = { name: string; tokens: number; kind: ContextKind; items: ContextGroup[] }

// What the mod keeps of one `$.session.usage({ breakdown })` reply. `window` is the window
// that the engine measures against: the compaction window, which can be smaller than the
// window of the model. `threshold` is the count at which auto-compaction starts, null when it
// is off. `rows` is in the order of the screen. `servers` holds the loaded tools of each MCP
// server by their wire names.
export type ContextSample = {
  detail: 'summary' | 'full'
  tokens: number
  window: number
  threshold: number | null
  // The tokens are a local estimate: the session has no response of the API yet.
  isEstimate: boolean
  rows: ContextRow[]
  servers: { name: string; tokens: number; tools: string[] }[]
}
```

```ts
// What the pane draws of a context. `overhead` is the used rows without the conversation,
// `messages` the conversation. `share` is the part of the window that a row has, as a
// percentage with one decimal; null for a deferred row. `carryUsd` is the estimated cost of
// reading tokens from the cache at each of `steps` steps; null for a model with no price and
// for a row that is no overhead. `toCompact` is the tokens before auto-compaction starts,
// null when it is off.
export type ContextView = {
  detail: 'summary' | 'full'
  tokens: number
  window: number
  overhead: number
  messages: number
  buffer: number
  toCompact: number | null
  perTurn: number | null
  turnsLeft: number | null
  steps: number
  carryUsd: number | null
  rows: (ContextRow & { share: number | null; carryUsd: number | null })[]
  unused: ContextGroup[]
  deadWeight: number
}
```

`ContextView.buffer` stays in this task: the bar of Task 3 removes it. If another file imports `ContextCategoryRow`, change it to `ContextRow`.

- [ ] **Step 5: Change `src/context.ts`**

Change the type import to `ContextGroup, ContextKind, ContextRow, ContextSample, ContextState, ContextView, Snapshot` (keep `Cell`).

Add `rawMaxTokens?: number` to `UsageContext.breakdown`, after `totalTokens`:

```ts
    // The window that the engine measures against: the compaction window.
    rawMaxTokens?: number
```

Add below `MESSAGES`:

```ts
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
```

Replace `sampleOf` and its comment:

```ts
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
        return { name, tokens: own.reduce((n, t) => n + t.tokens, 0), tools: own.map((t) => t.name) }
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
```

In `contextView`, replace the lines from `const s = state.sample` to `const turnsLeft = …` (inclusive) with:

```ts
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
```

In the returned object of `contextView`, replace `messages`, `buffer` and `categories`, and add `toCompact`:

```ts
    messages: conversation?.tokens ?? s.tokens - overhead,
    buffer:
      s.threshold === null
        ? 0
        : s.rows.filter((r) => r.kind === 'buffer').reduce((n, r) => n + r.tokens, 0),
    toCompact,
```

```ts
    rows: s.rows.map((r) => ({
      ...r,
      share: r.kind === 'deferred' ? null : Math.round((r.tokens / s.window) * 1000) / 10,
      carryUsd: isOverhead(r) ? carry(r.tokens) : null,
    })),
```

- [ ] **Step 6: Change the pane and the press**

`hooks/register.tsx`, in the `category` action: change `.context?.categories ?? []` to `.context?.rows ?? []`.

`src/pane.tsx`:
- Change the comment and the value of the share column: `window(%)` has 9 characters.

```ts
// The columns of the context screen: a count of tokens fits `123.4k`, a share its header
// `window(%)`, a carry cost its header `carry($)`, a count of tools its header.
const TOKENS_WIDTH = 7
const SHARE_WIDTH = 9
```

- Import `isOverhead` and `rowColor` from `./context`.
- Change the header cell: `{head('head:share', 'window(%)', SHARE_WIDTH, 'right')}`.
- Change `context.categories.map((r) => {` to `context.rows.map((r) => {`.
- Delete the `const pct = …` statement (two lines) in that callback.
- Replace the share cell and the carry cell of the row:

```tsx
                      {num(
                        `catnum:share:${r.name}`,
                        r.share === null ? '—' : `${r.share.toFixed(1)}%`,
                        SHARE_WIDTH,
                        // A part of the bar that is too dark for text, and a deferred row: dim.
                        ((color) => (color === null ? { dim: true } : { color }))(rowColor(r)),
                      )}
                      {num(
                        `catnum:carry:${r.name}`,
                        // Only the overhead has a carry cost; `—` is a model with no price.
                        !isOverhead(r) ? '' : r.carryUsd === null ? '—' : `≈${formatUsd(r.carryUsd)}`,
                        CARRY_WIDTH,
                      )}
```

- Change the comment above `contextScreen` to: `// The context screen: each row of the window, what the overhead costs to carry, and the MCP servers that the session did not call.` (wrap it at 100 columns).
- If `shareColor` is now unused in `pane.tsx`, remove it from the import. `dashboard.ts` keeps the function.

- [ ] **Step 7: Run the check**

Run: `bun run check`
Expected: PASS. The tests of `barCells`, `barSegments` and `contextHead` did not change and pass: the view keeps `buffer`, and the head row is the old one.

- [ ] **Step 8: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): rows of the breakdown and the compaction window

The context of the main loop uses the window that the engine measures
against, and the context screen shows each row of the breakdown with its
share of that window."
```

---

### Task 3: Bar by category and the head row

**Files:**
- Modify: `mods/flight-deck/src/context.ts` (`barCells`, `barSegments`, `contextHead`, the returned object of `contextView`), `types/index.d.ts` (`ContextView.buffer`)
- Test: `src/context.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: `PART_COLORS`, `ContextView.rows`, `ContextView.toCompact` from Task 2.
- Produces: `barSegments(v: Pick<ContextView, 'rows' | 'window'>): BarSegment[]`. `contextHead(v, room)` with the room to compact. No `barCells`. No `ContextView.buffer`.

- [ ] **Step 1: Change the tests**

In `src/context.test.ts`, remove `barCells` from the import, and replace the tests `barCells shares 40 cells between the parts of the window` and `barSegments draws one character for each cell and tells the parts by color` with:

```ts
const cellsOf = (v: Parameters<typeof barSegments>[0]) =>
  barSegments(v).map((s) => [s.text.length, s.color])

test('barSegments gives each large category its color, then the buffer and the free room', () => {
  const segs = barSegments(view())
  // One glyph for the whole bar: no part is a pixel off from the part beside it.
  expect(segs.every((s) => /^█+$/.test(s.text))).toBe(true)
  expect(cellsOf(view())).toEqual([
    [11, PALETTE.cyan], // Messages 52.8k
    [3, PALETTE.green], // MCP tools 14.2k
    [2, PALETTE.orange], // System tools 8.1k
    [1, PALETTE.yellow], // Skills 1.9k: one cell at least
    [1, PALETTE.dim], // Memory files and System prompt, 7.2k
    [7, '#3f3e3f'], // the compact buffer, 33k: the darker shade of dim
    [15, PALETTE.strip],
  ])
})

test('barSegments has 40 cells for a full window, an empty window and a window of 0', () => {
  const total = (v: Parameters<typeof barSegments>[0]) =>
    barSegments(v).reduce((n, s) => n + s.text.length, 0)
  // More tokens than the window: the parts stop at 40 cells and the free room has none.
  const over = view({ sample: { ...SAMPLE, window: 50000 } })
  expect(total(over)).toBe(40)
  expect(barSegments(over).every((s) => s.color !== PALETTE.strip)).toBe(true)
  expect(cellsOf({ rows: [], window: 200000 })).toEqual([[40, PALETTE.strip]])
  expect(cellsOf({ rows: view().rows, window: 0 })).toEqual([[40, PALETTE.strip]])
})

test('barSegments puts a row of an unknown name in the dim part', () => {
  const rows = [{ name: 'constructor', tokens: 50000, kind: 'used' as const, items: [] }].map(
    (r) => ({ ...r, share: 25, carryUsd: null }),
  )
  expect(cellsOf({ rows, window: 200000 })).toEqual([
    [10, PALETTE.dim],
    [30, PALETTE.strip],
  ])
})
```

Replace the test `contextHead drops parts until the row fits` with:

```ts
test('contextHead drops the turns, the growth and the room to compact until the row fits', () => {
  const v = view({ base: 74900, turns: 3 })
  expect(texts(contextHead(v, 80))).toEqual([
    'ctx 84.2k/200k 42%',
    '·',
    '+3.1k/turn',
    '·',
    '82.8k to compact',
    '·',
    '≈26 turns',
  ])
  expect(texts(contextHead(v, 55))).toEqual([
    'ctx 84.2k/200k 42%',
    '·',
    '+3.1k/turn',
    '·',
    '82.8k to compact',
  ])
  expect(texts(contextHead(v, 40))).toEqual(['ctx 84.2k/200k 42%', '·', '82.8k to compact'])
  expect(texts(contextHead(v, 20))).toEqual(['ctx 84.2k/200k 42%'])
  expect(texts(contextHead(v, 10))).toEqual(['ctx 42%'])
  expect(texts(contextHead(v, -5))).toEqual(['ctx 42%'])
  expect(contextHead(v, 80)[0]?.color).toBe(PALETTE.green)
})

test('contextHead has no room to compact and no turns with auto-compaction off', () => {
  const v = view({ base: 74900, turns: 3, sample: { ...SAMPLE, threshold: null } })
  expect(texts(contextHead(v, 80))).toEqual(['ctx 84.2k/200k 42%', '·', '+3.1k/turn'])
})
```

In `hooks/register.test.ts`, add to the test `the agents screen shows the context block after a turn`, after the line `expect(text).toContain('█'.repeat(40))`:

```ts
    expect(text).toContain('82.8k to compact')
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL. The colors of the bar, the texts of the head row and `82.8k to compact` do not match.

- [ ] **Step 3: Change `src/context.ts`**

Delete `barCells` with its comment. Keep `BAR_CELLS`, `BarSegment` and `darker`.

Replace `barSegments` and its comment:

```ts
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
```

Replace `contextHead` and its comment:

```ts
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
```

In the returned object of `contextView`, delete the `buffer` property (five lines). In `types/index.d.ts`, delete `buffer: number` from `ContextView`.

`pane.tsx` calls `barSegments(c)` with a `ContextView`: it needs no change.

- [ ] **Step 4: Run the check**

Run: `bun run check`
Expected: PASS. If a test in `hooks/register.test.ts` expects `turns to compact`, change the text to `turns`.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): a bar by category and the room to compact

The bar gives each large category its own color, as the context window of
Claude Desktop does, and the head row shows the tokens before a compaction."
```

---

### Task 4: Documents, version and the live examination

**Files:**
- Modify: `docs/design-system.md` (sections 1, 2.1, 3, 7, 10), `README.md:53-67`, `docs/i18n/README.vi.md` (the same section and the commit that it follows), `CHANGELOG.md`, `CLAUDE.md:7`, `mods/flight-deck/.claude-plugin/plugin.json`, `docs/specs/2026-10-07-flight-deck-context-breakdown-design.md` (the status line)

**Interfaces:**
- Consumes: the drawn text of Tasks 2 and 3.
- Produces: version 0.9.0.

- [ ] **Step 1: `docs/design-system.md`**

Section 2.1, replace the paragraph that starts with `The percentage is` with:

```markdown
The percentage is `tokens / window`, rounded, kept between 0 and 100.

- For an agent, the window is the window of the model of the step (`contextWindow`): 1M for a model with a `[1m]` suffix or a native 1M id, 200k for the others.
- For the main loop, the window is the compaction window: `breakdown.rawMaxTokens` of `$.session.usage` (`sampleOf` in `context.ts`). It can be smaller than the window of the model. If the breakdown does not have it, the window is the window of the model.
```

Section 3, in the `Context` row, replace `The window is `1M` or `200k` (`windowLabel`).` with `The window is its count in `k` or `M` (`windowLabel`): `200k`, `400k`, `1M`.`

Section 7, delete the bullet that starts with `- A dashboard row with a warning`.

Section 10, replace the color table and the bullet `An overhead of more than 0 tokens has one cell at least.` with:

```markdown
| Part, in this order | Color |
|---|---|
| `Messages` | `cyan` |
| `System tools` | `orange` |
| `MCP tools` | `green` |
| `Skills` | `yellow` |
| each other used row, as one part | `dim` |
| compact buffer | the darker shade of `dim` (`darker`: each channel at 55 percent) |
| free room | `strip` |

- The first four parts are in the order of their tokens, the costliest first (`PART_COLORS` in `context.ts`).
- A part with more than 0 tokens has one cell at least. The free room has the cells that stay.
- The bar does not use the context tone. The tone is on the context length only.
- In the table of the context screen, the `window(%)` cell of a used row has the color of its part (`rowColor`). The cell of the compact buffer, of the free room and of a deferred row is dim.
```

Section 1, add to the use of `cyan`, `orange`, `green` and `yellow` in the palette table: `A part of the context bar.` Change the source line of section 10 to name `barSegments` only (`barCells` is gone).

- [ ] **Step 2: README**

In `README.md`, replace the bullets of `## Context screen` from `- Below the dashboard` through `- `dead weight` lists` with:

```markdown
- Below the dashboard, a block shows the context length (`ctx 226.9k/400k 57%`), a bar and three totals.
- The window is the compaction window: the count that you set with `/autocompact`, or the window of the model. Thus the numbers agree with the context window of Claude Desktop.
- The bar shows the messages, the system tools, the MCP tools and the skills each in a color, the rest of the content in grey, then the room that auto-compaction keeps and the free room.
- The first row also shows the growth of a turn, the tokens before auto-compaction (`140.1k to compact`) and the turns before it.
- The overhead is the content that each request carries before the conversation: the system prompt, the tools, the memory files and the skills.
- Press `context` to see each row of the window with its share (`window(%)`). Press a row with a `▸` mark to see its MCP servers, its memory files or its skills.
- `carry($)` is an estimate of what an overhead row cost in this session: its tokens, multiplied by the steps of the main loop and by the cache read price.
- `dead weight` lists the MCP servers that have loaded tools and that the session did not call.
```

In `Limits:`, replace the bullet `- A tool that loads on demand is not in the window, and thus not in the overhead.` with:

```markdown
- A tool that loads on demand is not in the window. Its row (`deferred`) has no share.
- The context length of a subagent uses the window of its model.
```

Translate the same bullets in `docs/i18n/README.vi.md`. Then change the commit that the translation names to the new commit of `README.md` (commit `README.md` first: Step 5 has the order).

- [ ] **Step 3: Changelog, version and compatibility**

`CHANGELOG.md`, add above `### [0.8.1] - 2026-10-09`:

```markdown
### [0.9.0] - 2026-10-11

Tested on Claude Code 2.1.296.

#### Changed

- The context length of the main loop uses the compaction window (`/autocompact`), as the context window of Claude Desktop does.
- The context screen shows each row of the window: the messages, the overhead, the compact buffer, the free room and the deferred tools.
- The share of a row is its share of the window (`window(%)`).
- The bar shows the messages, the system tools, the MCP tools and the skills each in a color.
- The first row of the context shows the tokens before auto-compaction.

#### Removed

- The note about the cache read price of Sonnet 5.5: Claude Code 2.1.296 counts it at the listed price.
```

Match the heading style of the 0.8.0 entry if it differs.

`mods/flight-deck/.claude-plugin/plugin.json`: `"version": "0.9.0"`.

`CLAUDE.md` line 7: change the two `2.1.295` to `2.1.296`.

`docs/specs/2026-10-07-flight-deck-context-breakdown-design.md`, add to the end of its status line: ` Version 0.9.0 changes sections 4.1, 5, 6.2 and 6.3: see `2026-10-11-flight-deck-context-parity-design.md`.`

- [ ] **Step 4: Run the check**

Run: `bun run check`
Expected: PASS.

Run the tests on the engine of Claude Desktop too:

```bash
"$(ls -d ~/Library/Application\ Support/Claude/claude-code/2.1.295/*/claude.app/Contents/MacOS/claude | head -1)" plugin test mods/flight-deck
```

Expected: PASS. A failure is a tree that the desktop refuses.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/design-system.md CHANGELOG.md CLAUDE.md mods/flight-deck/.claude-plugin/plugin.json docs/specs/2026-10-07-flight-deck-context-breakdown-design.md
git commit -m "docs(flight-deck): context parity (0.9.0)"
git add docs/i18n/README.vi.md
git commit -m "docs(flight-deck): follow the README in the Vietnamese translation"
```

- [ ] **Step 6: Live examination (a person)**

This step needs a person at a live session with `/autocompact 400k` set.

1. Terminal: `claude --plugin-dir mods/flight-deck`. Send one prompt. Open the pane and press `context`.
2. Compare with `/context`: the context length, the window, each row and its percentage.
3. Claude Desktop: type `/reload-plugins --force`. Open the pane and press `context`. Compare with the context window of the desktop.
4. Examine the bar: the colors are in one row, and no part is some pixels off.
5. Examine the `window(%)` column: each cell is readable, and the columns line up with the Buttons.
6. Press `▸ MCP tools (deferred)`: the servers show. Press `back`: the focus ring is on `context`.

Record a defect in `.tmp/`, and correct it with a test before the release.
