# flight-deck: task history

## Intent

The model makes a task list with `TaskCreate` and `TaskUpdate`. Claude Code 2.1.330 shows the current list in a panel above the prompt, on the terminal and on the desktop. The panel opens when the model creates a task. `ctrl+t` hides or shows it. The global setting `showExpandedTodos` keeps that choice.

The engine clears the list when the model completes all its tasks. Thus the user cannot see the earlier lists of a session, their times, or their descriptions.

flight-deck must keep each task list of the session as a group. A tasks screen in the pane shows the groups, as the tools screen shows the tool calls.

## Goals

- The mod keeps every task list of the session. It does not clear a list when the model completes all its tasks.
- Each group shows the first line of the user prompt that started it, the count of completed tasks, and its times.
- Each task shows its subject, its description, its start time and its duration.
- The duration of a task that is in progress increases each second.
- The newest group is at the top and is open. A stopped group shows as one row. A press opens it.
- The history stays after a resume and after a reload of the mod.

## Non-goals

- A band segment. The panel of the engine shows the current list.
- A change to a task. The mod does not call `TaskCreate`, `TaskUpdate` or `TaskList`.
- `blockedBy` and the owner of a task.
- The history of another session. `/clear` starts a new session, and its history is empty.

## Anti-goals

- A history that is not the same as the calls of the model.
- A desktop pane that redraws each second. That drops the clicks on its buttons (CLAUDE.md, Desktop).

## Constraints

- The engine has no API that reads the task list. The mod gets the data from the `tool.call` results. The types of these results are loose: read each field with a type check.
- `$.session.messages()` gives no time for a message.
- The plugin API is early access. A new name or schema of a task tool stops the updates.
- The rules in CLAUDE.md for a screen change and the focus, and for an animation on the desktop.

## Data source

These shapes come from the transcripts in `~/.claude/projects` and from the binary of Claude Code 2.1.330.

| Tool | Input | Result (`res.result`) |
|---|---|---|
| `TaskCreate` | `{ subject, description, activeForm }` | `{ task: { id, subject } }` |
| `TaskUpdate` | `{ taskId, status?, subject?, description?, ... }` | `{ success, taskId, updatedFields, statusChange?: { from, to } }` |
| `TaskList` | `{}` | `{ tasks: [{ id, subject, status, blockedBy }] }` |

The values of `status` are `pending`, `in_progress`, `completed` and `deleted`. The ID is a string with a number, for example `"3"`.

## Approaches

- **A band segment and a pane screen.** This was the first design. The panel of the engine already shows the current task, so the band segment is a copy.
- **A pane of its own.** A second pane beside flight-deck shows the same data that a screen of flight-deck can show.
- **A tasks screen in the flight-deck pane.** It has the same pattern as the tools screen.

The user picked the tasks screen. The group description is the first line of the user prompt. The other option was the text of the model before the first `TaskCreate`. That text can be empty or long.

## Design

### Model

```ts
type TaskStatus = 'pending' | 'in_progress' | 'completed'
type Task = {
  id: string
  subject: string
  description: string
  status: TaskStatus
  startedAt: number | null // the first change to in_progress, epoch ms
  endedAt: number | null // the change to completed
}
type TaskGroup = { prompt: string; createdAt: number | null; tasks: Task[] }
```

The history of a session is `TaskGroup[]`, oldest first. The last group is the current group.

### Capture

The `tool.call` hook of flight-deck already calls `next(e)` and reads the result. It must also apply each task call to the history. Do each write in the updater (`update($, atom, c => ...)`). The model sends some `TaskCreate` calls in one batch, and they run at the same time. `now` is the clock of the hook (`stamp($)`).

1. `TaskCreate`: if the current group has no task, or all its tasks are `completed`, start a new group. Its `prompt` is the last user prompt, and its `createdAt` is `now`. Then add the task to the current group, with the ID from the result of that call and the status `pending`.
2. `TaskUpdate` with `success: true`: find the task by `taskId` in the current group. Apply `status`, `subject` and `description` from the input. A change to `in_progress` sets `startedAt` if it has no value. A change to `completed` sets `endedAt`. For `deleted`, remove the task.
3. `TaskList`: in the current group, set the subject and the status of each task from the result. Add a task that the group does not have, and remove a task that the result does not have. Keep the times and the descriptions. Ignore a result with no task. Also ignore a result when all tasks of the current group are `completed`. The engine cleared its list, and the history keeps the group.
4. Ignore a call that the user denied (`res.deny`), a call that has `isError`, and a result that has an unknown shape.

