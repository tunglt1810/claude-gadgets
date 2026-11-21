# flight-deck task list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the task list of the session in the terminal band (one segment) and in a new tasks screen of the flight-deck pane.

**Architecture:** A pure module `src/tasks.ts` applies `TaskCreate`, `TaskUpdate` and `TaskList` calls to a list. The hooks module applies each `tool.call` result to a `tasks` atom, stores the list per session ID, and replays the session history on a session-ID mismatch. `Band` draws a task Button at the start of the terminal row. `AgentPane` draws a `tasks` row on the dashboard and a tasks screen.

**Tech Stack:** TypeScript, Bun, Claude Code plugin API 2.1.325 (`claude-code/testing`).

**Spec:** `docs/specs/2026-11-21-flight-deck-task-list-design.md`

## Global Constraints

- Every path is under `mods/flight-deck/` unless it starts with `docs/`, `CHANGELOG.md` or `README.md`.
- `bun run check` is green at the end of each task.
- TDD: write the failing test first and watch it fail.
- Drawn text: single-width glyphs only. `✓` completed, `◐` in progress, `○` pending.
- The band stays one row. The task segment is not drawn on the desktop.
- Version `0.14.0`. Changelog: "The band shows the current task, and the pane has a tasks screen."
- Read each field of a task result with a type check. An unknown shape changes nothing.

## Review Focus

1. Several `TaskCreate` calls in one batch: each task keeps the ID from its own result (Task 1 `applyCall`, Task 2 parallel-call test).
2. A `TaskUpdate` for an unknown ID, or a result with `success: false`: the list does not change (Task 1).
3. `/clear` or resume to a session with no stored list: the replay of the history gives the list. With no history, the list is empty (Task 2).
4. A narrow terminal: the row never wraps, and `◐ 2/3` is the last part that stays (Task 4).
5. A desktop pane: the tasks screen draws, and the band has no task Button (Task 3, Task 4 loop over `['terminal', 'desktop']`).

---

### Task 1: Task list model

**Files:**
- Create: `src/tasks.ts`
- Test: `src/tasks.test.ts`
- Change: `types/index.d.ts` (add `Task`, `TaskStatus`)

**Interfaces:**
- Produces:
  - `type TaskStatus = 'pending' | 'in_progress' | 'completed'`
  - `type Task = { id: string; subject: string; status: TaskStatus }`
  - `applyCall(list: Task[], tool: string, input: Record<string, unknown>, result: unknown): Task[]`. Returns `list` unchanged for any other tool or an unknown shape.
  - `replay(messages: { toolUses: { tool: string; input: Record<string, unknown>; result?: unknown; text?: string; isError?: boolean }[] }[]): Task[]`
  - `parseTasks(raw: unknown): Task[]` (store value to list, `[]` on a bad shape)
  - `tasksKey(sessionId: string): string`, which returns `` `tasks:${sessionId}` ``
  - `taskBand(list: Task[]): { glyph: '◐' | '○'; done: number; total: number; subject: string } | null`
  - `taskLabel(band: NonNullable<ReturnType<typeof taskBand>>, room: number): string`
  - `const MIN_SUBJECT = 12`

- [ ] **Step 1: Write the failing tests** in `src/tasks.test.ts`:
  - `TaskCreate` with result `{ task: { id: '3', subject: 'S' } }` adds `{ id: '3', subject: 'S', status: 'pending' }`.
  - Two creates applied out of order (IDs `'2'` then `'1'`) give a list in ID order `['1','2']` (numeric sort, so `'10'` is after `'9'`).
  - `TaskUpdate` input `{ taskId: '1', status: 'in_progress' }`, result `{ success: true, taskId: '1' }`, changes the status. Input `subject: 'T'` changes the subject.
  - `TaskUpdate` with `status: 'deleted'` removes the task.
  - `TaskUpdate` for an unknown ID, or with `success: false`, returns the same list.
  - `TaskList` result `{ tasks: [{ id, subject, status, blockedBy }] }` replaces the list.
  - A result of an unknown shape (`null`, `'x'`, `{ task: {} }`) returns the same list (`toBe`).
  - `replay`: a `TaskCreate` use with no `result` and `text: 'Task #4 created successfully: Foo'` adds `{ id: '4', subject: 'Foo' }`. `replay` skips a use with `isError: true`.
  - `taskBand`: `[completed, in_progress 'B', pending 'C']` gives `{ glyph: '◐', done: 1, total: 3, subject: 'B' }`. With no `in_progress` task: `glyph: '○'` and the first pending subject. All completed, or empty: `null`.
  - `taskLabel({ glyph: '◐', done: 2, total: 3, subject: 'Patch the Go toolchain' }, 40)` is `'◐ 2/3 Patch the Go toolchain'`. At a room of 6 + 12, the subject is cut with `…` to 12 columns. Below that room, the label is `'◐ 2/3'`.

