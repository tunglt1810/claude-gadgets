# flight-deck: task list

## Intent

The desktop app shows the task list of a session in a fixed panel. Each task shows its status: done, in progress or pending. The CLI shows the list in the chat output. When the model works fast, the output moves the list off the screen. Then the user cannot see which step the session is at.

flight-deck must show the task list in a fixed place in the CLI. The list must update when the model changes a task. The data must be the same as the data of the desktop panel.

## Goals

- The band shows the task that is in progress and the count of done tasks, for example `◐ 2/3 Patch the Go toolchain`.
- A press on that part of the band opens the pane on a new tasks screen.
- The tasks screen shows all tasks of the session, in order of ID, each with its status glyph.
- The list stays the same as the list of the model after `/clear`, after a resume, and after a reload of the mod.

## Non-goals

- The mod does not change a task. It does not call `TaskCreate` or `TaskUpdate`.
- The mod does not show `description`, `blockedBy` or the owner of a task.
- The mod does not show the task list of another session that shares the list.

## Anti-goals

- A list that is not the same as the list of the model. A wrong list is worse than no list.
- A band that wraps to two rows.
- A band segment on the desktop. The desktop has its own panel, and two lists in one window are noise.

## Constraints

- The engine has no API that reads the task list. The typings know `TaskCreate` only as an input of a settings hook. Thus the mod gets the data from `tool.call` results. The types of these results are loose: read each field with a type check.
- The plugin API is early access. A new name or schema of a task tool stops the updates.
- The band is one row (CLAUDE.md, UI).
- The rules in CLAUDE.md for a terminal Button in a row, for a screen change and the focus, and for the desktop.

## Data source

These shapes come from the transcripts in `~/.claude/projects` (Claude Code 2.1.x, CLI and desktop).

| Tool | Input | Result (`res.result`) |
|---|---|---|
| `TaskCreate` | `{ subject, description, activeForm }` | `{ task: { id, subject } }` |
| `TaskUpdate` | `{ taskId, status?, subject?, activeForm?, ... }` | `{ success, taskId, updatedFields, statusChange?: { from, to } }` |
| `TaskList` | `{}` | `{ tasks: [{ id, subject, status, blockedBy }] }` |

The values of `status` are `pending`, `in_progress`, `completed` and `deleted`. The ID is a string with a number, for example `"3"`.

## Approaches

- **A. A band segment only.** It is the cheapest and it is always in view. It does not show the full list.
- **B. A pane screen only.** It is the nearest to the desktop panel. The user must open the pane and go to that screen. On another screen, the list is not in view.
- **C. A band segment and a pane screen.** The band shows the current task at all times. The pane shows the full list. A press on the band segment opens the pane on the list.

The user picked C. The band solves the problem of the output that moves the list off the screen. The pane gives the full plan when the user needs it.

## Design

### Capture

The `tool.call` hook of flight-deck already calls `next(e)` and reads the result. It must also apply each task call to a `tasks` list. Do each write in the updater (`update($, atom, c => ...)`). The model sends some `TaskCreate` calls in one batch, and they run at the same time.

1. `TaskCreate` with no error: add `{ id: res.result.task.id, subject, activeForm, status: 'pending' }`. Take the ID from the result of that call. Do not take it from the order of the calls.
2. `TaskUpdate` with no error and `success: true`: find the task by `taskId`. Apply `status`, `subject` and `activeForm` from the input. For `deleted`, remove the task.
3. `TaskList` with no error: replace the full list with `res.result.tasks`. Keep the `activeForm` of a task that is already in the list.
4. Ignore a call that the user denied (`res.deny`) and a call that has `isError`.
5. Ignore a result that has an unknown shape. Do not remove the list.

A call from a subagent (the event has `e.agentId`) changes the same list. The tasks of a session are one list (decision: builder). Transcripts on this machine have no subagent `TaskCreate` call. If a subagent list starts again at ID 1, the IDs collide. Check this during the build with the debug log of CLAUDE.md. If the IDs collide, key a task by `(agentId ?? 'main', id)` and show only the main list.

### Storage

Keep the list in the store of the session, keyed by `$.session.id()`, as the counts of the session. On a mismatch of the session ID, load the list of that ID.

### Resync

A list that the mod builds from calls is wrong when tasks exist before the mod loads. To prevent this, the mod reads the history of the session on load and on a mismatch of the session ID. `$.session.messages()` gives the messages, as for the transcript screen. A message can have the result as text only, for example `Task #3 created successfully: <subject>`. In that case, get the ID from the text. The mod then applies each `TaskCreate`, `TaskUpdate` and `TaskList` result, in order, with the rules of Capture.

Decision: builder. The mod does not call `TaskList` itself. A call by the mod can show in the context of the model, and the README says that the mod calls only `TaskStop`. If the history is not available, use the stored list.

### Band (terminal only)

- The segment shows only when the list has a task that is not `completed`. When all tasks are `completed`, or when the list is empty, the segment goes away. This is the decision of the builder: the code of the desktop panel is not available.
- Format: `<glyph> <done>/<total> <subject>`. The glyph is `◐` when a task is `in_progress`, else `○`. The subject is the subject of the first task that is `in_progress`, in order of ID. If no task is `in_progress`, use the first `pending` task. Use the subject, as the desktop panel does.
- The segment is the first part of the row. The subject takes the remaining width and ends with `…`.
- Drop order when the row is narrow (decision: builder):
  1. Cut the subject to a minimum of 12 columns.
  2. Drop the existing parts in their current order.
  3. Remove the subject. `◐ 2/3` stays.
- The segment is a Button. Put it in a box as wide as the label, inside a box with `flexShrink` and `overflow="hidden"` (CLAUDE.md, UI).
- A press opens the pane on the tasks screen. Before the screen change, call `$.ui.focus` for the back button of the tasks screen.
- On the desktop, do not draw the segment.

### Pane: tasks screen

- Add `isTasks` to the `pane` atom (`hooks/register.tsx`) and to the chain of screens at `hooks/register.tsx:868`.
- The dashboard gets a `tasks` button, as the cache and tools buttons. It shows only when the list is not empty.
- The screen shows a back button, a title `Tasks <done>/<total>`, then one row for each task in order of ID:

```
← back   Tasks 1/3
 ✓ Run govulncheck for backend and ephemeris
 ◐ Patch the affected Go modules and toolchain
 ○ Test and redeploy the Go services
```

- Glyphs: `✓` for `completed` (dim), `◐` for `in_progress` (normal tone), `○` for `pending` (dim). Each glyph is one column wide. Get the colors from `docs/design-system.md`.
- A long subject wraps in the pane.
- The screen shows on the terminal and on the desktop.

### Docs and version

- README of the mod, "Data that the mod reads": add the inputs and results of `TaskCreate`, `TaskUpdate` and `TaskList`. "Hooks": the `tool.call` hook reads these results. The store keeps the subject of each task.
- The root `README.md` and each `docs/i18n/README.<lang>.md`, in the same commit.
- Version 0.14.0. Changelog: "The band shows the current task, and the pane has a tasks screen."

## Left to the builder

- The tone of each glyph, from `docs/design-system.md`.
- The type guards for the loose result shapes.
- The fallback for an engine that has no session history on load.
- The test of the desktop engine, as CLAUDE.md says.
