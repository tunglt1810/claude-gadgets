# flight-deck 0.10.0: Flight Deck button, tool counts, Claude Code 2.1.299 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the agent count into the text of the band, name the pane button "Flight Deck", count the calls of each tool on a new pane screen, and make the mod correct on Claude Code 2.1.299.

**Architecture:** The band gets a new metric part `agents` and a button part `deck`. The meter gets a map `byTool` (tool name to calls). The pane gets a `tools` row and a `tools` screen, with the same pattern as the `cache` row and the `cache` screen. The `turn.start` hook ignores the turns of a subagent.

**Tech Stack:** Bun 1.4.2, TypeScript, the Claude Code mod API (typings of 2.1.299), `claude-code/testing`.

**Spec:** None. The design was agreed in chat on 2026-10-14 (choice A for the band; counts only, no cost per tool).

## Global Constraints

- No emoji in drawn text. Single-width characters only.
- Colors come from `PALETTE` only.
- The band stays one row. Parts drop in `DROP_ORDER`.
- A Claude Desktop runs Claude Code 2.1.295. A prop or element that 2.1.295 does not know makes the pane empty there.
- TDD: a failing test first.
- `bun run check` is green before "done".
- Changelog entries are one short sentence each.

## Decisions

1. **Band (choice A).** The text gets `◆ agents N` (orange) in the group of `⌘ calls` and `◇ bg`. The button is `▸ Flight Deck` (closed) or `▾ Flight Deck` (open). It has no count.
2. **Tool counts, no cost.** The engine gives a cost per step and per model, not per tool call. The mod counts only.
3. **`bold` stays.** 2.1.299 deprecates `bold` for `weight`. 2.1.299 still reads `bold: true` as `weight: 'semibold'`. The desktop engine (2.1.295) does not know `weight`. Thus a change to `weight` needs a version check in 12 places and gives nothing now. Do it when the desktop engine is 2.1.299 or later.
4. **`turn.start` of a subagent.** 2.1.299 raises `turn.start` for a subagent too (`e.agentId` set). Without a fix, a background subagent that starts a turn while the main loop is idle opens the work interval of the main loop. Its `turn.complete` (with `agentId`) does not close it. The work clock then runs without end. The fix: the hook returns `next(e)` when `e.agentId` is set.
5. **Test trees with `part: { plugin }`, and the ten-second limit.** No test asserts an exact root tree. No change.

## Review Focus

1. A session record of 0.9.0 has `tools > 0` and no `byTool`. The tools screen must say how many calls it cannot list, and not show a wrong total. (Task 3 test.)
2. A narrow band (30 columns): the `Flight Deck` button stays, the `◆ agents` part drops before `⌘ calls`. (Task 2 test.)
3. An MCP tool name is long (`mcp__claude_ai_Google_Drive__search_files`). The row cuts it and keeps the count column. (Task 3 test, 20 columns.)
4. A subagent `turn.start` during an open main turn must not change the main work time. (Task 1 test.)
5. A hot reload keeps live state of the old shape (no `byTool`). `isComplete` must reject it so the meter reloads. (Task 3 test.)

---

### Task 1: `turn.start` ignores a subagent's turn

**Files:**
- Modify: `mods/flight-deck/hooks/register.tsx` (the `turn.start` hook)
- Test: `mods/flight-deck/hooks/register.test.ts`

- [ ] **Step 1: Write the failing test** (after the test `a subagent turn.complete does not close the main ◷ interval`)

```ts
test('a subagent turn.start does not open the main ◷ interval', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  await $.turn.start({ text: 'p', turnId: 'sub-turn', agentId: 'sub1' })
  await clock.advance(4000)
  await $.turn.complete({ ...DONE, turnId: 'sub-turn', agentId: 'sub1' })
  await clock.advance(60_000)

  expect(await settled($, clock)).toContain('◷ work 0:00')
})
```

- [ ] **Step 2:** `bun test mods/flight-deck/hooks/register.test.ts -t "subagent turn.start"`. Expected: FAIL (the work is `1:04` or more).
- [ ] **Step 3: Implement.** First line of the hook:

```ts
    // A subagent's turn (Claude Code 2.1.299 raises it too) is not a turn of the main loop.
    if (e.agentId !== undefined) return next(e)
```

- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Commit `fix(flight-deck): a subagent's turn.start does not start the main work clock`.

### Task 2: Band: `◆ agents N` in the text, `Flight Deck` button

**Files:**
- Modify: `mods/flight-deck/src/layout.ts` (`DROP_ORDER`, `GROUPS`, `SESSION_ONLY`, `partsFor`, `build`, `Segment.isButton` comment)
- Modify: `mods/flight-deck/src/band.tsx`, `mods/flight-deck/src/bandClient.tsx` (comments only)
- Test: `mods/flight-deck/src/layout.test.ts`, `mods/flight-deck/src/bandClient.test.ts`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- Produces: part `agents` = `{ text: '◆ agents N', color: PALETTE.orange }`. Part `deck` = `{ text: '▸ Flight Deck' | '▾ Flight Deck', color: PALETTE.orange, isButton: true }`.
- `GROUPS[3]` = `['tools', 'agents', 'bg', 'work']`.
- `DROP_ORDER` = `break, bg, agents, diff, hit, tools, work, cost, out, in, ctx, deck`.
- `SESSION_ONLY` = `cost, work, agents, bg, deck` (an agent view has no button, as before).

- [ ] **Step 1: Update the tests first.** In `layout.test.ts` change each `▸ agents 2` button text to `▸ Flight Deck`, and expect `◆ agents 2` in the text. Add:

```ts
test('the agent count is in the text and the button names the pane', () => {
  const segs = bandSegments({ ...BASE, snap: { ...BASE.snap, agents: 2 }, columns: 200 })
  const plain = segs.filter((s) => !s.isButton).map((s) => s.text).join('')
  expect(plain).toContain('⌘ calls 0  ◆ agents 2  ◇ bg 0')
  expect(segs.filter((s) => s.isButton).map((s) => s.text)).toEqual(['▸ Flight Deck'])
})

test('a narrow band drops the agent count before the calls, and keeps the button', () => {
  const segs = bandSegments({ ...BASE, snap: { ...BASE.snap, agents: 2 }, columns: 40 })
  const all = segs.map((s) => s.text).join('')
  expect(all).toContain('▸ Flight Deck')
  expect(all).not.toContain('◆ agents')
})
```

(`BASE` is the input the file already uses; use its name.) In `register.test.ts` change `/▸ agents N$/` to `/◆ agents N .*▸ Flight Deck$/` and keep the count assertion.

- [ ] **Step 2:** `bun test mods/flight-deck/src/layout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `layout.ts`:

```ts
  agents: [{ text: `◆ agents ${snap.agents}`, color: PALETTE.orange }],
  deck: [
    {
      // The icon is the pane's disclosure mark: closed or open.
      text: `${isPaneOpen ? '▾' : '▸'} Flight Deck`,
      color: PALETTE.orange,
      isButton: true,
    },
  ],
```

and in `build`: `if (!dropped.has('deck')) segs.push({ text: '  ' }, ...parts.deck)`.

- [ ] **Step 4:** `bun run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-deck): the band counts agents in its text and its button opens the Flight Deck`.

### Task 3: Calls per tool, on a `tools` screen

**Files:**
- Modify: `mods/flight-deck/types/index.d.ts` (`Snapshot.byTool`, `ToolsView`, `PaneData.tools`, `PaneView.isTools`, `PaneAction` `{ kind: 'tools' }`)
- Modify: `mods/flight-deck/src/snapshot.ts` (`emptySnapshot`, `parseSnapshot`, `isComplete`)
- Create: `mods/flight-deck/src/tools.ts` (`toolsView`, `toolsHead`)
- Create: `mods/flight-deck/src/tools.test.ts`
- Modify: `mods/flight-deck/src/paneData.ts`, `mods/flight-deck/src/action.ts`, `mods/flight-deck/src/pane.tsx`, `mods/flight-deck/hooks/register.tsx`
- Test: `mods/flight-deck/src/snapshot.test.ts`, `mods/flight-deck/hooks/register.test.ts`

**Interfaces:**
- `Snapshot.byTool: Record<string, number>`: the calls of each tool, every loop.
- `type ToolsView = { total: number; rows: { name: string; calls: number }[] }`. `total` is `Snapshot.tools`. The rows are sorted by calls (most first), then by name.
- `toolsView(s: Pick<Snapshot, 'tools' | 'byTool'>): ToolsView`
- `toolsHead(v: ToolsView): Cell`: `no call` (dim) or `N calls · K tools` (orange).
- `PaneData.tools: ToolsView | null` (null on a transcript screen).
- `PaneView.isTools: boolean`. Action `{ kind: 'tools' }`, focus key `tools`.

- [ ] **Step 1: Write the failing unit tests** (`src/tools.test.ts`):

```ts
import { expect, test } from 'claude-code/testing'
import { toolsHead, toolsView } from './tools'

