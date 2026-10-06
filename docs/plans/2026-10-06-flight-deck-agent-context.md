# flight-deck Agent Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pane shows the model, the effort and the context length of each agent, with a color for the context percentage. The band shows the cache hit and the cache countdown as one group.

**Architecture:** The `turn.step` hook writes `context: { tokens, window }` to the registry entry of the agent. Pure functions in `src/window.ts` and `src/detail.ts` calculate the window, the percentage, the tone and the cells of the detail row. `src/pane.tsx` draws an expand button, a detail row and a context part on the transcript screen.

**Tech Stack:** TypeScript, Bun 1.4.2, Claude Code 2.1.291 plugin API, `claude-code/testing`, Biome.

**Spec:** `docs/specs/2026-10-06-flight-deck-agent-context-design.md`

## Global Constraints

- All paths below are relative to the repository root. The mod is in `mods/flight-deck/`.
- Run each command from the repository root.
- `bun run check` must pass before a task is complete.
- TDD: write the test, see it fail, then write the code.
- Docs, code comments, identifiers, commit messages and drawn strings are English.
- `mods/flight-deck/types/index.d.ts` has no imports. `src/` imports types from `../types`.
- A function that receives `$` is a module-level `function` declaration in `hooks/register.tsx`.
- `ui.render` does not write state.
- No emoji in drawn text. The one exception is the pane title.
- A drawn row is one row. Remove parts. Do not wrap.
- On a desktop, each cell in a row with a Button is a `Client` cell. Use the `cell()` helper of `src/pane.tsx`.
- Context tokens: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. No output tokens.
- Tones: less than 50 `ok` (green), 50 to 79 `warn` (yellow), 80 or more `danger` (red).
- Version: 0.5.0.

## Review Focus

1. A usage with an absent token field. The context tokens must be a finite number, not `NaN`. Test: Task 1.
2. More tokens than the window (the mod cannot see each window input). The percentage must be 100, not more. Test: Task 1.
3. A registry that version 0.4.0 stored (no `context`), or a `context` with a bad shape. The entry must load, with no context part. Test: Task 2.
4. A pane state from a hot reload (no `expandedAgents`). A press of the expand button must open the row, not fail. Test: Task 4.
5. A narrow pane. The detail row must stay one row and must not have a negative width. Test: Task 3.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `mods/flight-deck/src/window.ts` | Create | Context tokens, window, percentage, tone, text. |
| `mods/flight-deck/src/detail.ts` | Create | The cells of the detail row for a width. |
| `mods/flight-deck/types/index.d.ts` | Modify | `AgentEntry.context`, `PaneView.expandedAgents`, `PaneAction` `expand`. |
| `mods/flight-deck/src/registry.ts` | Modify | `tuned` writes the context. `parseRegistry` reads it. |
| `mods/flight-deck/src/ttl.ts` | Modify | Export `isOn`. |
| `mods/flight-deck/src/layout.ts` | Modify | The groups of the band. |
| `mods/flight-deck/src/action.ts` | Modify | `expand:<id>` key, `toggled`. |
| `mods/flight-deck/src/pane.tsx` | Modify | Expand button, detail row, context part of the transcript screen. |
| `mods/flight-deck/hooks/register.tsx` | Modify | Write the context, the `expand` action, the title, the empty row. |

---

### Task 0: Branch

- [ ] **Step 1: Make the branch and commit the spec and the plan**

```bash
git switch -c feat/flight-deck-0.5.0
git add docs/specs/2026-10-06-flight-deck-agent-context-design.md docs/plans/2026-10-06-flight-deck-agent-context.md
git commit -m "docs(flight-deck): spec and plan for the agent context length"
```

---

### Task 1: Window functions

**Files:**
- Create: `mods/flight-deck/src/window.ts`
- Test: `mods/flight-deck/src/window.test.ts`

**Interfaces:**
- Consumes: `formatTokens` from `src/format.ts`, `PALETTE` from `src/palette.ts`.
- Produces:
  - `type Context = { tokens: number; window: number }`
  - `contextTokens(u: Usage): number`
  - `contextWindow(model: string, isDisabled1m: boolean): number`
  - `contextPct(c: Context): number`
  - `contextTone(pct: number): 'ok' | 'warn' | 'danger'`
  - `contextColor(c: Context): string`
  - `contextText(c: Context, isFull: boolean): string`

- [ ] **Step 1: Write the failing test**

