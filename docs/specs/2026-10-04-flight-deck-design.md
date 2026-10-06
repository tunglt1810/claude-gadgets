# flight-deck: design spec

Status: this spec describes version 0.3.2. It is the full spec of the mod. It includes the agent pane design and the agent stop detection analysis, which were two specs of their own before (2026-10-06). The git history has those files.

## 1. Goal

`flight-deck` is a Claude Code mod. It shows the cost and the activity of the current session.

- A band above the prompt shows tokens, tool calls, agents, working time, cost, changed lines and a prompt cache countdown.
- A pane shows a cost dashboard, the agents of the session and the transcript of each agent.

One module runs on the CLI (`terminal`) and on Claude Desktop (`desktop`).

## 2. Scope

In scope:

- Session totals that include each loop: the main loop, each subagent and each agent below a subagent.
- The numbers of one agent while its transcript is in view.
- An estimated cost for each model, and the cost that no model row holds.
- Data that stays available after `--resume`, after an in-process resume and after `/clear`.

Out of scope:

- A status line and a marketplace entry.
- An agent that started before the engine loaded the mod.
- The agents of other sessions.
- A change to the Desktop transcript viewer. The mod draws its own pane.

## 3. Compatibility and conventions

- The tests of the mod run against Claude Code 2.1.291 and Bun 1.4.2.
- The plugin API is EARLY ACCESS. A new release can change it without notice.
- Docs, code comments, identifiers and commit messages are in English.
- Each dependency has an exact version (`bunfig.toml` sets `exact = true`).
- `hooks/register.tsx` connects events to state. Pure logic is in `src/` and has unit tests that do not use the engine.
- `bun run check` runs the lint, the typecheck, `claude plugin validate` and the tests. It must pass before a change is complete.

## 4. Files

| File | Function |
| --- | --- |
| `hooks/register.tsx` | The event hooks, the state atoms, the timers and the store calls. |
| `src/usage.ts` | Token totals, cache hit percent, advisor calls and advisor cost. |
| `src/snapshot.ts` | The stored snapshot: empty value, defensive read, session index. |
| `src/work.ts` | Working time as a union of intervals. |
| `src/ttl.ts` | The prompt cache lifetime rule. |
| `src/price.ts` | The price table and the cost of a set of tokens. |
| `src/dashboard.ts` | The rows of the cost dashboard. |
| `src/countdown.ts`, `src/format.ts` | Countdown tones and number formats. |
| `src/layout.ts`, `src/band.tsx` | The band: segments, drop order, drawing. |
| `src/tween.ts` | The count animation. |
| `src/agents.ts` | The numbers of each agent and the agent view. |
| `src/registry.ts`, `src/tree.ts`, `src/table.ts` | The agent registry, its tree order and the table columns. |
| `src/transcript.ts`, `src/summary.ts`, `src/clip.ts` | Transcript items, tool summaries and line limits. |
| `src/pane.tsx`, `src/paneData.ts`, `src/cell.ts`, `src/cellClient.tsx` | The pane and its cells. |
| `src/palette.ts`, `src/spinner.ts`, `src/diff.ts`, `src/action.ts` | Colors, the spinner, changed lines, pane button actions. |
| `types/index.d.ts` | The types of the state and of the data. It has no imports. |

## 5. Events

The mod hooks these events. Each hook passes the event on with `next(e)`.

| Event | Effect |
| --- | --- |
| `session.start` | Load the session. Start the one-second tick when the cache is live. Register `/agent-log`. |
| `turn.start` | Open a work interval of the main loop. Set the start of the advisor cost growth. |
| `turn.step` | Add the usage to the totals, to the model and to the agent. Price the step. Count advisor calls. Count a new agent. Open a work interval for an agent. |
| `tool.call` | Count the call. Count changed lines. Count a background task. |
| `agent.spawn` | Count the agent. Add it to the registry with its type, description, name and parent. |
| `turn.complete` | Main loop: close the work interval, read the ledger, settle the advisor cost. Agent: close its work interval and count a run. |
| `prompt.submit` | A task notification with `killed`, `failed` or `completed` ends the agent and its work interval. |
| `session.measure` | Store the session cost. Settle the advisor cost between turns. |
| `command.run`, `ui.focus`, `ui.close`, `ui.render` | The pane and the band. |

