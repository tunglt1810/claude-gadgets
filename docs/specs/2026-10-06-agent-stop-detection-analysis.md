# Agent stop detection: analysis and TODO

Status: implemented. See `docs/plans/2026-10-06-agent-stop-detection.md` for the probe results (P1, P2, P3) and the two changes to the design: rule 4 applies before the event, and rule 5 keeps an agent that `$.agent.list()` still shows.

## Problem

The agents pane of `flight-deck` shows each subagent as `running` or `idle`. Only events set the status:

- `agent.spawn`, `turn.step` and `tool.call` with an `agentId` set `running`.
- `turn.complete` with an `agentId` sets `idle`.

If an agent stops and no `turn.complete` arrives at the hook, the registry keeps `running`. The spinner of that agent does not stop.

## Sources

- The plugin typings of Claude Code 2.1.289 (`T` below): `mods/flight-deck/.claude-plugin/types/claude-code/index.d.ts`.
- The saved transcripts of session `3aa4d765`. In that session the parent stopped one agent with `TaskStop` and then started it again.
- No probe ran for this analysis. Each line marked INFERRED is not verified.

## Findings

STATED by the typings:

- `AgentStatus` has seven values: `pending`, `running`, `waiting`, `idle`, `completed`, `failed`, `killed` (T:495-502). The doc does not say that `$.agent.list()` gives the three end values for a subagent.
- `$.agent.list()` keeps an entry "until the engine drops its task" (T:3081-3083). The delay is not stated. The first probe of this project saw a subagent leave the list at its `turn.complete`.
- `turn.complete` has `isAborted` and `reason`: `answer`, `aborted`, `refusal`, `error` (T:12615-12684). The typings do not say if it fires for a killed subagent.
- `classic.SubagentStop` has no status field and no reason field (T:11692-11709). It cannot tell a kill from a normal end.
- The task notification is the only API surface that names the end of a subagent. The `UserMessage` render props have `task.id` (the agent id) and `task.status`: `completed`, `failed` or `killed` (T:13865-13900).
- A `ui.render` hook cannot write state. Thus the registry cannot take the status from the render props.
- `session.end` does not fire when the process dies (T:4266, T:10506-10534).

Evidence from the saved transcripts:

- The `TaskStop` call of the parent gave a notification with `<status>killed</status>` approximately 70 ms later.
- After the agent started again and completed, a second notification gave `<status>completed</status>`.
- The `.meta.json` file of an agent has no status field. A kill does not change it.
- The agent that showed no activity for 5.5 hours was not dead. Its last record is a `Bash` tool use with no result. The probable cause is a permission request that got no answer. No event fired during that time.

INFERRED:

- A `prompt.submit` hook with `origin.kind: 'task-notification'` gets the notification text in `e.text`.
- A `tool.call` hook on `TaskStop` sees `input.task_id`. It fires only when the model calls `TaskStop`.

## Signals

| Signal | Catches | Limits |
| --- | --- | --- |
| Task notification | Each stop, with the word `killed`, `failed` or `completed` | Not proven that a hook that can write state gets it |
| `turn.complete` reason | An interrupt or an API error, if the event fires | Not known for a kill |
| `$.agent.list()` | An end value, if the list shows one | An absent entry also means a normal end. A new agent can be absent for a short time |
| `classic.SubagentStop` | A stop | No status field |
| `TaskStop` tool call | A stop that the model makes | Not a stop from the tasks list or from the user |
| Session load after `--resume` | Each agent of the old process | Not a stop during the session |
| Timeout on the last event | A silent end | Wrong for an agent that waits for a permission, and for a long tool call |

Do not use a timeout. An agent that waits for a permission gives the same signal as a dead agent.

## Recommended design

Three states:

| State | Meaning | Pane mark |
| --- | --- | --- |
| `running` | The agent runs | The spinner |
| `idle` | The run ended with an answer | `○` |
| `stopped` | Killed, failed or aborted | `×` |

The pane does not need `killed` and `failed` as two states.

Precedence, highest first:

1. A task notification for the agent: `killed` or `failed` gives `stopped`. `completed` gives `idle`.
2. `turn.complete` with an `agentId`: `answer` gives `idle` and adds 1 to `runs`. `aborted`, `error` and `refusal` give `stopped`.
3. An event with an `agentId` gives `running`. This also starts a `stopped` agent again.
4. `$.agent.list()` shows an end value for a known `running` entry: `failed` or `killed` gives `stopped`. An absent entry changes nothing.
5. Session load in a new process: each stored `running` entry becomes `stopped`. A hot reload does not do this.

Code changes:

- `types/index.d.ts`: `AgentEntry.status` becomes `'running' | 'idle' | 'stopped'`.
- `src/registry.ts`: a reducer `stopped`, the change to `merged`, and `parseRegistry` accepts `stopped`.
- `src/registry.ts`: a pure function that reads the agent id and the status from a notification text.
- `hooks/register.tsx`: `turn.complete` reads `e.reason`. A new `prompt.submit` hook for task notifications. `loadAgents` applies rule 5.
- `src/pane.tsx`: the mark and the color of `stopped`.

No timer and no new engine call are necessary.

## TODO

Run these probes before the implementation. The probe mod is in `.tmp/agent-probe/` (not in git).

- [x] P1: Does a killed subagent raise `turn.complete`, and with which `reason`? Yes: `reason: 'aborted'`, `isAborted: true` (2.1.290).
- [x] P2: Does `prompt.submit` fire for a task notification, and is the text in `e.text`? Yes, with `origin.kind: 'task-notification'`, for a turn in progress. The idle case is not probed.
- [x] P3: What does `$.agent.list()` show for a killed agent, and for how long? `killed`, at once and for at least 30 s.
- [ ] P4: What fires for an agent that fails with an API error?
- [ ] P5: Does a background agent continue after the user interrupts the main turn?
- [ ] P6: Does `$.agent.list()` show `waiting` for an agent that waits for a permission? If yes, the pane can show a `waiting` state for the 5.5 hour case.
- [ ] P7: What does a foreground Agent call carry when the user interrupts it?

Then:

- [x] Implement the design with the signals that the probes confirm. Write the tests first.
- [x] If P2 fails, use rules 2, 4 and 5 only, and write in the README that a kill can stay `running`. Not necessary: P2 passed.