A call from a subagent (the event has `e.agentId`) changes the same history. Transcripts on this machine have no subagent `TaskCreate` call. If the list of a subagent starts again at ID 1, its IDs collide with the main list. Check this during the build with the debug log of CLAUDE.md.

### The user prompt

The `prompt.submit` hook keeps the first line of the last prompt that the user typed, cut to 80 characters. It ignores a prompt from another origin, for example a task notification. The mod keeps this value in memory only. The store gets a prompt only as the title of a group that has tasks. A prompt can hold a pasted secret: a short title keeps less of it.

### Storage

Keep the history in the store, keyed by `$.session.id()`, as the counts of the session. On a mismatch of the session ID, load the history of that ID. Remove the history of a session that the store prunes.

### Replay

The tasks that the model made before the mod loaded are not in the store. On a mismatch of the session ID with no stored history, the mod reads `$.session.messages()`. It then applies each `TaskCreate`, `TaskUpdate` and `TaskList` use, in order, with the rules of Capture. The prompt of a group is the text of the last user message before its first `TaskCreate`. A replayed task has no times: the screen shows `—`. A use can have its result as text only, for example `Task #3 created successfully: <subject>`. In that case, get the ID from the text.

### Pane: tasks screen

- Add `isTasks` and `openGroups: number[]` to the `pane` atom. Add `isTasks` to the chain of screens at `hooks/register.tsx:868`.
- The dashboard gets a `tasks` row, as the cache and tools rows: a `tasks` Button and a cell `<completed>/<total>` of the current group. It shows only when the history has a group.
- The screen has a back button and the title `Tasks`. Then it shows the groups, newest first:

```
← back   Tasks
▾ 1/3  14:02  cosun-admin: patch the Go vulnerabilities
  ✓ Run govulncheck                              14:02  2m10s
    Scan backend and ephemeris for CVEs
  ◐ Patch the Go modules                         14:04  1m23s
    Bump x/net and the toolchain to 1.23.4
  ○ Test and redeploy
    Run the tests, then deploy both services
▸ 4/4  13:10–13:48  38m  add the trial mode
▸ 2/2  11:30–11:41  11m  fix the nav menu icon
```

- A group row is a Button: `▾` for an open group, `▸` for a closed group. It shows the count, the times and the prompt, cut to one row.
  - The current group is open until the user closes it.
  - A stopped group (all tasks `completed`, or not the current group) stays closed until the user opens it. `openGroups` keeps the index of each group that the user changed.
- A task row: glyph, subject, start time `HH:MM`, duration. The description is on the next row, dim, and it wraps. A `pending` task has no times. A task with no time shows `—`.
- Glyphs: `✓` `completed` (dim), `◐` `in_progress`, `○` `pending` (dim). Get the colors from `docs/design-system.md`.
- Duration format: the format of the existing durations in the band (`formatDuration`).

### Live duration

- Terminal: the screen reads the clock when it draws. The existing pane tick (`startSpinner`) redraws the pane each second while the tasks screen is open and a task is `in_progress`.
- Desktop: the duration of a task that is `in_progress` is a pane cell with `since: startedAt`. The existing `src/cellClient.tsx` draws it with a timer of its own. The tree of the pane does not change each second.

### Docs and version

- README of the mod, "Data that the mod reads": the inputs and results of the three task tools. It also reads the first line of the user prompt. "Hooks": the `tool.call` and `prompt.submit` hooks read these. The store keeps these values of each task: subject, description, status, times. It also keeps the title of each group: the first line of a prompt, cut to 80 characters.
- The root `README.md` and each `docs/i18n/README.<lang>.md`, in the same commit.
- Version 0.14.0. Changelog: "The pane has a tasks screen that keeps each task list of the session, with its times."
- `CLAUDE.md`: the tested version, after the check on 2.1.330.

## Left to the builder

- The tone of each glyph, from `docs/design-system.md`.
- The type guards for the loose result shapes.
- The value of `e.origin.kind` for a typed prompt (grep the typings).
- The test of the desktop engine, as CLAUDE.md says.