Rules for the hooks:

- `turn.step` is a streaming event. The hook is `async function*` and uses `const res = yield* next(e)`.
- The updater computes each state change (`update($, atom, c => ...)`). Thus concurrent events do not overwrite each other.
- `ui.render` writes no state.
- `session.start` does not fire on `/clear` or on an in-process resume. Each hook compares `$.session.id()` with the id of the loaded data and loads again when they are different.

Facts about the events, from live probes on 2.1.288 to 2.1.291:

- A subagent raises `turn.step`, `tool.call` and `turn.complete` with an `agentId`. It raises no `turn.start`.
- A skill that runs in a subagent (`context: fork`) runs in the same session. It raises no `agent.spawn`.
- When the user types such a skill as `/skill`, the main loop raises no `turn.start`, no `turn.complete` and no `prompt.submit`.
- `session.measure` does not arrive in a fixed order relative to `turn.step`. It can arrive before or after the hook of a step counts that step.

## 6. Data

### 6.1 Snapshot

The mod stores one snapshot for each session in `$.store` with the key `session:<id>`.

| Field | Meaning |
| --- | --- |
| `totals` | `input`, `output`, `cacheRead`, `cacheWrite` tokens of all loops. |
| `tools` | The number of tool calls. |
| `lastStepAt` | The time when the main loop sent its last request. |
| `workMs` | The closed working time. |
| `costUsd` | The session cost from the engine ledger. |
| `added`, `removed` | The changed lines that the mod counted. |
| `agents`, `bg` | The number of agents and of background tasks. |
| `byAgent` | For each agent: its totals, tool calls, changed lines, last step time and parent id. |
| `byModel` | The tokens of each model. |
| `costByModel` | The estimated cost of each model, priced at each step. |
| `advisor` | `calls`, `ms`, `usd`, `base`, `model`, `pending`. See section 9.4. |
| `mainModel` | The model of the main loop. |

- The read of a stored snapshot is defensive. A field that is absent or not a number reads as zero.
- Live state stays after a hot reload. When the state has an older shape, the mod loads the snapshot again from the store.
- The store keeps the 50 most recent sessions.

### 6.2 Runtime state

The meter is the snapshot plus `sessionId`, `active`, `busySince` and `working`. The mod does not store these four fields.

Other atoms: `now`, `shown` (the count animation), `agents` (the registry), `pane` (the pane view), `paneData` (the data that the pane draws), `spin` and `ttls`.

### 6.3 Agent registry

The mod stores the registry with the key `agents:<sessionId>`. One entry for each agent:

| Field | Meaning |
| --- | --- |
| `id`, `parentId` | The agent id and the id of the agent that started it. |
| `type`, `description`, `name` | From `agent.spawn` or from `$.agent.list()`. |
| `model`, `effort` | From the latest step of the agent. |
| `status` | `running`, `idle` or `stopped`. |
| `runs` | The number of runs that ended with an answer. |
| `startedAt`, `endedAt` | The time of the first event and of the last end. |

## 7. Counts

- Tokens: the mod sums the `usage` of each `turn.step`. It never sums `turn.complete`.
- `in` is each prompt token: `input + cacheRead + cacheWrite`. `input_tokens` alone is only the part that the cache does not hold.
- Cache hit percent: `cacheRead / (input + cacheRead + cacheWrite)`.
- `calls`: one for each `tool.call` that the user or a rule did not deny.
- `diff`: the `+` and `-` lines of `structuredPatch`, or each line of `content` when the patch is empty. A failed or denied call counts nothing. This number is not `git diff`.
- `bg`: one for each successful tool call with `run_in_background: true`, and one for each successful `Monitor` call. An `Agent` call is not counted here.
- `agents`: one for each agent, at the first sign of it. The first sign is its `agent.spawn` or its first `turn.step`. The mod counts each agent one time.

