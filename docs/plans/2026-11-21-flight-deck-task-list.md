# flight-deck task history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep each task list of the session as a group, and show the groups in a tasks screen of the flight-deck pane.

**Architecture:** A pure module `src/tasks.ts` applies the `TaskCreate`, `TaskUpdate` and `TaskList` calls to a `TaskGroup[]` history. The hooks module applies each `tool.call` result to a `tasks` atom and keeps the last user prompt. It stores the history per session ID. On a session-ID mismatch with no stored history, it replays the session messages. `AgentPane` draws a `tasks` row on the dashboard and a tasks screen.

**Tech Stack:** TypeScript, Bun, Claude Code plugin API (`claude-code/testing`).

**Spec:** `docs/specs/2026-11-21-flight-deck-task-list-design.md`

## Global Constraints

- Every path is under `mods/flight-deck/` unless it starts with `docs/`, `CHANGELOG.md`, `CLAUDE.md` or `README.md`.
- `bun run check` is green at the end of each task.
- TDD: write the failing test first and watch it fail.
- Drawn text: single-width glyphs only. `✓` completed, `◐` in progress, `○` pending, `▾` open group, `▸` closed group, `—` no time.
- No band change.
- Version `0.14.0`. Changelog: "The pane has a tasks screen that keeps each task list of the session, with its times."
- Read each field of a task result with a type check. An unknown shape changes nothing.

## Review Focus

1. Several `TaskCreate` calls in one batch: each task keeps the ID from its own result, and all go into one group (Task 1, Task 2).
2. A `TaskCreate` after all tasks of the current group are `completed`: a new group starts, and the old group keeps its tasks (Task 1).
3. A replayed task has no times, and the screen shows `—`, not `NaN` or `0s` (Task 1, Task 3).
4. A long prompt or subject in a group row: the row stays one row (Task 3).
5. The desktop pane does not redraw each second while a task runs (Task 3: a desktop test counts the pane draws).

---

### Task 1: History model

**Files:**
- Create: `src/tasks.ts`, `src/tasks.test.ts`
- Change: `types/index.d.ts` (add `TaskStatus`, `Task`, `TaskGroup` as in the spec, section Model)

**Interfaces:**
- Produces:
  - `applyCall(groups: TaskGroup[], call: { tool: string; input: Record<string, unknown>; result: unknown; text?: string }, now: number | null, prompt: string): TaskGroup[]`. Returns `groups` (same reference) for another tool or an unknown shape.
  - `replay(messages: SessionMessageLike[]): TaskGroup[]`, where `SessionMessageLike = { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; input: Record<string, unknown>; result?: unknown; text?: string; isError?: boolean }[] }`. `now` is `null` for each call.
  - `parseHistory(raw: unknown): TaskGroup[]` (`[]` on a bad shape)
  - `tasksKey(sessionId: string): string`, which returns `` `tasks:${sessionId}` ``
  - `firstLine(text: string): string`
  - `isStopped(groups: TaskGroup[], index: number): boolean` (true when every task is `completed` or `index` is not the last group)
  - `isOpen(groups: TaskGroup[], index: number, toggled: number[]): boolean` (the default is `!isStopped`. An index in `toggled` flips it.)
  - `groupTimes(g: TaskGroup): { from: number | null; to: number | null }` (`from`: the first `startedAt`, else `createdAt`. `to`: the last `endedAt` when every task is `completed`, else `null`.)

- [ ] **Step 1: Write the failing tests** in `src/tasks.test.ts`:
  - The first `TaskCreate` (result `{ task: { id: '1', subject: 'A' } }`, input `description: 'dA'`, `now: 100`, prompt `'p1'`) gives `[{ prompt: 'p1', createdAt: 100, tasks: [{ id: '1', subject: 'A', description: 'dA', status: 'pending', startedAt: null, endedAt: null }] }]`.
  - Creates with IDs `'2'` then `'1'` give tasks in ID order. The sort is numeric: `'10'` is after `'9'`.
  - `TaskUpdate { taskId: '1', status: 'in_progress' }` at `now: 200` sets `startedAt: 200`. A second change to `in_progress` at `300` keeps `200`. `completed` at `400` sets `endedAt: 400`.
  - `TaskUpdate` with `subject` or `description` changes them. `status: 'deleted'` removes the task.
  - `TaskUpdate` for an unknown ID, or with `success: false`: the same reference.
  - A `TaskCreate` when the last group has all tasks `completed`, with prompt `'p2'`: a second group with prompt `'p2'`. The first group does not change.
  - `TaskList` result `{ tasks: [{ id: '1', subject: 'A2', status: 'completed', blockedBy: [] }, { id: '5', subject: 'E', status: 'pending', blockedBy: [] }] }` against a group with tasks `1` and `2`: task `1` becomes `A2 completed` and keeps its description and times. Task `2` goes out of the group. Task `5` comes in.
  - Unknown shapes (`null`, `'x'`, `{ task: {} }`): the same reference.
  - `replay`: user message `'fix nav\nmore'`, then an assistant use `TaskCreate` with no `result` and `text: 'Task #4 created successfully: Foo'`. Result: one group with prompt `'fix nav'` and task `4` `Foo` with `startedAt: null`. `replay` skips a use with `isError: true`.
  - `isOpen`: it gives `true` for the last group when it is not stopped, and `false` with its index in `toggled`. It gives `false` for a stopped group, and `true` with its index in `toggled`.
  - `groupTimes`: a group with no times gives `{ from: createdAt, to: null }`.