Create `mods/flight-deck/src/window.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { PALETTE } from './palette'
import {
  contextColor,
  contextPct,
  contextText,
  contextTokens,
  contextTone,
  contextWindow,
} from './window'

test('context tokens are the input side of a step, without the output', () => {
  expect(
    contextTokens({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 10,
    }),
  ).toBe(100)
})

test('an absent token field counts as zero', () => {
  expect(contextTokens({ input_tokens: 7 })).toBe(7)
  expect(contextTokens({})).toBe(0)
})

test('the three known ids get the window of the catalog', () => {
  expect(contextWindow('claude-haiku-4-5-20251001', false)).toBe(200_000)
  expect(contextWindow('claude-sonnet-5-5', false)).toBe(1_000_000)
  expect(contextWindow('claude-opus-5-5', false)).toBe(1_000_000)
})

test('each native prefix gives 1M and an older model gives 200k', () => {
  for (const m of [
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5-1',
    'claude-mythos-5',
    'opus-5-5',
  ])
    expect(contextWindow(m, false)).toBe(1_000_000)
  for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'm', ''])
    expect(contextWindow(m, false)).toBe(200_000)
})

test('a [1m] suffix gives 1M, in each letter case', () => {
  expect(contextWindow('claude-sonnet-4-6[1m]', false)).toBe(1_000_000)
  expect(contextWindow('claude-haiku-4-5[1M]', false)).toBe(1_000_000)
})

test('the disable flag gives 200k for each model', () => {
  expect(contextWindow('claude-opus-5-5', true)).toBe(200_000)
  expect(contextWindow('claude-sonnet-4-6[1m]', true)).toBe(200_000)
})

test('the percentage is a whole number from 0 to 100', () => {
  expect(contextPct({ tokens: 0, window: 200_000 })).toBe(0)
  expect(contextPct({ tokens: 182_400, window: 1_000_000 })).toBe(18)
  expect(contextPct({ tokens: 300_000, window: 200_000 })).toBe(100)
  expect(contextPct({ tokens: 10, window: 0 })).toBe(0)
})

test('the tone changes at 50 and at 80', () => {
  expect(contextTone(49)).toBe('ok')
  expect(contextTone(50)).toBe('warn')
  expect(contextTone(79)).toBe('warn')
  expect(contextTone(80)).toBe('danger')
})

test('the color follows the tone', () => {
  expect(contextColor({ tokens: 10, window: 200_000 })).toBe(PALETTE.green)
  expect(contextColor({ tokens: 100_000, window: 200_000 })).toBe(PALETTE.yellow)
  expect(contextColor({ tokens: 160_000, window: 200_000 })).toBe(PALETTE.red)
})

test('the text names the tokens, the window and the percentage', () => {
  expect(contextText({ tokens: 182_400, window: 1_000_000 }, true)).toBe('ctx 182.4k/1M 18%')
  expect(contextText({ tokens: 100, window: 200_000 }, true)).toBe('ctx 100/200k 0%')
  expect(contextText({ tokens: 182_400, window: 1_000_000 }, false)).toBe('ctx 18%')
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun run test`
Expected: FAIL. The module `./window` does not exist.

- [ ] **Step 3: Write the code**

Create `mods/flight-deck/src/window.ts`:

```ts
import { formatTokens } from './format'
import { PALETTE } from './palette'

// The input side of an agent's latest step, and the window of the step's model.
export type Context = { tokens: number; window: number }

type Usage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// The tokens a step was answered over, as the status line's `used_percentage` counts them:
// the output is not part of them.
export const contextTokens = (u: Usage): number =>
  (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)

const SMALL = 200_000
const LARGE = 1_000_000
// The models whose window is 1M with no suffix, by the start of the id after `claude-`
// (the `native_1m` rows of the catalog in the Claude Code 2.1.291 binary).
const NATIVE_1M = ['opus-4-7', 'opus-4-8', 'opus-5', 'sonnet-5', 'fable-5', 'mythos-5'] as const

// The engine's resolver, read from the Claude Code 2.1.291 binary (minified, names restored):
//
//   function contextWindow(model, betas) {
//     if (has1mSuffix(model) && !CLAUDE_CODE_DISABLE_1M_CONTEXT) return 1e6
//     if (betas?.includes('context-1m-2025-08-07') && supports1mBeta(model)) return 1e6
//     const declared = declaredWindow(model)
//     if (declared !== undefined) return sonnet46Override(model) ?? declared.believed
//     if (isNative1m(model)) return 1e6
//     return 200000
//   }
//
// A plugin sees neither the betas, nor the server override, nor a remote catalog.
export const contextWindow = (model: string, isDisabled1m: boolean): number => {
  if (isDisabled1m) return SMALL
  if (/\[1m\]/i.test(model)) return LARGE
  const id = model.toLowerCase().replace(/^claude-/, '')
  return NATIVE_1M.some((p) => id === p || id.startsWith(`${p}-`)) ? LARGE : SMALL
}

// `tokens` over `window` as a whole percentage, kept between 0 and 100.
export const contextPct = (c: Context): number =>
  c.window > 0 ? Math.min(100, Math.max(0, Math.round((c.tokens / c.window) * 100))) : 0

export const contextTone = (pct: number): 'ok' | 'warn' | 'danger' =>
  pct >= 80 ? 'danger' : pct >= 50 ? 'warn' : 'ok'

const TONE = { ok: PALETTE.green, warn: PALETTE.yellow, danger: PALETTE.red } as const

export const contextColor = (c: Context): string => TONE[contextTone(contextPct(c))]

// A window as `1M` or `200k`: a whole count has no decimal.
const windowLabel = (n: number): string =>
  n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}k`

// `ctx 182.4k/1M 18%`, or `ctx 18%` where the row has no room for the counts.
export const contextText = (c: Context, isFull: boolean): string =>
  isFull
    ? `ctx ${formatTokens(c.tokens)}/${windowLabel(c.window)} ${contextPct(c)}%`
    : `ctx ${contextPct(c)}%`
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck/src/window.ts mods/flight-deck/src/window.test.ts
git commit -m "feat(flight-deck): add the context window functions"
```

---

### Task 2: The registry holds the context

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts` (`AgentEntry`)
- Modify: `mods/flight-deck/src/registry.ts` (`tuned`, `parseRegistry`)
- Modify: `mods/flight-deck/src/ttl.ts` (`isOn`)
- Modify: `mods/flight-deck/hooks/register.tsx` (`turn.step`)
- Test: `mods/flight-deck/src/registry.test.ts`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: `contextTokens`, `contextWindow`, `contextText` from Task 1.
- Produces:
  - `AgentEntry.context?: { tokens: number; window: number }`
  - `tuned(r, id, model, effort, context?: { tokens: number; window: number }): Registry`
  - `isOn(v: string | undefined): boolean` exported from `src/ttl.ts`