- [ ] **Step 2: Run** `bun test mods/flight-deck/src/tasks.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement `src/tasks.ts`.** Use `cut` from `src/clip.ts` for the `…` cut.

- [ ] **Step 4: Run** `bun test mods/flight-deck/src/tasks.test.ts`. Expected: PASS. Then run `bun run check`.

- [ ] **Step 5: Commit** `flight-deck: a task list model`.

### Task 2: Capture, store and replay

**Files:**
- Change: `hooks/register.tsx` (the `tasks` atom, the `tool.call` hook at line 1444, a new `ensureTasks`, the prune at line 266)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `applyCall`, `replay`, `parseTasks`, `tasksKey` (Task 1).
- Produces:
  - `const tasks = atom({ plugin: 'flight-deck', key: 'tasks' } as const, { sessionId: null as string | null, list: [] as Task[] })`
  - `async function ensureTasks($: Api): Promise<Task[]>`. On a session-ID mismatch with the atom, it loads `$.store.get(tasksKey(id))`. If there is no stored value, it uses `replay(await $.session.messages())`. A `{ deny }` gives `[]`.

- [ ] **Step 1: Write the failing tests.** Extend `toolResult` in the test engine: `TaskCreate` answers `{ result: { task: { id: String(++taskSeq), subject: e.subject } }, text: '' }`, and `TaskUpdate` answers `{ result: { success: true, taskId: e.taskId }, text: '' }`. Reset `taskSeq` in `engine`. Add an `on('session.messages', ...)` answer from a per-test `history` array. This task has no UI yet: observe the list in the object that the test passes to `mock.store` (key `tasks:<id>`). If the mock copies that object, read it back with a reload under the same session ID. Tests:
  - Three `TaskCreate` calls with `Promise.all`, then a `TaskUpdate` of `'2'` to `in_progress`: the stored list is `A pending, B in_progress, C pending`, IDs `'1','2','3'`.
  - A call from a subagent (`agentId: 'a1'`) changes the same list.
  - A denied call (a `tool.check` hook in the test that denies `TaskCreate`) adds nothing.
  - Store round trip: session `S1` has tasks. Switch to `S2` (no store, empty history), then make a `TaskCreate` call: `tasks:S2` has one task, and `tasks:S1` keeps its list.
  - Replay: a session `S3` with no store, and `history` holding a `TaskCreate` use with `text: 'Task #1 created successfully: X'`. A `TaskCreate` call in `S3` gives a stored list of two tasks: `X` and the new one.
  - Prune: after `MAX_SESSIONS + 1` sessions, the oldest `tasks:` key is gone from the store.

- [ ] **Step 2: Run** `bun test mods/flight-deck/hooks`. Expected: FAIL.

- [ ] **Step 3: Implement.** In the `tool.call` hook, after the `res.deny` check: if `e.tool` is `TaskCreate`, `TaskUpdate` or `TaskList` and `!res.isError`, call `ensureTasks`. Then `update($, tasks, c => ({ ...c, list: applyCall(c.list, e.tool, e as never, res.result) }))`. Then write `tasksKey(id)` only when the JSON of the list changed. Remove `tasksKey(old)` beside `agentsKey(old)` in the prune.

- [ ] **Step 4: Run** `bun run check`. Expected: PASS.

- [ ] **Step 5: Live check.** Run `claude --plugin-dir mods/flight-deck` and ask for a 3-step task list. Record the `TaskCreate` calls of a subagent with the debug log of CLAUDE.md. If the IDs of a subagent start again at `1`, stop and report: the spec then keys tasks by agent.

- [ ] **Step 6: Commit** `flight-deck: capture the task list of the session`.

### Task 3: Tasks screen in the pane

**Files:**
- Change: `src/pane.tsx` (new `tasks` prop, `tasksRow` on the dashboard after `toolsRow`, `tasksScreen`, branch beside `view.isTools`)
- Change: `src/action.ts` (`'tasks'` in the key list at line 10)
- Change: `types/index.d.ts` (`PaneView.isTasks?: boolean`, `PaneAction` `{ kind: 'tasks' }`)
- Change: `hooks/register.tsx` (`isTasks: false` in `initialPane`, `openTasks`/`closeTasks` as `openTools`/`closeTools`, the `back` chain at line 868, `action.kind === 'tasks'`, the `tasks` atom passed to `AgentPane` after `ensureTasks`)
- Test: `src/action.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: `Task` (Task 1). `ensureTasks`, the `tasks` atom (Task 2).
- Produces:
  - `AgentPane` prop `tasks: Task[]` and `onTasks: () => void`
  - `async function openTasks($: Api): Promise<void>` (focus on `'back'`) and `closeTasks` (focus on `'tasks'`)