- [ ] **Step 2: Run** `bun test mods/flight-deck/src/tasks.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement `src/tasks.ts`.**

- [ ] **Step 4: Run** `bun test mods/flight-deck/src/tasks.test.ts`. Expected: PASS. Then run `bun run check`.

- [ ] **Step 5: Commit** `flight-deck: a task history model`.

### Task 2: Capture, prompt, store and replay

**Files:**
- Change: `hooks/register.tsx` (the `tasks` atom, the `tool.call` hook at line 1444, the `prompt.submit` hook at line 1645, a new `ensureTasks`, the prune at line 266)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `applyCall`, `replay`, `parseHistory`, `tasksKey`, `firstLine` (Task 1).
- Produces:
  - `const tasks = atom({ plugin: 'flight-deck', key: 'tasks' } as const, { sessionId: null as string | null, groups: [] as TaskGroup[], prompt: '' })`
  - `async function ensureTasks($: Api): Promise<void>`. On a session-ID mismatch, it loads `$.store.get(tasksKey(id))` as `{ groups, prompt }`. With no stored value, it uses `replay(await $.session.messages())`. A `{ deny }` gives no groups.

- [ ] **Step 1: Write the failing tests.** Extend `toolResult` in the test engine:
  - `TaskCreate` answers `{ result: { task: { id: String(++taskSeq), subject: e.subject } }, text: '' }`.
  - `TaskUpdate` answers `{ result: { success: true, taskId: e.taskId }, text: '' }`.

  Reset `taskSeq` in `engine`. Add an `on('session.messages', ...)` answer from a per-test `history` array. This task has no UI: observe the history in the object that the test passes to `mock.store` (key `tasks:<id>`). If the mock copies that object, read it back with a reload under the same session ID. Tests:
  - Submit the prompt `'fix nav\nmore'`. Then make three `TaskCreate` calls with `Promise.all`, and a `TaskUpdate` of `'2'` to `in_progress`. The stored value has one group with prompt `'fix nav'` and three tasks. The `startedAt` of task `2` is the time of the mock clock.
  - A prompt from a task notification does not change the stored prompt.
  - A call from a subagent (`agentId: 'a1'`) changes the same history.
  - A call that a `tool.check` hook of the test denies adds nothing.
  - Session `S1` has a group. Switch to `S2` (no store, empty history) and make a `TaskCreate` call. `tasks:S2` has one group, and `tasks:S1` keeps its group.
  - Replay: session `S3` with no store, and `history` with a user message `'x'` and a `TaskCreate` use with `text: 'Task #1 created successfully: X'`. A `TaskCreate` call in `S3` adds the task to that group: the stored value has one group with two tasks.
  - Prune: after `MAX_SESSIONS + 1` sessions, the oldest `tasks:` key is gone.

- [ ] **Step 2: Run** `bun test mods/flight-deck/hooks`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `prompt.submit`: for a prompt that the user typed (find the `e.origin.kind` value in the typings), call `ensureTasks`, then set `prompt: firstLine(e.text)`.
  - `tool.call`: after the `res.deny` check, for the three task tools and `!res.isError`, call `ensureTasks`. Then `update($, tasks, c => ({ ...c, groups: applyCall(c.groups, { tool: e.tool, input: e as never, result: res.result, text: res.text }, now, c.prompt) }))`, with `now` from `stamp($)`.
  - Write `tasksKey(id)` only when the JSON changed.
  - Remove `tasksKey(old)` beside `agentsKey(old)` in the prune.

- [ ] **Step 4: Run** `bun run check`. Expected: PASS.

- [ ] **Step 5: Live check.** Run `claude --plugin-dir mods/flight-deck` and ask for a 3-step task list. Read the store file `~/.claude/plugins/store/flight-deck_*.json`. Record the `TaskCreate` calls of a subagent with the debug log of CLAUDE.md. If the IDs of a subagent start again at `1`, stop and report.

- [ ] **Step 6: Commit** `flight-deck: keep the task history of the session`.

### Task 3: Tasks screen

**Files:**
- Change: `src/pane.tsx` (props `tasks: TaskGroup[]`, `onTasks`, `onGroup(index)`. `tasksRow` after `toolsRow`. `tasksScreen`. A branch beside `view.isTools`.)
- Change: `src/action.ts` (`'tasks'` in the key list at line 10. Key `group:<index>` gives `{ kind: 'group', index }`.)
- Change: `types/index.d.ts` (`PaneView.isTasks?: boolean`, `PaneView.openGroups?: number[]`, `PaneAction` `{ kind: 'tasks' }` and `{ kind: 'group'; index: number }`)
- Change: `hooks/register.tsx`:
  - `initialPane`, and `openTasks` and `closeTasks` as `openTools` and `closeTools`.
  - The `back` chain at line 868, and the two new actions.
  - `ensureTasks` before the pane draws.
  - The `startSpinner` busy check at line 963: it is also true while the tasks screen is open and a task is `in_progress`.
- Test: `src/action.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: `isOpen`, `groupTimes` (Task 1). `ensureTasks`, the `tasks` atom (Task 2).
- Produces: `async function openTasks($: Api)` (focus on `'back'`), `closeTasks` (focus on `'tasks'`), `toggleGroup($: Api, index: number)` (toggles `index` in `openGroups`).

