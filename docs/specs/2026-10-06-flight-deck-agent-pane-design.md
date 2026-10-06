# flight-deck agent pane: design spec

## Goal

Add a pane to the `flight-deck` mod. The pane shows the subagents of the current session and the transcript of each subagent. The `agents` count on the band is the button that opens and closes the pane. One module runs on the CLI (`terminal`) and on Claude Desktop (`desktop`).

## Problem

- CLI: when a subagent completes, the engine removes it from the tasks list. The user cannot open its transcript again.
- Desktop: after the main session sends a message to a completed subagent, the Desktop viewer cannot show the transcript of that subagent.

A mod cannot repair the Desktop viewer, because a plugin cannot write `SiteView`. The mod draws its own pane. The pane does not use the Desktop viewer.

## Scope

In scope:

- A tree of the subagents that the current session started.
- The transcript of one subagent, in a compact form. The user presses a tool call to see its input and its result.
- The `agents` count on the band as a button that opens and closes the pane.
- A slash command `/agent-log` that opens and closes the pane.
- Data that stays available after `--resume`, after an in-process resume, and after a subagent gets a new message.

Out of scope:

- A subagent that started before the engine loaded the mod.
- Subagents of other sessions.
- The agents of a workflow run, and a teammate that runs in its own terminal pane. The engine refuses to read these transcripts. The pane shows the refusal text.
- A repair of the Desktop viewer.
- A separate mod. The feature is part of `flight-deck`.

## Probe results

A throwaway probe mod ran in two headless sessions (`claude -p`, Claude Code 2.1.289). The results are:

| Question | Result |
| --- | --- |
| Does `$.session.messages({ agentId })` give data after the agent leaves `$.agent.list()`? | Yes. The agent leaves the list at its `turn.complete`. The call continues to give all rows. |
| What does the call give after `SendMessage` starts the agent again? | The full history. The agent keeps its id. It shows in `$.agent.list()` again (`running`, then `idle`) and raises a second `turn.complete`. |
| Does the call give data after `--resume`? | Yes. The session id stays the same. The data is available at `session.start`. |

The probe also showed these facts:

- The last answer of a subagent is in the input of a `SubagentHandback` tool use. The `text` of that assistant message is empty.
- A tool result is a `user` row with an empty `text`. Its data is in `toolResults`, and each `toolUses` entry also has its `text` and `result`.
- One agent can run more than one time.

Not verified: the interactive CLI, a live Desktop session, and a `Button` in the band row. The verification section includes these checks.

## Approach

The mod makes an agent registry from events. It reads a transcript through `$.session.messages({ agentId })` when the user opens an agent. The mod does not store transcripts and does not read transcript files from disk.

## Files

New files in `mods/flight-deck/src/`, each with a `*.test.ts` file:

| File | Function |
| --- | --- |
| `registry.ts` | The agent registry reducers. |
| `tree.ts` | Registry to ordered rows with depth. |
| `transcript.ts` | `SessionMessage[]` to transcript items. |
| `summary.ts` | One line for each tool call. |
| `clip.ts` | The line limit for input text and result text. |
| `pane.tsx` | The pane: the agent tree screen and the transcript screen. |

Changed files:

| File | Change |
| --- | --- |
| `hooks/register.tsx` | New atoms, registry updates in the agent events, the pane hooks, the command. |
| `src/layout.ts` | `agents` is the last part that the band drops. The segments tell the band which one is the button. |
| `src/band.tsx` | The `agents` segment is a `Button`. |
| `types/index.d.ts` | The registry types and the pane view types in `PluginState`. |
| `.claude-plugin/plugin.json`, `README.md` | The description of the pane. |

## Data

### Agent registry

The registry is separate from `Snapshot.byAgent`, which continues to hold the token counts. One registry entry for each agent:

| Field | Meaning |
| --- | --- |
| `id` | The agent id. |
| `parentId` | The id of the agent whose loop started it. Absent when the main loop started it. |
| `type` | The agent type (`general-purpose`, `Explore`). |
| `description` | The short task description of the Agent call. |
| `name` | The `SendMessage` address, when the agent has one. |
| `status` | `running` or `idle`. |
| `runs` | The number of completed runs. |
| `startedAt` | The time of the first event. |
| `endedAt` | The time of the last `turn.complete`. `null` while the first run is in progress. |

Events change the registry as follows:

- `agent.spawn` (after `next`, when the result has an `agentId`): add the entry with `status: running`.
- `turn.step` and `tool.call` with an `agentId`: set `status: running`. Add the entry if it is absent.
- `turn.complete` with an `agentId`: set `status: idle`, add 1 to `runs`, set `endedAt`.
- Each of these events also merges `$.agent.list()` into the registry. The merge adds an agent that raised no `agent.spawn` (a forked skill). The merge fills `type`, `description` and `name` when they are absent.

The updater computes each change (`update($, atom, c => ...)`).

### Persistence