## 8. Working time

Working time is the union of work intervals. `active` counts the open intervals, and `busySince` is the start of the union.

- `turn.start` opens an interval of the main loop. The `turn.complete` of the main loop closes it. The time of an aborted turn counts.
- The first step of a run of an agent opens an interval for that agent. The `turn.complete` of the agent closes it.
- A task notification of the agent also closes its interval, because a killed agent possibly raises no `turn.complete`.
- Intervals that overlap count one time. Thus an agent that runs in a turn of the main loop adds no time.
- A background agent that runs after the turn of the main loop adds its time.
- The clock runs live while an interval is open.

## 9. Cost

### 9.1 Sources

- The session total is `cost.usd` of `session.measure` and of `$.session.usage()`. It is the engine ledger. The mod stores the latest value and never sums it.
- The plugin API gives no cost for each model. The mod estimates it from the tokens of each step.

### 9.2 Price of a step

- `src/price.ts` has the first-party prices for each million tokens (2026-09-25). Update the table when the prices change.
- A cache read costs the `read` price of the model, or 0.1 times the input price.
- A cache write costs 1.25 times the input price for a 5m lifetime and 2 times for a 1h lifetime.
- The mod prices each step when it arrives, with the lifetime of its loop. The main loop uses `main`. Each other loop uses `agent`.
- A model that is not in the table has no price. Its row shows `—`.

For `claude-opus-5-5` on a 1h main loop, the estimate was equal to the engine ledger to 7 decimal places in two sessions.

### 9.3 Cache lifetime

The engine selects the lifetime in this order. The mod follows the same order, as far as a plugin can see it.