- [ ] **Step 1: Write the failing tests:**
  - `src/action.test.ts`: `focusAction('tasks', null)` is `{ kind: 'tasks' }`. `focusAction('group:2', null)` is `{ kind: 'group', index: 2 }`.
  - `hooks/register.test.ts`, looped over `['terminal', 'desktop']`:
    - With no task, the dashboard has no `tasks` button.
    - Submit `'fix nav'`, create `A` (description `dA`) and `B`, and set `A` to `in_progress`. The dashboard has a `tasks` Button and the cell `0/2`. Press `tasks`: `paneText` contains `Tasks`, `▾ 0/2`, `fix nav`, `◐ A`, `dA`, `○ B`. Press `back`: the dashboard comes back.
    - Complete `A` and `B`, then create `C` after the prompt `'next'`. The screen shows `▾ 0/1` with `next` and `○ C`, and `▸ 2/2` with `fix nav`. It does not show `◐ A` or `✓ A`. Press the `▸` group: `✓ A` shows.
    - A replayed task with no times shows `—`.
    - A group row with a prompt of 300 characters at `bodyColumns: 60` is one row.
  - Desktop only: while `A` is `in_progress`, the duration is a `Client` with `since` equal to its `startedAt`. Advance the mock clock by 3 seconds: the pane does not draw again.
  - Terminal only: advance the mock clock by 2 seconds while `A` is `in_progress`. The duration text changes.

- [ ] **Step 2: Run** `bun test mods/flight-deck`. Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.**
  - Copy the shape of `cacheRow` for `tasksRow`: Button `key="tasks"`, label `tasks`, and a cell with the `<completed>/<total>` of the last group.
  - Copy the toolbar of `toolsScreen` for `tasksScreen`: back Button and the title `Tasks`, bold.
  - Groups, newest first. A group row is a Button `key="group:<index>"`, `plain`, with the label `<▾|▸> <done>/<total>  <HH:MM>[–<HH:MM>  <duration>]  <prompt>`, cut to one row. Use the one-row pattern for a Button in CLAUDE.md, UI.
  - A task row: `<glyph> <subject>`, then a cell for the start time and a cell for the duration. Use `formatDuration`, and `—` for `null`. A running task gets a cell with `since: startedAt`. Below it, the description with `dimColor` and `wrap="wrap"`.
  - Get the tones from `docs/design-system.md`.

- [ ] **Step 4: Run** `bun run check`. Expected: PASS.

- [ ] **Step 5: Commit** `flight-deck: a tasks screen in the pane`.

### Task 4: Docs, version, desktop check

**Files:**
- Change: the mod `README.md`, root `README.md`, each `docs/i18n/README.<lang>.md`, `.claude-plugin/plugin.json`, `CHANGELOG.md`, `CLAUDE.md` (the tested version)

- [ ] **Step 1:** Update the README of the mod as the spec says (Docs and version). Mirror the change in the root README and each translation. Run `python3 /Users/bez/.claude/skills/asd-ste100/scripts/ste-lint.py` on each English file. Expected: 0 hard violations.
- [ ] **Step 2:** Set the version to `0.14.0`. Add the changelog entry under flight-deck: `[0.14.0] - <date>`, "Tested on Claude Code 2.1.330.", `#### Added`, and the one sentence.
- [ ] **Step 3:** Run the desktop engine test from CLAUDE.md: `"<desktop folder>/<hash>/claude.app/Contents/MacOS/claude" plugin test mods/flight-deck`. Expected: only the tests of the new-engine branches fail.
- [ ] **Step 4:** Let the engine rewrite the typings (load the mod one time), then run `bun run check`. Expected: PASS. Set `CLAUDE.md` to 2.1.330.
- [ ] **Step 5: Commit** `flight-deck: a tasks screen with the task history of the session (0.14.0)`.
- [ ] **Step 6:** After the merge, move each lasting decision into the spec, then remove this plan.