- After each change, the mod stores the registry in `$.store` with the key `agents:<sessionId>`.
- `ensureLoaded` loads the registry together with the meter when `$.session.id()` changes.
- When `save` removes the meter of an old session, it also removes the registry of that session.

### Pane view state

- `isOpen`: the pane is open.
- `agentId`: the agent on the transcript screen. `null` shows the agent tree.
- `expanded`: the `tool_use_id` values of the open tool calls.
- `transcript`: `{ agentId, items }` or `{ agentId, deny }` for the agent on the transcript screen.

The pane view state is session state (`$.state`). The mod does not store it.

### Transcript load

- A press on an agent row sets `agentId`, then reads `$.session.messages({ agentId })` and writes `transcript`.
- A `tool.call` or `turn.complete` of the agent on the transcript screen reads the transcript again.
- The mod discards a result that arrives for an agent that is no longer on the transcript screen.

## Transcript items

`transcript.ts` changes `SessionMessage[]` into a list of items:

| Item | Source |
| --- | --- |
| `prompt` | A `user` row with text. The first one is the task. A later one is a new message to the agent. |
| `text` | An `assistant` row with text. |
| `tool` | One `toolUses` entry: `tool_use_id`, tool name, input, result text, `isError`, and `agentId` for an Agent call. |
| `answer` | A `SubagentHandback` tool use. Its input is the answer of the run. |

A `user` row that has only `toolResults` makes no item.

## UI

### Band button

- The `◆ agents N` segment of the band is a plain `Button`. Its label, its position and its color do not change. `N` stays the count that the band shows now (`Snapshot.agents`).
- A press opens the pane when it is closed and closes it when it is open.
- The label is bold while the pane is open.
- The band root changes from one `Text` to a `Box` row: the segments before the button, the button, the segments after the button. The band stays on one row.
- `agents` moves to the end of `DROP_ORDER`. On a narrow band, the button is the last part that the band drops.
- While the transcript of one agent is in view (`e.props.view.agentId`), the band draws no `agents` segment, as it does now. The command stays available.

### Pane, agent tree screen

- One plain `Button` for each agent: status mark, type, description, run count.
- An agent that the main loop started is at depth 0. A child agent is below its parent with one more indent level.
- At each depth, the newest agent is first.
- An empty registry shows `No agents yet.`

### Pane, transcript screen

- A back button, then a title row: type, description, status, run count.
- The transcript items in order.
- A `tool` item is a plain `Button` with one summary line (`Read README.md`, `Bash wc -l README.md`). A press shows or hides a `Code` block with the input and the result text.
- A `tool` item of an Agent call has a second button that opens the child agent.
- An `answer` item is drawn with `Markdown`.
- The pane draws a maximum of 40 lines of input text and 40 lines of result text. A last line gives the number of hidden lines.
- When a transcript has more than 300 items, the pane draws the newest 300. A first line gives the number of hidden items.
- A `deny` result shows the refusal text.
- An empty transcript shows `No messages yet.`

### Rules for both screens

- The engine owns the scroll. The mod draws the full tree.
- Each row fits `e.props.bodyColumns`. A long text is cut, not wrapped.
- No emoji. All drawn characters are single width.
- `ui.render` writes no state.

### Slash command

`/agent-log` opens the pane when it is closed and closes it when it is open. `session.start` registers the command.

### Pane close

A `ui.close` hook for the pane sets `isOpen` to false. Thus the band button shows the state of the pane after the user closes the pane with the engine close mark.

## Testing

Unit tests (written before the code):

- `registry.ts`: spawn, run, complete, a second run, an agent seen first in `$.agent.list()`, a step that arrives before the spawn.
- `tree.ts`: order, depth, a child whose parent is absent.
- `transcript.ts`: the rows that the probe recorded (one run, two runs). Also a tool call in progress, an errored tool call, and an Agent call with a child id.
- `summary.ts` and `clip.ts`: width limit, line limit, hidden-line count.
- `layout.ts`: the band drops `agents` last, and the segments identify the button.

`hooks/register.test.ts`, each case in a loop over `['terminal', 'desktop']`:

- A spawn puts the agent in the tree.
- A press on the band button opens the pane. A second press closes it.
- A press on the agent shows its transcript.
- A press on a tool call shows its result. A second press hides it.
- A second `turn.complete` for the same agent gives `runs` 2 and a transcript with both runs.
- A change of session id loads the registry of the new session.
- A `deny` result shows the refusal text.

The existing tests of `flight-deck` must continue to pass. `bun run check` must pass.

## Verification on live surfaces

1. Load the mod in an interactive CLI session. Make sure that the band stays on one row with the button in it.
2. Start a subagent and let it complete. Press the `agents` button and open the transcript of the subagent.
3. Send a message to the completed subagent. Make sure that the pane shows both runs.
4. Resume the session with `--resume`. Make sure that the tree and the transcript are available.
5. Do steps 1 to 4 on Claude Desktop.

If the band does not stay on one row on a surface (step 1), stop and report it. The fallback is a separate button at the end of the band.
