# flight-deck Agent Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pane to `flight-deck` that lists the subagents of the session as a tree and shows the transcript of each one. The `◆ agents N` part of the band is the button that opens and closes the pane.

**Architecture:** The mod keeps an agent registry that it makes from `agent.spawn`, `turn.step`, `tool.call` and `turn.complete`. It stores the registry in `$.store` for each session. It reads a transcript with `$.session.messages({ agentId })` when the user opens an agent. Pure logic is in `src/` with unit tests. `hooks/register.tsx` connects events to state.

**Tech Stack:** Claude Code plugin API 2.1.289 (early access), TypeScript 7.0.2, Bun 1.4.2, Biome 2.5.15, `claude-code/testing`.

**Spec:** `docs/specs/2026-10-06-flight-deck-agent-pane-design.md`. Read it before Task 1.

## Global Constraints

- All paths below are relative to `mods/flight-deck/` unless they start with `docs/` or `README.md`.
- Docs, comments, identifiers, commit messages and drawn strings are English.
- No new dependency.
- TDD: write the failing test, run it, see it fail, then write the code.
- `bun run check` (lint, typecheck, validate, test) must pass at the end of each task.
- Run one test file with `claude plugin test mods/flight-deck` (it runs all `*.test.ts` files).
- The plugin API typings are `mods/flight-deck/.claude-plugin/types/claude-code/index.d.ts` (15,000 lines). Grep them for a name. Do not guess a prop or an event field. If a code block in this plan does not agree with the typings, the typings are correct: adapt the code and keep the behavior.
- `types/index.d.ts` is self-contained: no imports, only `export type` and `declare module 'claude-code'`.
- A function that receives `$` is a module-level `function` declaration in `hooks/register.tsx`.
- `ui.render` writes no state. Write from events or handlers, and compute in the updater: `update($, atom, c => ...)`.
- No emoji in drawn text. Each row fits `bodyColumns`. A long text is cut, not wrapped.
- Scratch files go in `.tmp/` of the repo, never `/tmp`.
- Do not change behavior of `flight-deck` that the spec does not name. Existing tests must continue to pass. Change a test helper only when this plan says so.
- Branch: `feat/flight-deck-agent-pane`. One commit for each task. Do not push.

## Review Focus

1. A `turn.step` or `tool.call` of an agent arrives before its `agent.spawn` result. Expected: one registry entry, with the spawn data filled later. Test in Task 1.
2. A stored registry has a wrong shape (old version, edited by hand). Expected: bad entries are ignored, no crash. Test in Task 1.
3. A child agent whose parent is not in the registry. Expected: the child shows at depth 0. Test in Task 2.
4. A tool result of 5,000 lines, or a tool input that is not a string. Expected: 40 lines maximum, with a hidden-line count. Test in Task 3.
5. The user opens agent A, then agent B before the read of A completes. Expected: the pane shows B only. Test in Task 7.

---

### Task 1: Registry types and reducers

**Files:**
- Modify: `types/index.d.ts`
- Create: `src/registry.ts`
- Test: `src/registry.test.ts`

**Interfaces:**
- Produces (in `types/index.d.ts`): `AgentEntry`, `Registry`, `Agents`, `TranscriptItem`, `Transcript`, `PaneView`, and the `PluginState` keys `agents` and `pane`.
- Produces (in `src/registry.ts`): `spawned`, `ran`, `completed`, `merged`, `parseRegistry`, `agentsKey`.

- [ ] **Step 1: Add the types**

Add to `types/index.d.ts`, before `declare module`:

```ts
// One subagent of the session, as the pane lists it. `runs` counts completed runs: a
// message to a completed agent starts it again under the same id.
export type AgentEntry = {
  id: string
  parentId?: string
  type?: string
  description?: string
  name?: string
  status: 'running' | 'idle'
  runs: number
  startedAt: number
  endedAt: number | null
}

export type Registry = Record<string, AgentEntry>

// The registry of one session; another session's entries are never drawn.
export type Agents = { sessionId: string | null; entries: Registry }

// One row of the transcript screen.
export type TranscriptItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'tool'
      id: string
      tool: string
      input: Record<string, unknown>
      result?: string
      isError: boolean
      agentId?: string
    }
  | { kind: 'answer'; text: string }

export type Transcript =
  | { agentId: string; items: TranscriptItem[] }
  | { agentId: string; deny: string }

// What the pane shows. `agentId` null is the agent tree; `expanded` holds the tool_use ids
// of the open tool calls.
export type PaneView = {
  isOpen: boolean
  agentId: string | null
  expanded: string[]
  transcript: Transcript | null
}
```

Add `agents: Agents` and `pane: PaneView` to the `'flight-deck'` block of `PluginState`.

- [ ] **Step 2: Write the failing test**

`src/registry.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { agentsKey, completed, merged, parseRegistry, ran, spawned } from './registry'

test('spawn adds a running entry with its data', () => {
  const r = spawned({}, 'a1', 100, { parentId: 'p', type: 'Explore', description: 'find x' })
  expect(r.a1).toEqual({
    id: 'a1',
    parentId: 'p',
    type: 'Explore',
    description: 'find x',
    status: 'running',
    runs: 0,
    startedAt: 100,
    endedAt: null,
  })
})

test('a step before the spawn makes one entry that the spawn fills', () => {
  const r = spawned(ran({}, 'a1', 50), 'a1', 100, { type: 'Explore' })
  expect(Object.keys(r)).toEqual(['a1'])
  expect(r.a1?.startedAt).toBe(50)
  expect(r.a1?.type).toBe('Explore')
})

test('complete sets idle, counts the run and stamps the end', () => {
  const r = completed(spawned({}, 'a1', 100, {}), 'a1', 200)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 1, endedAt: 200 })
})

test('a second run counts again', () => {
  let r = completed(spawned({}, 'a1', 100, {}), 'a1', 200)
  r = ran(r, 'a1', 300)
  expect(r.a1?.status).toBe('running')
  r = completed(r, 'a1', 400)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 2, endedAt: 400 })
})

test('merge adds an agent seen only in the list and fills absent fields', () => {
  const base = spawned({}, 'a1', 100, {})
  const r = merged(
    base,
    [
      { id: 'a1', status: 'running', type: 'Explore', description: 'd', name: 'n' },
      { id: 'a2', status: 'idle', type: 'fork' },
    ],
    500,
  )
  expect(r.a1).toMatchObject({ type: 'Explore', description: 'd', name: 'n', startedAt: 100 })
  expect(r.a2).toMatchObject({ id: 'a2', type: 'fork', status: 'idle', startedAt: 500 })
})

test('merge does not replace a field that is present', () => {
  const r = merged(spawned({}, 'a1', 100, { type: 'Plan' }), [{ id: 'a1', status: 'running', type: 'x' }], 500)
  expect(r.a1?.type).toBe('Plan')
})

test('parseRegistry ignores a wrong shape', () => {
  expect(parseRegistry(null)).toEqual({})
  expect(parseRegistry({ a: 1, b: { id: 'b' } })).toEqual({})
  const good = spawned({}, 'a1', 100, { type: 'Explore' })
  expect(parseRegistry(JSON.parse(JSON.stringify(good)))).toEqual(good)
})

test('agentsKey names the store key of a session', () => {
  expect(agentsKey('S1')).toBe('agents:S1')
})
```