1. `FORCE_PROMPT_CACHING_5M` gives 5m for each loop.
2. `CLAUDE_CODE_PROMPT_CACHE_TTL` (main loop) and `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (each other loop).
3. The settings `promptCacheTtl` and `subagentPromptCacheTtl`.
4. `ENABLE_PROMPT_CACHING_1H` gives 1h.
5. The default. The main loop of a subscriber uses 1h, and each other loop uses 5m.

For step 5, the mod cannot read the account type. The option `cacheTtl` (`1h` by default) is the lifetime of the main loop. When a `five_hour` or `seven_day` rate-limit window is at 100 percent or more, the main loop uses 5m.

A plugin cannot see these inputs:

- The `cacheTtl` field in the frontmatter of an agent.
- An account that is not a subscriber. Set the option `cacheTtl` to `5m` for it.
- The remote flag that names the loops with a 1h lifetime.

### 9.4 Advisor

The API runs the advisor in a step. The `usage` of the step does not include the tokens of the advisor, and the plugin API does not give them. The engine ledger includes their cost at the price of the advisor model.

- `turn.step` gives the advisor calls in `serverToolUses`. The mod counts each call and adds its time (`endedAt - startedAt`).
- The label of the row uses the `advisorModel` setting.
- A call with no result has no time and no cost to settle.
- The cost is an estimate: the growth of the rest since the turn started. The rest is the ledger cost minus `costByModel`.
- `turn.start` stores the rest as `base`. A call with a result sets `pending`.
- The mod settles at the `turn.complete` of the main loop, where it reads the ledger with `$.session.usage()`. It also settles at a `session.measure` between turns and at the next `turn.start`.
- The mod does not settle while a turn of the main loop is open or while a step is in flight. The ledger can hold a step before the hook counts that step.
- A rest that did not grow means that the ledger does not hold the call yet. The call stays `pending`.

In two live sessions the estimate was 0.5 and 0.7 percent below the ledger. The cause: the API writes the cache for 5m after an advisor call, and the mod prices that write at 1h.

### 9.5 Side requests

The `side requests` row is the ledger cost that no model row and no advisor cost holds. It is not a model.

- A prompt suggestion is one known source. After each response, the engine sends a request to the model of the session. A live test showed a rest of zero with suggestions off, and a rest above zero with suggestions on.
- Compaction and other requests that are not a step of a loop are also in this row.
- The auto-mode permission classifier is not in this row. Its cost is not in the engine ledger.
- The row is absent when its value is below half a cent, or when a model row has no price.

## 10. Band

The band is one row above the prompt (`AbovePrompt`). Each metric is `icon label value`. A `│` separates the groups. The countdown beside the cache percentage has no label. In a narrow band with no percentage, it is `◔ cache 3:42`.

```
↑ in 12.5k  ↓ out 3.1k │ ◈ cache 89%  ◔ 3:42 │ ⌘ calls 14  ◇ bg 1  ◷ work 12:05 │ $ cost 0.42  ± diff +120 -30        [ ▸ agents 2 ]
```

- No emoji. Each drawn character has a width of one cell.
- The band fits `e.props.bodyColumns`. On a narrow width it drops parts in this order: bg, diff, hit, calls, work, cost, out, in, agents.
- The `agents` part is a button at the right end of the row, after the free room of the row. It opens and closes the pane. Its mark is `▸` for a closed pane and `▾` for an open pane.
- Cache hit: green from 70 percent, yellow from 40 percent, red below 40 percent.
- Countdown: `lastStepAt + lifetime - now`. Green above 60 s, yellow from 15 s to 60 s, red below 15 s with a pulse, dim when expired.
- The band draws no bar after the countdown.
- The work clock is bold while an interval is open.
- A one-second tick redraws the band while the cache is live or a turn is open.

### 10.1 Count animation

- The animated counts are `in`, `out`, `calls`, `cost` and the two `diff` numbers.
- One run has a duration of 400 ms and an ease-out curve. A frame tick of 60 ms redraws the band.
- A change during a run starts a new run from the value on the screen.
- A loaded session shows its stored counts immediately.
- The band uses the target values to select the parts that it drops.

### 10.2 Agent view

When the transcript of an agent is in view (`e.props.view.agentId`), the band shows that agent and each agent below it.

- The band starts with `◆ agent` and the model of the agent.
- It does not show `cost`, `work`, `agents` or `bg`. These numbers are available for the session only.
- The countdown uses the last step of that agent and the `agent` lifetime.
- The numbers are not animated.

## 11. Pane

The pane opens from the `agents` button and from the `/agent-log` command. Its title is `🤖 Flight Deck`. The pane has two screens.

Section 11.7 gives the layout of the pane. That layout is the same on each surface. Section 11.8 gives how each surface draws it.

### 11.1 Dashboard

The dashboard is above the agents table.

```
total ≈$1.42
model                         cost($) cost(%)    runs      time
opus-5-5                        ≈1.12     79%  main+1      4:22
advisor·opus                    ≈0.21     15%       2      0:15
side requests                   ≈0.08      6%
────────────────────────────────────────────────────────────────
```

- `total` is the engine ledger.
- One row for each model that ran a step or an agent. The row with the highest cost is first.
- `cost(%)` is the share of the row in the total. Its color is red from 50 percent, orange from 25 percent, yellow from 10 percent and dim below 10 percent.
- `time` of a model is the working time of its agents. The model of the main loop also has the working time of the session.
- `runs` of a model is the number of runs of its agents. The row of the main loop shows `main`, or `main+N` when N runs of agents used that model.
- The advisor row is after the model rows. It shows its calls in `runs` and `—` as cost until the mod settles the cost.
- The `side requests` row is last. It has no time and no runs.
- A changed `total` and a changed cost of a row run to the new value, as a count of the band does (section 10.1).
- A cost shows its value immediately in three cases: when the pane opens, when the session changes, and when its row is new.
- `cost(%)`, `time` and `runs` do not run. They show the new value immediately.

### 11.2 Agents table

- One row for each agent: a status mark, a button with the type and the description, the runs and the working time.
- An agent that the main loop started is at depth 0. A child agent is below its parent with one more indent level.
- The mark of a running agent is a green spinner. An idle agent has a dim mark, and a stopped agent has a red mark.
- The button of an agent that does not run is dim. A button takes no color.
- The runs and the time are green while the agent runs, and yellow for 5 minutes after it ends. After that they are dim.
- The header has the same parts as a row: a cell as wide as a mark, and a box as wide as the name.
- An empty registry shows `No agents yet.`

### 11.3 Transcript screen

A press on an agent opens its transcript. The mod reads it with `$.session.messages({ agentId })`. It does not store transcripts.

- A toolbar with a back button and a wrap button.
- A title row with the status mark, the type and the description.
- A row with the model and the effort, the runs and the working time, with `·` between them.
- A row with the tokens, the cache hit, the tool calls and the changed lines of the agent.
- The transcript items: `prompt`, `text`, `tool` and `answer`. The answer of a run is the input of a `SubagentHandback` tool use.
- A `tool` item is a button with one summary line. A press shows or hides its input and its result.
- A `tool` item of an Agent call has a second button that opens the child agent.
- The pane draws a maximum of 40 lines of an input and 40 lines of a result.
- The pane draws the newest 300 items of a long transcript.
- When the engine refuses the read, the pane shows the refusal text.
- An event of the agent in view reads its transcript again. The mod discards a result for an agent that is no longer in view.

### 11.4 Agent status

Only events and the engine list set the status.

- `agent.spawn`, `turn.step` and `tool.call` with an `agentId` set `running`.
- `turn.complete` with an `agentId` and the reason `answer` sets `idle` and adds one run. Another reason sets `stopped` and adds no run.
- A task notification with `killed` or `failed` sets `stopped`. One with `completed` sets `idle`.
- Each of these events merges `$.agent.list()` into the registry. The merge adds an agent that raised no `agent.spawn`. It fills absent fields. It stops a running agent that the list shows as `failed` or `killed`.
- When the mod loads a stored registry, it sets a running agent that the list does not show to `stopped`. The process of that agent ended.

### 11.5 Rules for Claude Desktop

Each of these rules comes from a failure on a live desktop.

- A button handle lives for one drawing. A redraw during a click drops the click. `ui.render` reads only the data that it draws, and the mod writes that data only when its JSON changes.
- An animation runs in a `Client` module with its own timer. The pane is not drawn again for it.
- In a row with a button, each other cell is a `Client` with a fixed width. A `Text` does not line up with a button.
- A box and a `Client` have widths in different units. Only parts of the same structure line up.
- A click on a pane that does not hold the keys raises `ui.focus` and no press. The mod runs the action of the button from `ui.focus`.
- `$.ui.open` `rows` and `columns` are requests. A desktop ignores them.

- The font of a desktop does not have a fixed width. A space is narrower than a digit, and a `─` is narrower than a cell.
- Thus a number of characters does not give a width on a desktop, and spaces do not align a text.

### 11.6 Why the status has no timeout

The mod does not use a timeout on the last event of an agent. An agent that waits for a permission gives the same signal as a dead agent. In one saved session, an agent showed no activity for 5.5 hours and was not dead. Its last record was a `Bash` tool use with no result.

The pane does not show `killed` and `failed` as two states. `stopped` is sufficient.

### 11.7 Layout

These rules are the layout of the pane. They are the same on each surface. A surface that cannot obey a rule has a defect.

- The pane has one content width. The dashboard, the rule and the agents table start at the same left edge and end at the same right edge.
- A table has columns of a fixed width, with a gap of one cell between two columns. One column takes the width that stays.
- The column that takes the width that stays is `model` in the dashboard and the name in the agents table.
- The text of a column of numbers ends at the right edge of the column. Its header ends at the same edge.
- The text of a column of names starts at the left edge of the column. A name that is too long is cut.
- The last two columns of the two tables are the same: `runs`, then `time`. Each has the same right edge in the two tables.
- The rule below the dashboard has the content width.
- Each row has a height of one line. A row does not wrap.
- A cell keeps its width when its value changes. A value that runs or counts does not move the cells after it.

### 11.8 How each surface draws the layout

The layout of section 11.7 does not change. Only the method changes.

| Part of the layout | Terminal | Desktop |
|---|---|---|
| Content width | `bodyColumns` less 2 | `bodyColumns` |
| Title | The first row of the pane, bold | The title bar of the desktop pane |
| Side margin | One cell of padding at the left and at the right | None. The desktop pane has its own margin. |
| Text at the right edge of a column | Spaces before the text | A box of the column width that puts the text at its end |
| Header of the agent names | A `Text`, as a cell | A button that does nothing. A desktop draws the label of a button after a margin of its own. |
| Rule | A `─` for each cell of the content width | A box of the content width that cuts a longer line |
| Cell that is not a button | A `Text` in a box of the cell width | A `Client` of the cell width |
| Spinner, live time, cost that runs | The pane is drawn again on each tick | The `Client` of the cell has its own timer |

- The terminal method uses a number of characters as a width. It gives the layout only because the terminal font has a fixed width.
- A test of the desktop method examines the elements and their properties. It cannot measure a position. A person must examine a change of the desktop method on a live desktop.

## 12. Tests

`claude plugin test` runs the tests. Tests import from `claude-code/testing`.

- Each file in `src/` has unit tests of its pure logic.
- `hooks/register.test.ts` tests the hooks through the band and the pane. The UI tests run in a loop over `terminal` and `desktop`.
- The test hooks are below the plugin and answer each event that the mod uses.
- A new behavior starts with a test that fails.

The tests include these cases:

- Usage with `null` and absent fields.
- The lifetime rule with each source.
- A step priced by the lifetime of its loop.
- The advisor cost with a measure in a turn and with a step in flight.
- An agent with no spawn event.
- A run of an agent outside a turn of the main loop.
- A killed agent.
- A session change, and state of an older shape.

## 13. Probe record

Throwaway probe mods ran in headless sessions (`claude -p`). These results are the base of the design.

Agent transcripts (2.1.289):

- `$.session.messages({ agentId })` gives all rows after the agent leaves `$.agent.list()`. The agent leaves the list at its `turn.complete`.
- After `SendMessage` starts an agent again, the call gives the full history. The agent keeps its id and raises a second `turn.complete`.
- After `--resume`, the session id stays the same and the data is available at `session.start`.
- A tool result is a `user` row with an empty `text`. Its data is in `toolResults`.
- One agent can run more than one time.

Agent stops (2.1.290):

- A killed subagent raises `turn.complete` with `reason: 'aborted'` and `isAborted: true`.
- `prompt.submit` fires for a task notification with `origin.kind: 'task-notification'`. The text is in `e.text`. The probe ran with a turn in progress only.
- `$.agent.list()` shows `killed` for a killed agent immediately, and for 30 s at a minimum.
- `classic.SubagentStop` has no status field. It cannot tell a kill from a normal end.
- `session.end` does not fire when the process dies.

Cost and events (2.1.288 to 2.1.291):

- The engine ledger includes the advisor at the price of the advisor model. In one session the ledger had 0.1737 dollars for it, and the mod estimated 0.1725.
- With prompt suggestions off, the rest was zero. With them on, two suggestions on `claude-haiku-4-5` cost 0.018 dollars.
- A skill with `context: fork` raised no `agent.spawn`, and the main loop raised no `turn.start`. The transcript of the skill is a sidechain of the same session.

Open questions, with no probe:

- What fires for an agent that fails with an API error.
- If a background agent continues after the user interrupts the main turn.
- If `$.agent.list()` shows `waiting` for an agent that waits for a permission.
- What a foreground Agent call gives when the user interrupts it.

## 14. Limits

- The mod counts an agent only when its events occur in this process. It counts the spawn of a teammate in its own terminal pane, but not its tokens.
- The typings do not say that an agent of a workflow raises `agent.spawn`. Its tokens are in the session totals, because its events have an `agentId`.
- The advisor cost includes a side request that arrives in the same turn before the mod settles.
- On a desktop, the color of a recent agent changes only when the pane is drawn again.
- Not verified live: a session over a plan limit.
- Not verified live: a background agent that runs at the same time as an advisor call.
- Not verified live: the rule of the dashboard on a desktop, and a cost that runs in a desktop cell.
- The overage rule and the default lifetime are estimates of account state that a plugin cannot read.