- [ ] **Step 1: Write the failing tests:**
  - `src/action.test.ts`: `focusAction('tasks', null)` is `{ kind: 'tasks' }`.
  - `hooks/register.test.ts`, looped over `['terminal', 'desktop']`: put two tasks in the session with `$.tool.call` (the `TaskCreate` test answer of Task 2). Open the pane, press `tasks`. `paneText` contains `Tasks 0/2`, `○ A` and `○ B`. Press `back`: the dashboard is drawn again.
  - With no task, the dashboard has no `tasks` button.

- [ ] **Step 2: Run** `bun test mods/flight-deck`. Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.** Copy the shape of `cacheRow` for `tasksRow` (Button `key="tasks"`, label `tasks`, a cell with `<done>/<total>`). Copy the toolbar of `toolsScreen` for `tasksScreen` (back Button, title `Tasks <done>/<total>`, bold). Draw each row as `<glyph> <subject>` with `wrap="wrap"`: `✓` and `○` rows in `PALETTE.dim`, `◐` in `PALETTE.fg`. Check the tones against `docs/design-system.md`.

- [ ] **Step 4: Run** `bun run check`. Expected: PASS.

- [ ] **Step 5: Commit** `flight-deck: a tasks screen in the pane`.

### Task 4: Task segment in the terminal band

**Files:**
- Change: `src/band.tsx` (props `task?: ReturnType<typeof taskBand>`, `onTask?: () => void`. Terminal branch only.)
- Change: `src/layout.ts` (export the existing `width` and `BUTTON_CHROME`)
- Change: `hooks/register.tsx` (pass `task` and `onTask` in both `Band` renders, lines 1850-1900. `onTask` opens the pane if it is not open, then calls `openTasks`.)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `taskBand`, `taskLabel`, `MIN_SUBJECT` (Task 1). `ensureTasks`, the `tasks` atom (Task 2). `openTasks` (Task 3).
- Produces: `async function openTasksFromBand($: Api): Promise<void>`.

- [ ] **Step 1: Write the failing tests** (`bandText` at 200 columns, and at 60 columns with a new `columns` parameter):
  - Three `TaskCreate` calls in one batch, then a `TaskUpdate` of `'2'` to `in_progress`: the label is `◐ 0/3 B`.
  - Terminal, tasks `[completed A, in_progress B, pending C]`: the band has a Button with label `◐ 1/3 B`. It is the first Button of the row, before `▸ Flight Deck`.
  - Terminal at 60 columns, with a long subject: the label is cut with `…`, and the row has one line. At a width where the existing parts are all dropped: the label is `◐ 1/3`.
  - All completed: no task Button.
  - Desktop: no task Button, and the `Client` props have no task.
  - A press on the task Button with the pane closed: the pane opens on the tasks screen (`Tasks 1/3` in `paneText`).

- [ ] **Step 2: Run** `bun test mods/flight-deck/hooks`. Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.** In the terminal branch, compute `reserve = '◐ 9/9 '.length + MIN_SUBJECT + BUTTON_CHROME + 1` when `task` has a value. Call `bandSegments` with `columns - reserve`. Then `room = columns - width(segments) - BUTTON_CHROME - 1`. The label is `taskLabel(task, room)`. Draw the Button in a box as wide as the label, inside a box with `flexShrink={1}` and `overflow="hidden"` (CLAUDE.md, UI). The existing row stays after it.

- [ ] **Step 4: Run** `bun run check`. Expected: PASS.

- [ ] **Step 5: Commit** `flight-deck: the band shows the current task`.

### Task 5: Docs, version, desktop check

**Files:**
- Change: `README.md` of the mod ("Data that the mod reads", "Hooks", store), root `README.md`, each `docs/i18n/README.<lang>.md`
- Change: `.claude-plugin/plugin.json` (`0.14.0`), `CHANGELOG.md` (flight-deck `[0.14.0] - <date>`, "Tested on Claude Code 2.1.325.", `#### Added`, the one sentence)
- Change: `docs/specs/2026-11-21-flight-deck-task-list-design.md` (record the result of the subagent ID check)

- [ ] **Step 1:** Update the mod README. The `tool.call` hook reads the input and the result of `TaskCreate`, `TaskUpdate` and `TaskList`. The mod reads the session messages to rebuild the list. The store keeps the ID, the subject and the status of each task. Mirror the change in the root README and each translation. Run `python3 /Users/bez/.claude/skills/asd-ste100/scripts/ste-lint.py` on each English file. Expected: 0 hard violations.
- [ ] **Step 2:** Bump the version and add the changelog entry.
- [ ] **Step 3:** Run the desktop engine test from CLAUDE.md: `"<desktop folder>/<hash>/claude.app/Contents/MacOS/claude" plugin test mods/flight-deck`. Expected: only the tests of the new-engine branches fail.
- [ ] **Step 4:** Run `bun run check`. Expected: PASS.
- [ ] **Step 5: Commit** `flight-deck: the band shows the current task, and the pane has a tasks screen (0.14.0)`.
- [ ] **Step 6:** After the merge, move each lasting decision into the spec, then remove this plan.