- [ ] **Step 3: Run the test and see it fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL, `./registry` not found.

- [ ] **Step 4: Write `src/registry.ts`**

```ts
import type { AgentEntry, Registry } from '../types'

export type { AgentEntry, Registry }

type Info = Pick<AgentEntry, 'parentId' | 'type' | 'description' | 'name'>

// What `$.agent.list()` gives for one agent, reduced to the fields the registry uses.
export type Listed = {
  id: string
  status: string
  type?: string
  description?: string
  name?: string
  parentId?: string
}

export const agentsKey = (sessionId: string): string => `agents:${sessionId}`

const blank = (id: string, at: number): AgentEntry => ({
  id,
  status: 'running',
  runs: 0,
  startedAt: at,
  endedAt: null,
})

// Only fields that are present in `info` and absent in the entry are taken.
const fill = (a: AgentEntry, info: Partial<Info>): AgentEntry => ({
  ...a,
  ...(a.parentId === undefined && info.parentId !== undefined ? { parentId: info.parentId } : {}),
  ...(a.type === undefined && info.type !== undefined ? { type: info.type } : {}),
  ...(a.description === undefined && info.description !== undefined
    ? { description: info.description }
    : {}),
  ...(a.name === undefined && info.name !== undefined ? { name: info.name } : {}),
})

export const spawned = (r: Registry, id: string, at: number, info: Partial<Info>): Registry => ({
  ...r,
  [id]: fill(r[id] ?? blank(id, at), info),
})

// An event of the agent's loop: the agent runs. Its first event can come before the spawn.
export const ran = (r: Registry, id: string, at: number): Registry => ({
  ...r,
  [id]: { ...(r[id] ?? blank(id, at)), status: 'running' },
})

export const completed = (r: Registry, id: string, at: number): Registry => {
  const a = r[id] ?? blank(id, at)
  return { ...r, [id]: { ...a, status: 'idle', runs: a.runs + 1, endedAt: at } }
}

const ACTIVE = new Set(['pending', 'running', 'waiting'])

// The engine's list adds agents that raised no spawn (a forked skill) and fills absent
// fields. It does not change the status of a known entry: the events own that.
export const merged = (r: Registry, list: readonly Listed[], at: number): Registry => {
  let out = r
  for (const l of list) {
    const known = out[l.id]
    const base: AgentEntry =
      known ?? { ...blank(l.id, at), status: ACTIVE.has(l.status) ? 'running' : 'idle' }
    out = { ...out, [l.id]: fill(base, l) }
  }
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Defensive read: the store is JSON written by an earlier version or by hand.
export const parseRegistry = (raw: unknown): Registry => {
  if (!isRecord(raw)) return {}
  const out: Registry = {}
  for (const [id, v] of Object.entries(raw)) {
    if (!isRecord(v) || v.id !== id || !isNum(v.runs) || !isNum(v.startedAt)) continue
    const parentId = str(v.parentId)
    const type = str(v.type)
    const description = str(v.description)
    const name = str(v.name)
    out[id] = {
      id,
      ...(parentId === undefined ? {} : { parentId }),
      ...(type === undefined ? {} : { type }),
      ...(description === undefined ? {} : { description }),
      ...(name === undefined ? {} : { name }),
      status: v.status === 'running' ? 'running' : 'idle',
      runs: v.runs,
      startedAt: v.startedAt,
      endedAt: isNum(v.endedAt) ? v.endedAt : null,
    }
  }
  return out
}
```

Note: the key order of the `spawned` result must make the first test pass with `toEqual` (key order does not matter for `toEqual`).

- [ ] **Step 5: Run the checks**

Run: `bun run check`
Expected: PASS. If `validate` reports that `agents` or `pane` is declared and not used, continue: Task 6 uses them. If it fails the check for that reason, move the two `PluginState` keys to Task 6 and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add mods/flight-deck/types/index.d.ts mods/flight-deck/src/registry.ts mods/flight-deck/src/registry.test.ts
git commit -m "feat(flight-deck): add agent registry reducers"
```

---

### Task 2: Agent tree rows

**Files:**
- Create: `src/tree.ts`
- Test: `src/tree.test.ts`

**Interfaces:**
- Consumes: `Registry`, `AgentEntry` from `../types`.
- Produces: `treeRows(r: Registry): TreeRow[]` with `type TreeRow = { agent: AgentEntry; depth: number }`.

- [ ] **Step 1: Write the failing test**

`src/tree.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import type { Registry } from '../types'
import { treeRows } from './tree'

const agent = (id: string, startedAt: number, parentId?: string) => ({
  id,
  ...(parentId === undefined ? {} : { parentId }),
  status: 'idle' as const,
  runs: 1,
  startedAt,
  endedAt: startedAt + 1,
})

const ids = (r: Registry) => treeRows(r).map((row) => `${row.depth}:${row.agent.id}`)

test('the newest agent is first at each depth', () => {
  expect(ids({ a: agent('a', 1), b: agent('b', 2) })).toEqual(['0:b', '0:a'])
})

test('a child is below its parent, one level deeper', () => {
  const r = { a: agent('a', 1), b: agent('b', 5), a1: agent('a1', 2, 'a'), a2: agent('a2', 3, 'a'), a2x: agent('a2x', 4, 'a2') }
  expect(ids(r)).toEqual(['0:b', '0:a', '1:a2', '2:a2x', '1:a1'])
})

test('a child whose parent is absent shows at depth 0', () => {
  expect(ids({ c: agent('c', 1, 'gone') })).toEqual(['0:c'])
})