- [ ] **Step 1: Write the failing unit test**

Add to the end of `mods/flight-deck/src/registry.test.ts`:

```ts
test('tune writes the context and a step with no usage keeps it', () => {
  const ctx = { tokens: 100, window: 1_000_000 }
  let r = tuned(spawned({}, 'a1', 100, {}), 'a1', 'claude-sonnet-5-5', 'high', ctx)
  expect(r.a1?.context).toEqual(ctx)
  r = tuned(r, 'a1', 'claude-sonnet-5-5', 'high')
  expect(r.a1?.context).toEqual(ctx)
  expect(parseRegistry(JSON.parse(JSON.stringify(r)))).toEqual(r)
})

test('parseRegistry loads an entry with no context and ignores a bad one', () => {
  const old = tuned(spawned({}, 'a1', 100, {}), 'a1', 'm', undefined)
  expect(parseRegistry(JSON.parse(JSON.stringify(old))).a1?.context).toBeUndefined()
  for (const bad of [{ tokens: 'x', window: 1 }, { tokens: 1 }, 5, null, { tokens: 1, window: null }]) {
    const raw = { a1: { ...old.a1, context: bad } }
    expect(parseRegistry(raw).a1).toEqual(old.a1)
  }
})
```

- [ ] **Step 2: Write the failing hook test**

Add to the end of `mods/flight-deck/hooks/register.test.ts`:

```ts
test('the transcript screen shows the context length of the agent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', agentId: 'a1' } as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-haiku-4-5-20251001', agentId: 'a2' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // The agents table shows no context length while each detail row is closed.
    expect(await paneText(ui)).not.toContain('ctx ')
    await ui.press({ key: 'agent:a1' })
    expect(await paneText(ui)).toContain('ctx 100/1M 0%')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'agent:a2' })
    expect(await paneText(ui)).toContain('ctx 100/200k 0%')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the 1M disable variable gives a window of 200k', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, undefined, { CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' })
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', agentId: 'a1' } as never)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  expect(await paneText(ui)).toContain('ctx 100/200k 0%')
  await ui.unmount()
})

test('an agent with no step shows no context part', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  expect(await paneText(ui)).not.toContain('ctx ')
  expect(await ui.find({ key: 'meta:sep:ctx' })).toBeUndefined()
  await ui.unmount()
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `bun run test`
Expected: FAIL. `r.a1?.context` is `undefined`, and the pane text has no `ctx 100/1M 0%`.

- [ ] **Step 4: Add the type**

In `mods/flight-deck/types/index.d.ts`, in `AgentEntry`, after the `effort?: string` line:

```ts
  // The input side of the agent's latest step, and the window of the step's model.
  context?: { tokens: number; window: number }
```

- [ ] **Step 5: Change `tuned` and `parseRegistry`**

In `mods/flight-deck/src/registry.ts`, replace `tuned` and its comment:

```ts
// The model and the effort of a known agent's latest step: a step without effort clears it.
// `context` is absent for a step with no usage: the entry keeps the one it has.
export const tuned = (
  r: Registry,
  id: string,
  model: string,
  effort: string | undefined,
  context?: AgentEntry['context'],
): Registry => {
  const known = r[id]
  if (known === undefined) return r
  const { effort: _, ...a } = known
  return {
    ...r,
    [id]: {
      ...a,
      model,
      ...(effort === undefined ? {} : { effort }),
      ...(context === undefined ? {} : { context }),
    },
  }
}
```

In `parseRegistry`, after `const effort = str(v.effort)`:

```ts
    const c = v.context
    const context =
      isRecord(c) && isNum(c.tokens) && isNum(c.window)
        ? { tokens: c.tokens, window: c.window }
        : undefined
```

In the same function, after the `...(effort === undefined ? {} : { effort }),` line:

```ts
      ...(context === undefined ? {} : { context }),