test('toolsView sorts the tools by calls, then by name', () => {
  expect(toolsView({ tools: 6, byTool: { Read: 2, Bash: 3, Edit: 1 } }).rows).toEqual([
    { name: 'Bash', calls: 3 },
    { name: 'Read', calls: 2 },
    { name: 'Edit', calls: 1 },
  ])
  expect(toolsView({ tools: 2, byTool: { b: 1, a: 1 } }).rows.map((r) => r.name)).toEqual(['a', 'b'])
})

test('toolsHead counts the calls and the tools', () => {
  expect(toolsHead(toolsView({ tools: 0, byTool: {} })).text).toBe('no call')
  expect(toolsHead(toolsView({ tools: 1, byTool: { Bash: 1 } })).text).toBe('1 call · 1 tool')
  expect(toolsHead(toolsView({ tools: 5, byTool: { Bash: 3, Read: 2 } })).text).toBe(
    '5 calls · 2 tools',
  )
})
```

In `snapshot.test.ts`: a record with `tools: 4` and no `byTool` parses to `byTool: {}`; a state without `byTool` is not `isComplete`.

- [ ] **Step 2:** Run them. Expected: FAIL (no module `./tools`).
- [ ] **Step 3: Implement** `src/tools.ts`, the snapshot fields, and `byTool: { ...c.byTool, [e.tool]: (c.byTool[e.tool] ?? 0) + 1 }` in the `tool.call` hook.
- [ ] **Step 4: Write the failing pane test** (`register.test.ts`, on both surfaces):

```ts
test('the agents screen shows the tools row, and the tools screen counts each tool', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await cellOf(ui, 'tools:head')).toContain('3 calls · 2 tools')
    await ui.press({ key: 'tools' })
    expect(await cellOf(ui, 'tools:name:0')).toContain('Bash')
    expect(await cellOf(ui, 'tools:calls:0')).toContain('2')
    expect(await cellOf(ui, 'tools:name:1')).toContain('Read')
    expect(await paneText(ui)).not.toContain('No agents yet.')
    await ui.press({ key: 'back' })
    expect(await paneText(ui)).toContain('No agents yet.')
    await ui.unmount()
  }
})
```

Also: a 0.9.0 record (`tools: 4`, no `byTool`) gives the cell `tools:hidden` with `4 earlier calls not listed`; a 20-column pane has no negative width.

- [ ] **Step 5: Implement** the pane: `toolsRow()` after `cacheRow()` (button `tools`, cell `tools:head`, a rule), and `toolsScreen()` with the toolbar (`← agents`, title `tools`), the head cell, the hidden cell, the head row (`tool`, `calls`, `calls(%)`) and one row per tool. The share uses `sharePct` and `shareColor` from `dashboard.ts`. Wire `isTools`, `openTools`, `closeTools`, the `back` branch, the `tools` action and the `tools` focus key as for `cache`.
- [ ] **Step 6:** `bun run check`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(flight-deck): a tools screen counts the calls of each tool`.

### Task 4: Docs, version, compatibility

**Files:**
- Modify: `CLAUDE.md` (compatibility: 2.1.299; the `turn.start` rule; the `bold` note)
- Modify: `mods/flight-deck/README.md`, `README.md`, `docs/i18n/README.vi.md` (the button name, the tools screen)
- Modify: `docs/design-system.md` (the agents part, the deck button, the tools screen)
- Modify: `CHANGELOG.md`, `mods/flight-deck/.claude-plugin/plugin.json` (0.10.0)

- [ ] **Step 1:** Edit the files.
- [ ] **Step 2:** `bun run check`. Expected: PASS.
- [ ] **Step 3:** Commit `docs(flight-deck): 0.10.0 on Claude Code 2.1.299`.