test('a parent cycle does not loop', () => {
  const r = { a: agent('a', 1, 'b'), b: agent('b', 2, 'a') }
  expect(treeRows(r).map((row) => row.agent.id).sort()).toEqual(['a', 'b'])
})

test('an empty registry gives no rows', () => {
  expect(treeRows({})).toEqual([])
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL, `./tree` not found.

- [ ] **Step 3: Write `src/tree.ts`**

```ts
import type { AgentEntry, Registry } from '../types'

export type TreeRow = { agent: AgentEntry; depth: number }

// The registry as the pane lists it: roots first, each child below its parent, the newest
// first at each depth. An agent whose parent is not known (or is part of a cycle) is a root.
export const treeRows = (r: Registry): TreeRow[] => {
  const all = Object.values(r).sort((a, b) => b.startedAt - a.startedAt)
  const rows: TreeRow[] = []
  const done = new Set<string>()
  const walk = (a: AgentEntry, depth: number): void => {
    if (done.has(a.id)) return
    done.add(a.id)
    rows.push({ agent: a, depth })
    for (const c of all) if (c.parentId === a.id) walk(c, depth + 1)
  }
  for (const a of all) if (a.parentId === undefined || r[a.parentId] === undefined) walk(a, 0)
  // What is left is in a parent cycle: draw it as roots.
  for (const a of all) walk(a, 0)
  return rows
}
```

- [ ] **Step 4: Run the checks**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck/src/tree.ts mods/flight-deck/src/tree.test.ts
git commit -m "feat(flight-deck): order agents as a tree"
```

---

### Task 3: Text limits and tool summaries

**Files:**
- Create: `src/clip.ts`, `src/summary.ts`
- Test: `src/clip.test.ts`, `src/summary.test.ts`

**Interfaces:**
- Produces: `clipLines(text: string, max: number): string`, `cut(text: string, columns: number): string`, `toolSummary(tool: string, input: Record<string, unknown>): string`, `inputText(input: Record<string, unknown>): string`.

- [ ] **Step 1: Write the failing tests**

`src/clip.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { clipLines, cut } from './clip'

test('a short text is not changed', () => {
  expect(clipLines('a\nb', 40)).toBe('a\nb')
})

test('a long text keeps max lines and gives the hidden count', () => {
  const text = Array.from({ length: 5000 }, (_, i) => `l${i}`).join('\n')
  const out = clipLines(text, 40).split('\n')
  expect(out).toHaveLength(41)
  expect(out[39]).toBe('l39')
  expect(out[40]).toBe('... 4960 more lines')
})

test('one hidden line reads as singular', () => {
  expect(clipLines('a\nb\nc', 2)).toBe('a\nb\n... 1 more line')
})

test('cut keeps one row inside the width', () => {
  expect(cut('abcdef', 10)).toBe('abcdef')
  expect(cut('abcdef', 4)).toBe('abc…')
  expect(cut('a\nb', 10)).toBe('a b')
  expect(cut('abc', 0)).toBe('')
})
```

`src/summary.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { inputText, toolSummary } from './summary'

test('a file tool shows its path', () => {
  expect(toolSummary('Read', { file_path: '/r/README.md' })).toBe('Read /r/README.md')
})

test('Bash shows its command on one row', () => {
  expect(toolSummary('Bash', { command: 'wc -l\nREADME.md' })).toBe('Bash wc -l README.md')
})

test('Agent shows its description', () => {
  expect(toolSummary('Agent', { description: 'find x', prompt: 'long' })).toBe('Agent find x')
})

test('a search tool shows its pattern', () => {
  expect(toolSummary('Grep', { pattern: 'foo', path: 'src' })).toBe('Grep foo')
})

test('an unknown tool shows its first string value, or its name alone', () => {
  expect(toolSummary('mcp__x__y', { n: 1, q: 'hello' })).toBe('mcp__x__y hello')
  expect(toolSummary('mcp__x__y', { n: 1 })).toBe('mcp__x__y')
})

test('inputText is the command for Bash and JSON for the rest', () => {
  expect(inputText({ command: 'ls' })).toBe('ls')
  expect(inputText({ a: 1 })).toBe('{\n  "a": 1\n}')
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/clip.ts`**

```ts
// The first `max` lines, then one line that gives how many lines are hidden.
export const clipLines = (text: string, max: number): string => {
  const lines = text.split('\n')
  if (lines.length <= max) return text
  const hidden = lines.length - max
  return [...lines.slice(0, max), `... ${hidden} more line${hidden === 1 ? '' : 's'}`].join('\n')
}

// One row of at most `columns` cells: whitespace runs become one space, the rest is cut.
export const cut = (text: string, columns: number): string => {
  if (columns <= 0) return ''
  const row = text.replace(/\s+/g, ' ').trim()
  return row.length <= columns ? row : `${row.slice(0, columns - 1)}…`
}
```

- [ ] **Step 4: Write `src/summary.ts`**

```ts
const KEYS = ['file_path', 'command', 'description', 'pattern', 'url', 'query', 'path'] as const

const oneRow = (v: string): string => v.replace(/\s+/g, ' ').trim()

// One line for a tool call: the tool name and the argument that identifies the call.
export const toolSummary = (tool: string, input: Record<string, unknown>): string => {
  for (const k of KEYS) {
    const v = input[k]
    if (typeof v === 'string' && v !== '') return `${tool} ${oneRow(v)}`
  }
  const first = Object.values(input).find((v): v is string => typeof v === 'string' && v !== '')
  return first === undefined ? tool : `${tool} ${oneRow(first)}`
}

// The input as the expanded tool call shows it.
export const inputText = (input: Record<string, unknown>): string =>
  typeof input.command === 'string' ? input.command : JSON.stringify(input, null, 2)
```

- [ ] **Step 5: Run the checks**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mods/flight-deck/src/clip.ts mods/flight-deck/src/clip.test.ts mods/flight-deck/src/summary.ts mods/flight-deck/src/summary.test.ts
git commit -m "feat(flight-deck): add text limits and tool summaries"
```

---

### Task 4: Transcript items

**Files:**
- Create: `src/transcript.ts`
- Test: `src/transcript.test.ts`

**Interfaces:**
- Consumes: `TranscriptItem` from `../types`.
- Produces: `transcriptItems(rows: readonly Row[]): TranscriptItem[]`, `MAX_ITEMS = 300`, `lastItems(items: TranscriptItem[]): { items: TranscriptItem[]; hidden: number }`.
- `Row` is the part of the engine's `SessionMessage` that this module reads. `SessionMessage` is assignable to it.

Facts from the probe (real data, do not change them):
- The answer of a run is the `message` field of the input of a `SubagentHandback` tool use.
- A tool result is a `user` row with `text: ''`. The same result text is on the `toolUses` entry as `text`.

- [ ] **Step 1: Write the failing test**

`src/transcript.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { lastItems, type Row, transcriptItems } from './transcript'

const use = (tool: string, input: Record<string, unknown>, extra: object = {}) => ({
  tool_use_id: `id-${tool}`,
  tool,
  input,
  ...extra,
})

// The rows the probe recorded for one agent that ran two times.
const TWO_RUNS: Row[] = [
  { role: 'user', text: 'Read README.md and reply with its first heading line only.', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [use('Read', { file_path: 'README.md' }, { text: '# claude-gadgets\n...' })] },
  { role: 'user', text: '', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [use('SubagentHandback', { message: '# claude-gadgets' }, { text: 'ok' })] },
  { role: 'user', text: '', toolUses: [] },
  { role: 'user', text: 'Follow-up: reply with the number of lines in README.md.', toolUses: [] },
  { role: 'assistant', text: 'Counting.', toolUses: [use('Bash', { command: 'wc -l README.md' }, { text: '52 README.md' })] },
  { role: 'user', text: '', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [use('SubagentHandback', { message: '52 lines.' }, { text: 'ok' })] },
  { role: 'user', text: '', toolUses: [] },
]

test('two runs give prompts, tools and answers in order', () => {
  expect(transcriptItems(TWO_RUNS)).toEqual([
    { kind: 'prompt', text: 'Read README.md and reply with its first heading line only.' },
    { kind: 'tool', id: 'id-Read', tool: 'Read', input: { file_path: 'README.md' }, result: '# claude-gadgets\n...', isError: false },
    { kind: 'answer', text: '# claude-gadgets' },
    { kind: 'prompt', text: 'Follow-up: reply with the number of lines in README.md.' },
    { kind: 'text', text: 'Counting.' },
    { kind: 'tool', id: 'id-Bash', tool: 'Bash', input: { command: 'wc -l README.md' }, result: '52 README.md', isError: false },
    { kind: 'answer', text: '52 lines.' },
  ])
})

test('a tool call in progress has no result', () => {
  const items = transcriptItems([{ role: 'assistant', text: '', toolUses: [use('Bash', { command: 'sleep 9' })] }])
  expect(items).toEqual([{ kind: 'tool', id: 'id-Bash', tool: 'Bash', input: { command: 'sleep 9' }, isError: false }])
})

test('an errored tool call is marked', () => {
  const items = transcriptItems([
    { role: 'assistant', text: '', toolUses: [use('Read', { file_path: 'x' }, { text: 'no such file', isError: true })] },
  ])
  expect(items[0]).toMatchObject({ kind: 'tool', isError: true, result: 'no such file' })
})

test('an Agent call keeps the id of its child', () => {
  const items = transcriptItems([
    { role: 'assistant', text: '', toolUses: [use('Agent', { description: 'd' }, { agentId: 'child1', text: 'done' })] },
  ])
  expect(items[0]).toMatchObject({ kind: 'tool', tool: 'Agent', agentId: 'child1' })
})

test('a handback without a message shows its input as JSON', () => {
  const items = transcriptItems([{ role: 'assistant', text: '', toolUses: [use('SubagentHandback', { other: 1 })] }])
  expect(items).toEqual([{ kind: 'answer', text: '{"other":1}' }])
})

test('lastItems keeps the newest 300 and counts the rest', () => {
  const many = Array.from({ length: 305 }, (_, i) => ({ kind: 'text' as const, text: String(i) }))
  const { items, hidden } = lastItems(many)
  expect(items).toHaveLength(300)
  expect(hidden).toBe(5)
  expect(items[0]).toEqual({ kind: 'text', text: '5' })
  expect(lastItems(many.slice(0, 3))).toEqual({ items: many.slice(0, 3), hidden: 0 })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL, `./transcript` not found.

- [ ] **Step 3: Write `src/transcript.ts`**

```ts
import type { TranscriptItem } from '../types'

// The part of the engine's SessionMessage that the pane reads.
export type Row = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly {
    tool_use_id: string
    tool: string
    input: Record<string, unknown>
    text?: string
    isError?: true
    agentId?: string
  }[]
}

// The tool a subagent ends a run with: its input holds the answer of the run.
const HANDBACK = 'SubagentHandback'

// A user row with text is a prompt (the task, or a later message to the agent); one without
// text holds only tool results, which the tool items already carry.
export const transcriptItems = (rows: readonly Row[]): TranscriptItem[] => {
  const items: TranscriptItem[] = []
  for (const row of rows) {
    if (row.text !== '') items.push({ kind: row.role === 'user' ? 'prompt' : 'text', text: row.text })
    for (const u of row.toolUses) {
      if (u.tool === HANDBACK) {
        const message = u.input.message
        items.push({
          kind: 'answer',
          text: typeof message === 'string' ? message : JSON.stringify(u.input),
        })
        continue
      }
      items.push({
        kind: 'tool',
        id: u.tool_use_id,
        tool: u.tool,
        input: u.input,
        ...(u.text === undefined ? {} : { result: u.text }),
        isError: u.isError === true,
        ...(u.agentId === undefined ? {} : { agentId: u.agentId }),
      })
    }
  }
  return items
}

export const MAX_ITEMS = 300

// The newest items the pane draws, and how many older ones it leaves out.
export const lastItems = (items: TranscriptItem[]): { items: TranscriptItem[]; hidden: number } =>
  items.length <= MAX_ITEMS
    ? { items, hidden: 0 }
    : { items: items.slice(-MAX_ITEMS), hidden: items.length - MAX_ITEMS }
```

- [ ] **Step 4: Run the checks**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mods/flight-deck/src/transcript.ts mods/flight-deck/src/transcript.test.ts
git commit -m "feat(flight-deck): turn agent messages into transcript items"
```

---

### Task 5: The band button

**Files:**
- Modify: `src/layout.ts` (the `Segment` type, `DROP_ORDER`, the `agents` part)
- Modify: `src/band.tsx`
- Modify: `hooks/register.test.ts` (the `bandText` helper only)
- Test: `src/layout.test.ts`

**Interfaces:**
- Produces: `Segment.isButton?: boolean` (true on the `agents` segment only). `Band` props gain `isPaneOpen: boolean` and `onToggle: () => void`. The button has `key="agents"`.

- [ ] **Step 1: Write the failing layout tests**

Add to `src/layout.test.ts` (use the helpers that the file already has to build the input, and read the file first):

```ts
test('agents is the last part the band drops', () => {
  // Wide enough for `◆ agents N` only.
  const segs = bandSegments({ snap: { ...emptySnapshot(), agents: 3 }, busySince: null, now: 0, ttl: '5m', columns: 12 })
  expect(segs.map((s) => s.text).join('')).toContain('◆ agents 3')
})

test('only the agents segment is the button', () => {
  const segs = bandSegments({ snap: { ...emptySnapshot(), agents: 3 }, busySince: null, now: 0, ttl: '5m', columns: 200 })
  expect(segs.filter((s) => s.isButton).map((s) => s.text)).toEqual(['◆ agents 3'])
})
```

If an existing test in `src/layout.test.ts` asserts the old drop order of `agents`, update that assertion to the new order and name it in the commit message.

- [ ] **Step 2: Run the tests and see them fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL on the two new tests.

- [ ] **Step 3: Change `src/layout.ts`**

- Add `isButton?: boolean` to `Segment`.
- Move `'agents'` to the end of `DROP_ORDER` (after `'in'`).
- Change the `agents` part to:

```ts
    agents: [{ text: `${LABEL.agents} ${snap.agents}`, color: PALETTE.orange, isButton: true }],
```

Note: `cache` is never dropped, so on a very narrow band `cache` and `agents` both stay. That is intended.

- [ ] **Step 4: Change `src/band.tsx`**

The root becomes a `Box` row: one `Text` for the segments before the button, the `Button`, one `Text` for the segments after it. With no button segment (agent view, or dropped), the root stays the single `Text` as it is now.

```tsx
type Props = {
  ui: Elements[keyof Elements]
  snap: Snapshot
  shown?: Counts
  busySince: number | null
  now: number
  ttl: '5m' | '1h'
  columns: number
  isAgentView?: boolean
  isPaneOpen: boolean
  onToggle: () => void
}

// A single inline row. With the agents button the row is a Box of three parts (text, button,
// text); without it, one Text with nested Texts, which cannot grow an extra row.
export const Band = ({ ui, snap, shown, busySince, now, ttl, columns, isAgentView, isPaneOpen, onToggle }: Props) => {
  const { Box, Text, Button } = ui
  const segments = bandSegments({ snap, shown, busySince, now, ttl, columns, isAgentView })
  const run = (segs: Segment[], key: string) => (
    <Text key={key} wrap="truncate">
      {segs.map((s, i) => (
        <Text key={String(i)} color={s.color} bold={s.bold} inverse={s.inverse} strikethrough={s.strike}>
          {s.text}
        </Text>
      ))}
    </Text>
  )
  const at = segments.findIndex((s) => s.isButton)
  const button = segments[at]
  if (button === undefined) return run(segments, 'all')
  return (
    <Box flexDirection="row">
      {run(segments.slice(0, at), 'before')}
      <Button key="agents" plain label={button.text} onPress={onToggle} />
      {run(segments.slice(at + 1), 'after')}
    </Box>
  )
}
```

Check `ButtonProps` in the typings for how to color a plain Button and how to draw it bold. Give it the segment color, and bold while `isPaneOpen`. If `ButtonProps` has no color or bold prop, keep the default look and mark the open state with the label `◆ agents N ▾` in `layout.ts` instead (pass `isPaneOpen` into `bandSegments`). Import `Segment` from `./layout`.

- [ ] **Step 5: Pass the new props from `hooks/register.tsx` (temporary)**

In the `AbovePrompt` hook, pass `isPaneOpen={false}` and `onToggle={() => {}}`. Task 7 replaces both.

- [ ] **Step 6: Update the `bandText` test helper**

The band root is no longer one `Text`. Change `bandText` in `hooks/register.test.ts` to join the text of the whole row. Check `Mounted` and `FoundElement` in the typings (`findAll`, the fields of a found element). The intended form:

```ts
  const parts = await ui.findAll({ key: /^(all|before|agents|after)$/ })
  await ui.unmount()
  return parts.map((p) => p.text ?? '').join('')
```

If `ElementQuery.key` takes no RegExp, call `ui.find({ key })` for the four keys in order and join the results. All existing band tests must pass with no other change.

- [ ] **Step 7: Run the checks**

Run: `bun run check`
Expected: PASS, all existing tests included.

- [ ] **Step 8: Commit**

```bash
git add mods/flight-deck/src/layout.ts mods/flight-deck/src/layout.test.ts mods/flight-deck/src/band.tsx mods/flight-deck/hooks/register.tsx mods/flight-deck/hooks/register.test.ts
git commit -m "feat(flight-deck): draw the agents count as a button"
```

---

### Task 6: Registry in the hooks module

**Files:**
- Modify: `hooks/register.tsx`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `spawned`, `ran`, `completed`, `merged`, `parseRegistry`, `agentsKey` (Task 1). `Agents` from `../types`.
- Produces: the atom `agents` (`{ plugin: 'flight-deck', key: 'agents' }`), the module-level functions `trackAgent($, change)` and `loadAgents($, id)`.

Tests observe the registry through the store (a session-id round trip) in this task. Task 7 adds the pane, and its tests observe the tree.

- [ ] **Step 1: Write the failing tests**

Add to `hooks/register.test.ts`. The test engine must answer `agent.list`: add `on('agent.list', () => ({ value: [] }))` to the `engine` helper. Check the result shape of `agent.list` in the typings (`OpValueOf['agent.list']` or the event result map) and use that shape. Read how `mock.store` exposes stored values (the existing persistence tests show it) and use the same way here.

```ts
test('the registry is stored for the session and follows the agent runs', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const store = mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await spawn($)                                   // -> a1
  await runStep($, { ...STEP, agentId: 'a1' })
  await $.turn.complete({ ...DONE, agentId: 'a1' } as never)
  await runStep($, { ...STEP, agentId: 'a1' })
  await $.turn.complete({ ...DONE, agentId: 'a1' } as never)

  // Read the stored value of 'agents:S1' the way the existing store tests read 'session:S1'.
  const saved = /* stored value of 'agents:S1' */ undefined as never as Record<string, { status: string; runs: number }>
  expect(saved.a1).toMatchObject({ status: 'idle', runs: 2 })
})

test('a step before the spawn result makes one entry', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))
  await runStep($, { ...STEP, agentId: 'a1' })
  await spawn($)                                   // -> a1
  // stored 'agents:S1' has exactly the key a1
})

test('a main-loop turn.complete adds no registry entry', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  await $.turn.complete(DONE as never)
  // stored 'agents:S1' is absent or {}
})
```

Replace each comment with the real read of the mock store before you run the tests. A test with a comment in place of an assertion is not complete.

- [ ] **Step 2: Run the tests and see them fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL, nothing is stored under `agents:S1`.

- [ ] **Step 3: Add the atom and the two functions**

In `hooks/register.tsx`, next to the other atoms:

```ts
const initialAgents: Agents = { sessionId: null, entries: {} }
const agents = atom({ plugin: 'flight-deck', key: 'agents' } as const, initialAgents)
```

Module-level functions (they receive `$`):

```ts
// The registry of the session `id`: the live atom, or the stored copy on a session change.
async function loadAgents($: Api, id: string): Promise<void> {
  const cur = await read($, agents)
  if (cur.sessionId === id) return
  const entries = parseRegistry(await $.store.get(agentsKey(id)))
  await update($, agents, (c) => (c.sessionId === id ? c : { sessionId: id, entries }))
}

// One registry change, then the engine's list merged in, then stored.
async function trackAgent($: Api, id: string, change: (r: Registry, at: number) => Registry): Promise<void> {
  await loadAgents($, id)
  const at = await $.clock.now()
  const list = await $.agent.list()
  const next = await update($, agents, (c) =>
    c.sessionId === id ? { ...c, entries: merged(change(c.entries, at), list, at) } : c,
  )
  if (next.sessionId === id) await $.store.set(agentsKey(id), next.entries)
}
```

`AgentInfo` from the typings must be assignable to `Listed`. If a field has another name (`parentAgentId`), map the list before `merged`.

- [ ] **Step 4: Call `trackAgent` from the events**

`id` below is the session id that each hook already gets from `ensureLoaded($)`.

- `agent.spawn`, after the existing update, when `agentId` is defined:

```ts
    await trackAgent($, id, (r, at) =>
      spawned(r, agentId, at, {
        parentId: e.parentAgentId,
        type: e.subagentType,
        description: e.description,
        name: e.name,
      }),
    )
```

`spawned` ignores `undefined` fields. With `exactOptionalPropertyTypes`, build the object without the absent keys.

- `turn.step` and `tool.call`, after the existing update, when `e.agentId !== undefined`:

```ts
    const agentId = e.agentId
    if (agentId !== undefined) await trackAgent($, id, (r, at) => ran(r, agentId, at))
```

- `turn.complete`: the hook now returns early for a subagent. Change the early return to:

```ts
    const agentId = e.agentId
    if (agentId !== undefined) {
      const id = await ensureLoaded($)
      await trackAgent($, id, (r, at) => completed(r, agentId, at))
      return next(e)
    }
```

- `save`: in the loop that deletes old sessions, also delete the registry:

```ts
  for (const old of drop) {
    await $.store.delete(storeKey(old))
    await $.store.delete(agentsKey(old))
  }
```

- [ ] **Step 5: Run the checks**

Run: `bun run check`
Expected: PASS. `validate` must list `$.agent.list (via trackAgent)`.

- [ ] **Step 6: Commit**

```bash
git add mods/flight-deck/hooks/register.tsx mods/flight-deck/hooks/register.test.ts
git commit -m "feat(flight-deck): keep a registry of the session's agents"
```

---

### Task 7: The pane, the command and the toggle

**Files:**
- Create: `src/pane.tsx`
- Modify: `hooks/register.tsx`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `treeRows` (Task 2), `clipLines`, `cut` (Task 3), `toolSummary`, `inputText` (Task 3), `transcriptItems`, `lastItems` (Task 4), the `agents` atom and `Band` props (Tasks 5 and 6).
- Produces: `PANE_ID = 'agents'`, the atom `pane`, the component `AgentPane`, the module-level functions `togglePane($)`, `openAgent($, agentId)`, `loadTranscript($, agentId)`, the command `/agent-log`.

Element keys (tests press these):

| Key | Element |
| --- | --- |
| `agents` | The band button. |
| `agent:<id>` | An agent row of the tree. |
| `back` | The back button of the transcript screen. |
| `tool:<tool_use_id>` | A tool call row. |
| `child:<tool_use_id>` | The button of an Agent call that opens the child agent. |

- [ ] **Step 1: Write the failing tests**

Add to `hooks/register.test.ts`. The test engine must also answer `ui.open`, `ui.close`, `command.register` and `session.messages`. Add to the `engine` helper (check each result shape in the typings):

```ts
  on('ui.open', () => ({ isPlaced: true }))
  on('ui.close', () => undefined)
  on('command.register', (_$, e) => ({ command: e.name }))
```

Helpers:

```ts
const ROWS = [
  { role: 'user', text: 'Count the lines.', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'wc -l README.md' }, text: '52 README.md' }] },
  { role: 'user', text: '', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't2', tool: 'SubagentHandback', input: { message: '52 lines.' }, text: 'ok' }] },
]

const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'flight-deck',
    surface,
    component: 'Pane',
    requestId: 'agents',
    props: { title: 'Agents', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never,
  })

const paneText = async (ui: Awaited<ReturnType<typeof mountPane>>) =>
  (await ui.findAll({ type: 'Text' })).map((t) => t.text ?? '').join('\n')
```

Check the `mount` argument for a Pane in the typings (how `requestId` is given) and adapt `mountPane`. Check whether `findAll({ type: 'Text' })` returns the text of `Markdown` and `Code` elements. If not, add a second query for them in `paneText`.

Tests, each in `for (const surface of ['terminal', 'desktop'] as const)`:

```ts
test('the tree lists a spawned agent, and a press shows its transcript', async ($, on) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    mock.clock(on, { now: 1000 })
    mock.store(on, {})
    engine(on)
    on('session.messages', () => ROWS as never)
    await spawn($)
    await $.turn.complete({ ...DONE, agentId: 'a1' } as never)

    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
    await ui.press({ key: 'agent:a1' })
    const text = await paneText(ui)
    expect(text).toContain('Count the lines.')
    expect(text).toContain('Bash wc -l README.md')
    expect(text).toContain('52 lines.')
    expect(text).not.toContain('52 README.md')

    await ui.press({ key: 'tool:t1' })
    expect(await paneText(ui)).toContain('52 README.md')
    await ui.press({ key: 'tool:t1' })
    expect(await paneText(ui)).not.toContain('52 README.md')

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
    await ui.unmount()
  }
})
```

Write these tests in the same style, each with real assertions:

- `an empty registry shows 'No agents yet.'`
- `a deny result shows the refusal text`: `on('session.messages', () => ({ deny: 'agent a1 is not readable' }) as never)`, press `agent:a1`, expect the pane text to contain `agent a1 is not readable`.
- `an agent with no messages shows 'No messages yet.'`: `session.messages` answers `[]`.
- `a second run shows in the title and the transcript is read again`: the `session.messages` hook returns `ROWS` first and `[...ROWS, { role: 'user', text: 'Again.', toolUses: [] }]` after a flag is set. Open `a1`, set the flag, raise `turn.complete` for `a1` again, expect the pane text to contain `Again.` and `2 runs`.
- `the band button opens the pane and a second press closes it`: record the calls with `on('ui.open', ...)` and `on('ui.close', ...)`. Mount `AbovePrompt` (as `bandText` does, without the unmount), press `{ key: 'agents' }` two times, expect one open with `{ id: 'agents' }` and then one close.
- `the command toggles the pane`: `await $.command.run({ command: 'agent-log' } as never)` two times, same expectation.
- `a close by the person resets the button`: open with the button, raise `$.ui.close({ id: 'agents', origin: { kind: 'person' } } as never)`, press the button again, expect a second `ui.open`.
- `a slow read of one agent does not replace the transcript of the next` (Review Focus 5): the `session.messages` hook for `a1` waits on a promise that the test resolves later, and answers at once for `a2`. Press `agent:a1`, press `back`, press `agent:a2`, resolve the promise, expect the pane text to contain the rows of `a2` only. If `ui.press` does not resolve until the handler settles (the typings say every act waits for the handler), test `loadTranscript` through two `turn.complete` events instead: open `a2`, then raise a `tool.call` for `a1`, and expect the transcript of `a2` to stay.
- `a session change shows the registry of the new session`: spawn in `S1`, switch the id to `S2`, raise a `turn.start`, mount the pane, expect `No agents yet.`. Switch back to `S1`, raise a `turn.start`, expect `agent:a1`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `claude plugin test mods/flight-deck`
Expected: FAIL, no hook draws the `Pane`.

- [ ] **Step 3: Write `src/pane.tsx`**

```tsx
import type { Elements } from 'claude-code'
import type { AgentEntry, PaneView, Registry, TranscriptItem } from '../types'
import { clipLines, cut } from './clip'
import { PALETTE } from './palette'
import { inputText, toolSummary } from './summary'
import { lastItems } from './transcript'
import { treeRows } from './tree'

type Props = {
  ui: Elements[keyof Elements]
  entries: Registry
  view: PaneView
  columns: number
  onOpen: (agentId: string) => void
  onBack: () => void
  onTool: (toolUseId: string) => void
}

const MAX_LINES = 40
// Single-width marks: a running agent, an idle one.
const MARK = { running: '●', idle: '○' } as const

const runs = (n: number): string => `${n} run${n === 1 ? '' : 's'}`

const title = (a: AgentEntry): string =>
  [a.type ?? 'agent', a.description ?? a.name ?? a.id, runs(a.runs)].join(' · ')

export const AgentPane = ({ ui, entries, view, columns, onOpen, onBack, onTool }: Props) => {
  const { Box, Text, Button, Code, Markdown } = ui

  if (view.agentId === null) {
    const rows = treeRows(entries)
    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>No agents yet.</Text>}
        {rows.map(({ agent, depth }) => {
          const indent = '  '.repeat(depth)
          const label = cut(`${indent}${MARK[agent.status]} ${title(agent)}`, columns)
          return <Button key={`agent:${agent.id}`} plain label={label} onPress={() => onOpen(agent.id)} />
        })}
      </Box>
    )
  }

  const agent = entries[view.agentId]
  const shown = view.transcript?.agentId === view.agentId ? view.transcript : null
  const item = (it: TranscriptItem, i: number) => {
    if (it.kind === 'prompt')
      return (
        <Text key={String(i)} color={PALETTE.cyan} wrap="truncate">
          {cut(`> ${it.text}`, columns)}
        </Text>
      )
    if (it.kind === 'text') return <Markdown key={String(i)} text={it.text} />
    if (it.kind === 'answer') return <Markdown key={String(i)} text={it.text} />
    const isOpen = view.expanded.includes(it.id)
    const mark = it.result === undefined ? '…' : it.isError ? '✗' : '✓'
    return (
      <Box key={String(i)} flexDirection="column">
        <Box flexDirection="row">
          <Button
            key={`tool:${it.id}`}
            plain
            label={cut(`${isOpen ? '▾' : '▸'} ${mark} ${toolSummary(it.tool, it.input)}`, columns - (it.agentId === undefined ? 0 : 8))}
            onPress={() => onTool(it.id)}
          />
          {it.agentId !== undefined && (
            <Button key={`child:${it.id}`} plain label=" [open]" onPress={() => onOpen(it.agentId as string)} />
          )}
        </Box>
        {isOpen && <Code source={clipLines(inputText(it.input), MAX_LINES)} />}
        {isOpen && it.result !== undefined && <Code source={clipLines(it.result, MAX_LINES)} />}
      </Box>
    )
  }

  const body = () => {
    if (shown === null) return <Text dimColor>Loading...</Text>
    if ('deny' in shown) return <Text color={PALETTE.red}>{shown.deny}</Text>
    if (shown.items.length === 0) return <Text dimColor>No messages yet.</Text>
    const { items, hidden } = lastItems(shown.items)
    return (
      <Box flexDirection="column">
        {hidden > 0 && <Text dimColor>{`... ${hidden} older items hidden`}</Text>}
        {items.map(item)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Button key="back" plain label="< agents" onPress={onBack} />
      <Text bold wrap="truncate">
        {cut(agent === undefined ? view.agentId : `${MARK[agent.status]} ${title(agent)}`, columns)}
      </Text>
      {body()}
    </Box>
  )
}
```

Check each element's props in the typings (`MarkdownProps.text`, `CodeProps.source`, `TextProps.wrap`, `ButtonProps`). The `answer` item and the `text` item are both `Markdown`: draw the `answer` after a dim `Text` line `answer:` so the user can tell them apart. Replace the `as string` cast with a narrowed constant.

- [ ] **Step 4: Add the pane state and functions to `hooks/register.tsx`**

```ts
const PANE_ID = 'agents'
const initialPane: PaneView = { isOpen: false, agentId: null, expanded: [], transcript: null }
const pane = atom({ plugin: 'flight-deck', key: 'pane' } as const, initialPane)
```

Module-level functions:

```ts
// Reads one agent's transcript into the pane. A result for an agent that is no longer on
// the transcript screen is discarded.
async function loadTranscript($: Api, agentId: string): Promise<void> {
  const rows = await $.session.messages({ agentId })
  const transcript: Transcript = Array.isArray(rows)
    ? { agentId, items: transcriptItems(rows) }
    : { agentId, deny: rows.deny }
  await update($, pane, (c) => (c.agentId === agentId ? { ...c, transcript } : c))
}

async function openAgent($: Api, agentId: string): Promise<void> {
  await update($, pane, (c) => ({ ...c, agentId, expanded: [], transcript: null }))
  await loadTranscript($, agentId)
}

async function togglePane($: Api): Promise<void> {
  const cur = await read($, pane)
  if (cur.isOpen) {
    await update($, pane, (c) => ({ ...c, isOpen: false }))
    await $.ui.close({ id: PANE_ID })
    return
  }
  await update($, pane, (c) => ({ ...c, isOpen: true }))
  await $.ui.open({ id: PANE_ID, title: 'Agents' })
}

// The agent on the transcript screen had an event: read its transcript again.
async function refreshViewed($: Api, agentId: string | undefined): Promise<void> {
  if (agentId === undefined) return
  const cur = await read($, pane)
  if (cur.isOpen && cur.agentId === agentId) await loadTranscript($, agentId)
}
```

`SessionMessage[]` must be assignable to `readonly Row[]`. If it is not, map the rows to `Row` in `loadTranscript`.

- [ ] **Step 5: Add the hooks in `register`**

- In `session.start`, before `return next(e)`:

```ts
    await $.command.register({ name: 'agent-log', description: 'Show or hide the agents of this session' })
```

- New hooks:

```ts
  on('command.run', { command: 'agent-log' }, async ($) => {
    await togglePane($)
    return { text: (await read($, pane)).isOpen ? 'Agents pane opened.' : 'Agents pane closed.' }
  })

  // The person can close the pane with the engine's mark: keep the button's state true.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID) await update($, pane, (c) => ({ ...c, isOpen: false }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const id = await $.session.id()
    const reg = await read($, agents)
    return (
      <AgentPane
        ui={$.ui.resolve(e)}
        entries={reg.sessionId === id ? reg.entries : {}}
        view={await read($, pane)}
        columns={e.props.bodyColumns}
        onOpen={(agentId) => openAgent($, agentId)}
        onBack={() => update($, pane, (c) => ({ ...c, agentId: null, expanded: [], transcript: null }))}
        onTool={(toolUseId) =>
          update($, pane, (c) => ({
            ...c,
            expanded: c.expanded.includes(toolUseId)
              ? c.expanded.filter((x) => x !== toolUseId)
              : [...c.expanded, toolUseId],
          }))
        }
      />
    )
  })
```

Check in the typings whether the `ui.close` matcher takes `{ id }`, and use the matcher in place of the `if` when it does. The reference says a handler closure may call `update`. If `validate` refuses `openAgent($, ...)` or `update($, ...)` in a closure inside `register`, read the refusal: the rule is that a function that receives `$` as a parameter is a module-level declaration, and these closures only capture the hook's own `$`.

- In the `AbovePrompt` hook, replace the two temporary props of Task 5:

```tsx
        isPaneOpen={(await read($, pane)).isOpen}
        onToggle={() => togglePane($)}
```

Read the pane atom into a constant before the JSX.

- In `tool.call` and `turn.complete` (subagent branch), after `trackAgent`: `await refreshViewed($, agentId)`.

- A session change must not leave the transcript of another session on the screen. In `loadAgents`, when the session id changes, also reset the view:

```ts
  await update($, pane, (c) => ({ ...c, agentId: null, expanded: [], transcript: null }))
```

- [ ] **Step 6: Run the checks**

Run: `bun run check`
Expected: PASS, all tests on both surfaces.

- [ ] **Step 7: Commit**

```bash
git add mods/flight-deck/src/pane.tsx mods/flight-deck/hooks/register.tsx mods/flight-deck/hooks/register.test.ts
git commit -m "feat(flight-deck): add the agents pane and its toggle"
```

---

### Task 8: Docs and final check

**Files:**
- Modify: `.claude-plugin/plugin.json` (the `description`)
- Modify: `README.md` (repo root)

- [ ] **Step 1: Update the manifest description**

```json
  "description": "Band tracking session tokens, tool calls, model working time and cache countdown, with a pane that shows each subagent's transcript",
```

- [ ] **Step 2: Update `README.md`**

Read the `flight-deck` section of `README.md`. Add a subsection `Agents pane` in the same style, in ASD-STE100 English (short sentences, active voice, no semicolons). It must say:

- Press `◆ agents N` on the band, or run `/agent-log`, to open and close the pane.
- The pane lists the subagents of the session as a tree. A child agent is below its parent.
- Press an agent to see its transcript. Press a tool call to see its input and its result.
- The pane shows an agent after it completes, after a new message starts it again, and after `--resume`.
- Limits: an agent that started before the mod loaded is not in the list. The engine does not let a mod read the agents of a workflow run or a teammate in its own terminal pane.

Run the linter and fix each hard violation in the text you added:

```bash
python3 /Users/bez/.claude/skills/asd-ste100/scripts/ste-lint.py README.md
```

- [ ] **Step 3: Run the full check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mods/flight-deck/.claude-plugin/plugin.json README.md
git commit -m "docs(flight-deck): describe the agents pane"
```

- [ ] **Step 5: Report**

Report: the commits, the output of the last `bun run check`, each place where the code differs from this plan and why, and each item you could not verify. Do not do the live checks below: the user does them.

---

## Live verification (the user, after Task 8)

1. `claude --plugin-dir mods/flight-deck` in a terminal. The band is on one row and `◆ agents N` is in it.
2. Start a subagent and let it complete. Press `◆ agents N` (click, or ctrl+x tab then Enter). Open the transcript of the subagent.
3. Send a message to the completed subagent. The pane shows both runs.
4. Resume the session with `--resume`. The tree and the transcript are available.
5. Do steps 1 to 4 on Claude Desktop.

If the band is not on one row on a surface, the fallback in the spec applies: a separate button at the end of the band.