```

- [ ] **Step 6: Export `isOn`**

In `mods/flight-deck/src/ttl.ts`, change `const isOn = (` to `export const isOn = (`.

- [ ] **Step 7: Write the context in the hook**

In `mods/flight-deck/hooks/register.tsx`:

Change the `ttl` import to:

```ts
import { cacheTtls, isOn, isOverLimit, type Ttl } from '../src/ttl'
```

Add after the `usage` import:

```ts
import { contextTokens, contextWindow } from '../src/window'
```

In the `turn.step` hook, replace these four lines:

```ts
      if (agentId !== undefined)
        await trackAgent($, id, (r, t) => tuned(ran(r, agentId, t), agentId, e.model, effort))
      // The dashboard's numbers changed.
      else await syncPane($)
```

with:

```ts
      if (agentId !== undefined) {
        // A step with no usage tells nothing of the window: the entry keeps its context.
        const context =
          res.usage === null
            ? undefined
            : {
                tokens: contextTokens(res.usage),
                window: contextWindow(
                  e.model,
                  isOn(await $.env.get('CLAUDE_CODE_DISABLE_1M_CONTEXT')),
                ),
              }
        await trackAgent($, id, (r, t) =>
          tuned(ran(r, agentId, t), agentId, e.model, effort, context),
        )
      } else {
        // The dashboard's numbers changed.
        await syncPane($)
      }
```

- [ ] **Step 8: Draw the context on the transcript screen**

In `mods/flight-deck/src/pane.tsx`, add the import:

```ts
import { contextColor, contextText } from './window'
```

In the `meta` Box, after the `{cell('meta:time', timeCell(agent, now))}` line:

```tsx
          {agent.context !== undefined && cell('meta:sep:ctx', { text: SEP, dim: true })}
          {agent.context !== undefined &&
            cell('meta:ctx', {
              text: contextText(agent.context, true),
              color: contextColor(agent.context),
            })}
```

- [ ] **Step 9: Run the tests and see them pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): show the context length on the transcript screen"
```

---

### Task 3: Detail row cells

**Files:**
- Create: `mods/flight-deck/src/detail.ts`
- Test: `mods/flight-deck/src/detail.test.ts`

**Interfaces:**
- Consumes: `contextColor`, `contextText` (Task 1), `shortModel` from `src/dashboard.ts`, `cut` from `src/clip.ts`, `AgentEntry.context` (Task 2).
- Produces: `detailCells(a: AgentEntry, room: number): Cell[]`. The cells are drawn in a row with a gap of one cell. A separator is a cell of its own. The sum of the text lengths plus the gaps is not more than `room`, when `room` is 1 or more.

- [ ] **Step 1: Write the failing test**

Create `mods/flight-deck/src/detail.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import type { AgentEntry, Cell } from '../types'
import { detailCells } from './detail'
import { PALETTE } from './palette'

const agent = (extra: Partial<AgentEntry>): AgentEntry => ({
  id: 'a1',
  status: 'idle',
  runs: 1,
  startedAt: 0,
  endedAt: 10,
  ...extra,
})
const full = agent({
  model: 'claude-sonnet-5-5',
  effort: 'high',
  context: { tokens: 182_400, window: 1_000_000 },
})
// The row as the pane draws it: the cells with one cell between them.
const row = (cells: Cell[]) => cells.map((c) => c.text).join(' ')

test('the detail row names the model, the effort and the context length', () => {
  const cells = detailCells(full, 80)
  expect(row(cells)).toBe('sonnet-5-5 · high · ctx 182.4k/1M 18%')
  expect(cells.at(-1)).toEqual({ text: 'ctx 182.4k/1M 18%', color: PALETTE.green })
  expect(cells.slice(0, -1).every((c) => c.dim === true)).toBe(true)
})

test('an absent part has no cell and no separator', () => {
  expect(row(detailCells(agent({ model: 'claude-haiku-4-5-20251001' }), 80))).toBe('haiku-4-5')
  expect(
    row(detailCells(agent({ model: 'm', context: { tokens: 100_000, window: 200_000 } }), 80)),
  ).toBe('m · ctx 100.0k/200k 50%')
})

test('an agent with no step says so', () => {
  expect(detailCells(agent({}), 80)).toEqual([{ text: 'no step yet', dim: true }])
})

test('a narrow row drops the counts first, then cuts the model', () => {
  expect(row(detailCells(full, 30))).toBe('sonnet-5-5 · high · ctx 18%')
  const narrow = row(detailCells(full, 24))
  expect(narrow.length).toBeLessThanOrEqual(24)
  expect(narrow).toContain('ctx 18%')
  expect(narrow).toContain('high')
})

test('a row with no room stays one row of a positive width', () => {
  for (const room of [10, 1, 0, -5]) {
    const cells = detailCells(full, room)
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((c) => c.text.length > 0)).toBe(true)
  }
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun run test`
Expected: FAIL. The module `./detail` does not exist.

- [ ] **Step 3: Write the code**

Create `mods/flight-deck/src/detail.ts`:

```ts
import type { AgentEntry, Cell } from '../types'
import { cut } from './clip'
import { shortModel } from './dashboard'
import { contextColor, contextText } from './window'

const SEP = '·'

// The cells of the row below an agent's row: the model, the effort and the context length,
// a dot between them. The pane draws them with one cell between cells, so the row is as
// wide as the texts joined by a space. A row wider than `room` drops the counts of the
// context first; then the model is cut.
export const detailCells = (a: AgentEntry, room: number): Cell[] => {
  const ctx = a.context
  if (a.model === undefined && ctx === undefined) return [{ text: 'no step yet', dim: true }]
  const build = (model: string | undefined, isFull: boolean): Cell[] => {
    const parts: Cell[] = [
      ...(model === undefined ? [] : [{ text: model, dim: true }]),
      ...(a.effort === undefined ? [] : [{ text: a.effort, dim: true }]),
      ...(ctx === undefined ? [] : [{ text: contextText(ctx, isFull), color: contextColor(ctx) }]),
    ]
    return parts.flatMap((p, i) => (i === 0 ? [p] : [{ text: SEP, dim: true }, p]))
  }
  const width = (cells: Cell[]) => cells.reduce((n, c) => n + c.text.length, 0) + cells.length - 1
  const model = a.model === undefined ? undefined : shortModel(a.model)
  const wide = build(model, true)
  if (width(wide) <= room) return wide
  const short = build(model, false)
  if (model === undefined || width(short) <= room) return short
  // The model gives the room the row is short of, and keeps one character at least.
  return build(cut(model, Math.max(1, model.length - (width(short) - room))), false)
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun run check`
Expected: PASS. `cut(text, n)` of `src/clip.ts` gives `n` cells at most, and its last cell is `…` when it cuts.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck/src/detail.ts mods/flight-deck/src/detail.test.ts
git commit -m "feat(flight-deck): add the cells of the agent detail row"
```

---

### Task 4: Expand button and detail row

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts` (`PaneView`, `PaneAction`)
- Modify: `mods/flight-deck/src/action.ts`
- Modify: `mods/flight-deck/src/pane.tsx`
- Modify: `mods/flight-deck/hooks/register.tsx`
- Test: `mods/flight-deck/src/action.test.ts`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: `detailCells(a, room)` from Task 3.
- Produces:
  - `PaneView.expandedAgents: string[]`
  - `PaneAction` member `{ kind: 'expand'; agentId: string }`
  - `toggled(list: readonly string[] | undefined, id: string): string[]` in `src/action.ts`
  - `AgentPane` prop `onExpand: (agentId: string) => void`
  - Button key `expand:<agentId>`

- [ ] **Step 1: Write the failing unit test**

In `mods/flight-deck/src/action.test.ts`, change the import to:

```ts
import { focusAction, toggled } from './action'
```

Add to the first test, after the `agent:a9` line:

```ts
  expect(focusAction('expand:a9', null)).toEqual({ kind: 'expand', agentId: 'a9' })
```

Add to the second test:

```ts
  expect(focusAction('expand:', null)).toBeNull()
```

Add to the end of the file:

```ts
test('toggled adds an absent id and removes a present one', () => {
  expect(toggled([], 'a1')).toEqual(['a1'])
  expect(toggled(['a1', 'a2'], 'a1')).toEqual(['a2'])
  // A pane state of an older shape (a hot reload) has no list.
  expect(toggled(undefined, 'a1')).toEqual(['a1'])
})
```

- [ ] **Step 2: Write the failing pane test**

Add to the end of `mods/flight-deck/hooks/register.test.ts`:

```ts
test('the expand button shows and hides the detail row of an agent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', effort: 'high', agentId: 'a1' } as never)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(String((await ui.find({ key: 'expand:a1' }))?.props.label)).toBe('▸')
    expect(await paneText(ui)).not.toContain('ctx ')

    await ui.press({ key: 'expand:a1' })
    expect(String((await ui.find({ key: 'expand:a1' }))?.props.label)).toBe('▾')
    const open = await paneText(ui)
    expect(open).toContain('high')
    expect(open).toContain('ctx 100/1M 0%')
    // The other row stays closed.
    expect(open).not.toContain('no step yet')

    await ui.press({ key: 'expand:a2' })
    expect(await paneText(ui)).toContain('no step yet')

    // The rows stay open across a transcript.
    await ui.press({ key: 'agent:a1' })
    await ui.press({ key: 'back' })
    expect(await paneText(ui)).toContain('no step yet')

    await ui.press({ key: 'expand:a1' })
    await ui.press({ key: 'expand:a2' })
    const closed = await paneText(ui)
    expect(closed).not.toContain('ctx ')
    expect(closed).not.toContain('no step yet')
    await ui.unmount()
  }
})

test('the name button still opens the transcript beside the expand button', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'agent:a1' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `bun run test`
Expected: FAIL. `toggled` is not exported, and `ui.find({ key: 'expand:a1' })` is `undefined`.

- [ ] **Step 4: Add the types**

In `mods/flight-deck/types/index.d.ts`:

Replace the comment and the type of `PaneView`:

```ts
// What the pane shows. `agentId` null is the agent tree; `expanded` holds the tool_use ids
// of the open tool calls; `expandedAgents` the ids of the agents whose detail row is open;
// `isWrapped` draws a transcript's long text on several rows.
export type PaneView = {
  isOpen: boolean
  isWrapped: boolean
  agentId: string | null
  expanded: string[]
  expandedAgents: string[]
  transcript: Transcript | null
}
```

In `PaneAction`, after the `open` member:

```ts
  | { kind: 'expand'; agentId: string }
```

- [ ] **Step 5: Change `src/action.ts`**

After the `if (kind === 'agent')` line:

```ts
  if (kind === 'expand') return { kind: 'expand', agentId: id }
```

At the end of the file:

```ts
// A list of open ids with `id` added, or removed when it is there. A pane state of an older
// shape (a hot reload) has no list.
export const toggled = (list: readonly string[] | undefined, id: string): string[] =>
  (list ?? []).includes(id) ? (list ?? []).filter((x) => x !== id) : [...(list ?? []), id]
```

- [ ] **Step 6: Change `hooks/register.tsx`**

Change the `action` import to:

```ts
import { focusAction, toggled } from '../src/action'
```

In `initialPane`, after `expanded: [],`:

```ts
  expandedAgents: [],
```

In `loadAgents`, the ids of another session are not kept. Replace the `update($, pane, ...)` line:

```ts
  await update($, pane, (c) => ({
    ...c,
    agentId: null,
    expanded: [],
    expandedAgents: [],
    transcript: null,
  }))
```

In `act`, after the `wrap` block and before the last `await update($, pane, ...)`:

```ts
  if (action.kind === 'expand') {
    await update($, pane, (c) => ({
      ...c,
      expandedAgents: toggled(c.expandedAgents, action.agentId),
    }))
    return
  }
```

In the `ui.render` hook of the pane, after the `onOpen` prop:

```tsx
        onExpand={(agentId) => act($, { kind: 'expand', agentId })}
```

- [ ] **Step 7: Change `src/pane.tsx`**

Add the import:

```ts
import { detailCells } from './detail'
```

In `Props`, after `onOpen`:

```ts
  onExpand: (agentId: string) => void
```

Add `onExpand,` to the destructured props of `AgentPane`, after `onOpen,`.

After the `MARK_WIDTH` constant:

```ts
// The width of the expand button of an agent's row, as a mark's.
const EXPAND_WIDTH = 2
```

In the agents table, replace the whole `rows.map(({ agent, depth }) => { ... })` block:

```tsx
        {rows.map(({ agent, depth }) => {
          const recent = recency(agent, now)
          const tone: Tone = recent === 'old' ? { dim: true } : { color: RECENCY_TONE[recent] }
          const isOpen = (view.expandedAgents ?? []).includes(agent.id)
          // The name gives its first cells to the expand button and a gap.
          const nameWidth = Math.max(1, t.name - depth * 2 - EXPAND_WIDTH - 1)
          // The detail row starts below the name's first character.
          const inset = depth * 2 + MARK_WIDTH + 1 + EXPAND_WIDTH + 1
          return (
            <Box key={`agentrow:${agent.id}`} flexDirection="column">
              {/* A Button takes no color: the status is the colored mark before it, and an
                  ended agent's row is dim at rest. The runs and the time take the color of
                  the recency. */}
              <Box key={`row:${agent.id}`} flexDirection="row" alignItems="center" gap={1}>
                {depth > 0 && (
                  <Box key={`indent:${agent.id}`} width={depth * 2 - 1} flexShrink={0} />
                )}
                {cell(`mark:${agent.id}`, agentMark(agent))}
                <Box key={`expandbox:${agent.id}`} width={EXPAND_WIDTH} flexShrink={0}>
                  <Button
                    key={`expand:${agent.id}`}
                    plain
                    dimColor
                    label={isOpen ? '▾' : '▸'}
                    onPress={() => onExpand(agent.id)}
                  />
                </Box>
                <Box key={`name:${agent.id}`} width={nameWidth} flexShrink={0}>
                  <Button
                    key={`agent:${agent.id}`}
                    plain
                    {...(agent.status === 'running' ? {} : { dimColor: true })}
                    label={cut(name(agent), nameWidth)}
                    onPress={() => onOpen(agent.id)}
                  />
                </Box>
                {cell(`runs:${agent.id}`, {
                  text: String(agent.runs),
                  ...tone,
                  width: t.runs,
                  align: 'right',
                })}
                {cell(`time:${agent.id}`, timeCell(agent, now, 'right', tone, ''))}
              </Box>
              {isOpen && (
                <Box
                  key={`detail:${agent.id}`}
                  flexDirection="row"
                  alignItems="center"
                  gap={1}
                  paddingLeft={inset}
                >
                  {detailCells(agent, columns - inset).map((c, i) =>
                    cell(`detail:${agent.id}:${i}`, c),
                  )}
                </Box>
              )}
            </Box>
          )
        })}
```

- [ ] **Step 8: Run the tests and see them pass**

Run: `bun run check`
Expected: PASS.

If an older test fails because the name is cut three cells sooner, change the expected text of that test only. Do not change the layout.

If the `marks` helper of `hooks/register.test.ts` finds no mark, it is because the mark is now one level deeper (`agentrow` holds `row`). The helper walks all levels, so no change is expected. Confirm with the test `an agent row is colored by its status`.

- [ ] **Step 9: Add the focus test**

Add to the end of `mods/flight-deck/hooks/register.test.ts`. The shape is that of the test `a click that gives the pane the focus also presses the button`.

```ts
test('a click that gives the pane the focus also opens the detail row', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('ui.focus', async () => ({ value: {} }) as never)
  await spawn($)
  const ui = await mountPane($, 'desktop', false)
  const click = (kind: 'person' | 'plugin') =>
    $.ui.focus({
      component: 'Pane',
      requestId: 'agents',
      plugin: 'flight-deck',
      element: 'expand:a1',
      origin: kind === 'person' ? { kind } : { kind, name: 'other' },
    } as never)
  // Another plugin's focus move does not press.
  await click('plugin')
  expect(await paneText(ui)).not.toContain('no step yet')
  await click('person')
  expect(await paneText(ui)).toContain('no step yet')
  await ui.unmount()
})
```

This test must pass with no new code: Step 5 and Step 6 give the action. If it fails, the `ui.focus` hook of `hooks/register.tsx` does not reach `act` for the key.

- [ ] **Step 10: Run the tests and see them pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): add an expand button and a detail row to each agent"
```

---

### Task 5: Pane title

**Files:**
- Modify: `mods/flight-deck/hooks/register.tsx`
- Test: `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PANE_TITLE = '🤖 Flight Deck'`. On the terminal, the second row of the pane is empty.

- [ ] **Step 1: Change the tests to the new title**

In `mods/flight-deck/hooks/register.test.ts`:

- Line 976: `expect(calls.title).toBe('🤖 Flight Deck')`
- Line 1175: `(x) => x.props.bold === true && x.text !== '🤖 Flight Deck',`
- Line 1580: `expect(await paneText(term)).toMatch(/^🤖 Flight Deck\n\s*\n/)`
- Line 1583: `expect(await paneText(desk)).not.toContain('Flight Deck')` (no change)

The line numbers are those before Task 2. Find each line with `grep -n "Flight Deck" mods/flight-deck/hooks/register.test.ts`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun run test`
Expected: FAIL. The title is `Flight Deck`.

- [ ] **Step 3: Write the code**

In `mods/flight-deck/hooks/register.tsx`:

```ts
// The one drawn text with an emoji: the title row has no columns, so a double-width
// character moves nothing.
const PANE_TITLE = '🤖 Flight Deck'
```

In the `ui.render` hook of the pane, replace the last `return`:

```tsx
    return (
      <ui.Box flexDirection="column" paddingX={pad}>
        <ui.Text bold>{PANE_TITLE}</ui.Text>
        {/* An empty row parts the title from the body. */}
        <ui.Text> </ui.Text>
        {body}
      </ui.Box>
    )
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `bun run check`
Expected: PASS. If line 1580 fails, print `JSON.stringify(await paneText(term)).slice(0, 60)` and make the pattern agree with one empty row after the title.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck
git commit -m "feat(flight-deck): give the pane title an icon and an empty row below it"
```

---

### Task 6: The band shows the cache as one group

**Files:**
- Modify: `mods/flight-deck/src/layout.ts`
- Test: `mods/flight-deck/src/layout.test.ts`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the band `↑ in  ↓ out │ ◈ cache N%  ◔ m:ss ━━━ │ ⌘ calls ... │ $ cost ...`. With the percentage removed (a narrow band), the countdown is `◔ cache m:ss`. `DROP_ORDER` does not change. `statSegments` shows `◈ cache N%`.

The widths of the test band (`src/layout.test.ts`, `snap` at `now: 78_000`), with the four cells of the button:

| Parts removed | Width before | Width after |
|---|---|---|
| none | 140 | 136 |
| bar | 129 | 125 |
| bar, bg | 121 | 117 |
| bar, bg, diff | 104 | 100 |
| bar, bg, diff, percentage | 94 | 94 |

Thus each width of the test `narrow widths drop the bar first, ...` stays correct.

- [ ] **Step 1: Change `src/layout.test.ts`**

Replace the test `metrics are grouped: tokens | activity | spend | cache`:

```ts
test('metrics are grouped: tokens | cache | activity | spend', () => {
  expect(text(146).split(' │ ')).toEqual([
    '↑ in 12.5k  ↓ out 3.1k',
    expect.stringMatching(/^◈ cache 1% {2}◔ 3:42 ━{10}$/),
    '⌘ calls 14  ▸ agents 2  ◇ bg 1  ◷ work 12:05',
    '$ cost 0.42  ± diff +120 -30',
  ])
})

test('a band with no room for the percentage gives the countdown its label', () => {
  expect(text(100).split(' │ ')[1]).toBe('◈ cache 1%  ◔ 3:42')
  expect(text(99).split(' │ ')).toEqual([
    '↑ in 12.5k  ↓ out 3.1k',
    '◔ cache 3:42',
    '⌘ calls 14  ▸ agents 2  ◷ work 12:05',
    '$ cost 0.42',
  ])
})
```

In the test `every metric is icon, label, value`:

- `expect(t).toContain('◈ hit 1%')` becomes `expect(t).toContain('◈ cache 1%')`
- `expect(t).toContain('◔ cache 3:42')` becomes `expect(t).toContain('◔ 3:42')`

In the test `every metric uses the same spacing: ...`, the countdown has no label now. Keep the count of 10. Replace the loop line `for (const m of metrics) expect(m.text).toMatch(/^\S [a-z]+ \S+$/)`:

```ts
  // Beside the percentage, the countdown is the clock and the time, with no label.
  for (const m of metrics)
    expect(m.text).toMatch(m.text.startsWith('◔') ? /^◔ \S+$/ : /^\S [a-z]+ \S+$/)
```

In the test `narrow widths drop the bar first, ...`:

- `expect(text(110)).toContain('hit')` becomes `expect(text(110)).toContain('◈ cache')`
- `expect(text(94)).not.toContain('hit')` becomes `expect(text(94)).not.toContain('◈')`

In the test `the countdown color follows the remaining time`: `s.text.startsWith('◔ cache ')` becomes `s.text.startsWith('◔ ')`.

In the test `an expired cache is dim text alone: ...`: `'◔ cache expired'` becomes `'◔ expired'`.

In each other test of the file:

- `'◈ hit 1%'` becomes `'◈ cache 1%'`
- `'◈ hit 90%'` becomes `'◈ cache 90%'` (the stats row)
- `'◔ cache 3:42'` in a band of an agent view becomes `'◔ 3:42'`

Do not change the test `agents is the last part the band drops` and the line `expect(text(20)).toBe('◔ cache 3:42')`. Those bands have no percentage.

- [ ] **Step 2: Change `hooks/register.test.ts`**

Each band of this file is 200 cells wide, so each has the percentage.

```bash
sed -i '' -e 's/◔ cache /◔ /g' -e 's/◈ hit /◈ cache /g' mods/flight-deck/hooks/register.test.ts
git diff --stat mods/flight-deck/hooks/register.test.ts
```

Expected: 16 changed lines.

- [ ] **Step 3: Run the tests and see them fail**

Run: `bun run test`
Expected: FAIL. The band still has `◈ hit` and `◔ cache 3:42` in the last group.

- [ ] **Step 4: Write the code**

In `mods/flight-deck/src/layout.ts`:

In `LABEL`, replace the `hit` line and add a line after `cache`:

```ts
  hit: '◈ cache',
```

```ts
  // The countdown beside the percentage: the percentage has the label.
  clock: '◔',
```

Replace `GROUPS`:

```ts
// The percentage of the prompt tokens that the cache gave, and the time the cache has left.
const GROUPS: readonly (readonly Part[])[] = [
  ['in', 'out'],
  ['hit', 'cache'],
  ['tools', 'agents', 'bg', 'work'],
  ['cost', 'diff'],
]
```

After the `type Part = ...` line:

```ts
// `timer` is the countdown with no label: it is drawn in place of `cache`, never dropped by name.
type Parts = Record<Part | 'timer', Segment[]>
```

In `bandSegments`, after the `const cacheColor = ...` line:

```ts
  const countdown = (label: string): Segment[] => [
    { text: `${label} ${formatCountdown(rem)}`, color: cacheColor, bold: pulse, inverse: pulse },
  ]
```

Change `const partsFor = (c: Counts): Record<Part, Segment[]> => ({` to `const partsFor = (c: Counts): Parts => ({`.

In `partsFor`, replace the whole `cache: [ ... ],` entry:

```ts
    cache: countdown(LABEL.cache),
    timer: countdown(LABEL.clock),
```

Change `const build = (parts: Record<Part, Segment[]>, dropped: ReadonlySet<string>): Segment[] => {` to `const build = (parts: Parts, dropped: ReadonlySet<string>): Segment[] => {`.

In `build`, replace the line `segs.push(...parts[part])`:

```ts
        // Beside the percentage the countdown has no label of its own.
        segs.push(...(part === 'cache' && !dropped.has('hit') ? parts.timer : parts[part]))
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mods/flight-deck/src/layout.ts mods/flight-deck/src/layout.test.ts mods/flight-deck/hooks/register.test.ts
git commit -m "feat(flight-deck): show the cache hit and the countdown as one group of the band"
```

---

### Task 7: Release 0.5.0

**Files:**
- Modify: `mods/flight-deck/.claude-plugin/plugin.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-10-06-flight-deck-agent-context-design.md`

- [ ] **Step 1: Set the version**

In `mods/flight-deck/.claude-plugin/plugin.json`: `"version": "0.5.0",`

- [ ] **Step 2: Add the changelog entry**

In `CHANGELOG.md`, below `### [Unreleased]`:

```markdown
### [0.5.0] - 2026-10-06

Tested on Claude Code 2.1.291.

#### Added

- Agents table: each row has an expand button (`▸`, `▾`). It shows or hides a detail row with the model, the effort and the context length of the agent: `sonnet-5-5 · high · ctx 182.4k/1M 18%`.
- Transcript screen: the row below the title shows the context length of the agent.
- The context length has a color for its percentage: green below 50, yellow from 50, red from 80.
- The context window of a model follows the resolver of Claude Code 2.1.291: 1M for Opus 4.7 and later, Sonnet 5 and later, Fable and Mythos, and for an id with `[1m]`. 200k for all other models, and for each model when `CLAUDE_CODE_DISABLE_1M_CONTEXT` is set.
- Terminal: an empty row is between the pane title and the pane body.

#### Changed

- The title of the pane is `🤖 Flight Deck`.
- Band: the cache hit percentage and the cache countdown are one group, after the tokens: `◈ cache 80%  ◔ 4:50 ━━━`. The label of the percentage is `cache`, not `hit`. A narrow band with no percentage shows `◔ cache 4:50`.
```

- [ ] **Step 3: Change the README**

Run `grep -n "agents\|transcript\|Flight Deck" README.md`. In the section that describes the pane, add these two list items:

```markdown
- Each agent row has an expand button. It shows the model, the effort and the context length of the agent (`ctx 182.4k/1M 18%`). The color is green below 50%, yellow from 50% and red from 80%.
- The transcript screen shows the same context length below the title.
```

Change each `Flight Deck` that names the pane title to `🤖 Flight Deck`. Do not change the name of the mod.

- [ ] **Step 4: Change `CLAUDE.md`**

In the `## UI` section, replace the first list item:

```markdown
- No emoji in drawn text: they are double width and misalign the row. Use single-width characters. The one exception is the pane title: its row has no columns.
```

- [ ] **Step 5: Correct the spec example**

In `docs/specs/2026-10-06-flight-deck-agent-context-design.md`, section 6, the model part of the row is the full id, as the screen has it now. Replace the example line:

```
claude-sonnet-5-5 high · 2 runs · ◷ 0:01:12 · ctx 182.4k/1M 18%
```

- [ ] **Step 6: Run all checks**

Run: `bun run check`
Expected: PASS.

Run: `python3 ~/.claude/skills/asd-ste100/scripts/ste-lint.py docs/specs/2026-10-06-flight-deck-agent-context-design.md`
Expected: `0 violations`.

- [ ] **Step 7: Commit**

```bash
git add mods/flight-deck/.claude-plugin/plugin.json CHANGELOG.md README.md CLAUDE.md docs/specs/2026-10-06-flight-deck-agent-context-design.md
git commit -m "feat(flight-deck): release 0.5.0"
```

---

### Task 8: Live check (a person does this)

The tests do not show how a real surface draws the pane.

- [ ] **Step 1: Terminal**

Run: `claude --plugin-dir mods/flight-deck`. Start two agents with different models. Open the pane with `/agent-log`.

Check:
1. The title is `🤖 Flight Deck`, and an empty row is below it.
2. Each row has `▸`. A press shows the detail row below the name. A second press hides it.
3. The runs and the time columns stay aligned with the header.
4. The transcript screen shows `ctx ...` at the end of the row below the title.
5. The second group of the band is `◈ cache N%  ◔ m:ss` and the bar. A narrow terminal shows `◔ cache m:ss`.

- [ ] **Step 2: Desktop**

Set `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Type `/reload-plugins --force`.

Check:
1. The four items of Step 1. The title is in the title bar of the pane.
2. A click on `▸` works when the pane does not hold the keys.
3. A click on `▸` works while an agent runs (the table draws again at each step).

- [ ] **Step 3: The `[1m]` suffix**

Run a session with `/model sonnet[1m]` or an agent whose model has `[1m]`, if the account permits it. Read `~/.claude/plugins/store/flight-deck_inline-*.json` and find the `model` of the agent.

- If the id keeps `[1m]`: no change.
- If the id does not keep it: record this in section 4.3 of the spec. The window of a 4.x model with a 1M variant then shows as 200k.

- [ ] **Step 4: Previews**

If the pane looks different, replace `previews/preview-cli-agent-dashboard.png`, `previews/preview-cli-agent-transcript.png`, `previews/preview-desktop-agent-dashboard.png` and `previews/preview-desktop-agent-transcript.png`. Commit them.
