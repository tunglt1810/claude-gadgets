# Changelog

All notable changes to the mods in this repository are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and each mod follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## flight-deck

### [Unreleased]

### [0.6.0] - 2026-10-07

Tested on Claude Code 2.1.292.

#### Added

- The agents screen shows the context length of the main loop, a bar of what fills the window, and the tokens of the overhead and of the messages.
- A context screen shows the overhead by category, its estimated cost and the MCP servers that the session did not call.
- An open agent row has a `» message` button, which opens a field that sends a message to the agent, and a `■ stop` button, which stops a running agent on its second press.
- The transcript screen has the two buttons, also in the bar of a scrolled transcript, and a message field.

#### Changed

- A transcript has a short rule before each new prompt.
- A tool call of an inner loop of the engine no longer adds an agent with no name to the list.
- The runs of an agent count each run when it starts, a stopped run too.

### [0.5.1] - 2026-10-07

Tested on Claude Code 2.1.292.

#### Added

- A Vietnamese README: `docs/i18n/README.vi.md`.

#### Fixed

- Terminal: the pane no longer moves for one frame at each step of a drag that changes its width.
- A transcript of more than 100,000 characters keeps its newest items and the bar of a scrolled transcript.

### [0.5.0] - 2026-10-06

Tested on Claude Code 2.1.291.

#### Added

- Agents table: each row has an expand button (`▾`, `▸`). The detail row is open at first. The button hides or shows a detail row with the model, the effort and the context length of the agent: `sonnet-5-5 · high · ctx 182.4k/1M 18%`.
- Transcript screen: the row below the title shows the context length of the agent.
- The context length has a color for its percentage: green below 50, yellow from 50, red from 80.
- The context window of a model follows the resolver of Claude Code 2.1.291: 1M for Opus 4.7 and later, Sonnet 5 and later, Fable and Mythos, and for an id with `[1m]`. 200k for all other models, and for each model when `CLAUDE_CODE_DISABLE_1M_CONTEXT` is set.
- A press on the model and the effort of a detail row opens the transcript, as a press on the name does.
- A changed context length runs to its new value, in the detail row and on the transcript screen. A desktop cell runs with its own timer.
- Band of an agent view: it names the agent and shows its context length, `◆ Explore · find x claude-sonnet-5-5 high │ ctx 182.4k/1M 18% │ ...`. The band stays in view when the header of the transcript scrolls out of view.
- Terminal: a scrolled transcript keeps a bar at its top, with the back button, the agent and its context length. A desktop has no such bar, because it scrolls by the pixel.
- Terminal: an empty row is between the pane title and the pane body.

#### Changed

- The title of the pane is `🤖 Flight Deck`.
- Band: the `agents` button is the last part, at the right end of the row.

#### Removed

- Band: the bar after the cache countdown. The countdown is its time only.
- Band: the cache hit percentage and the cache countdown are one group, after the tokens: `◈ cache 80%  ◔ 4:50`. The label of the percentage is `cache`, not `hit`. A narrow band with no percentage shows `◔ cache 4:50`.

### [0.4.0] - 2026-10-06

Tested on Claude Code 2.1.291.

#### Added

- Dashboard: a changed `total` and a changed cost of a row run to the new value, as a count of the band does. The terminal draws each frame. A desktop cell runs with its own timer, so the pane is not drawn again.
- The title of the pane is `Flight Deck`. A desktop shows it in the title bar of the pane. The terminal shows it as the first row of the pane.
- Terminal: the pane has one cell of padding at the left and at the right.
- Spec: section 11.7 gives the layout of the pane for each surface. Section 11.8 gives how the terminal and a desktop draw it.

#### Changed

- Dashboard: it is as wide as the pane, and its last two columns are `runs`, then `time`, as in the agents table. The two tables end at one edge.

#### Fixed

- The band kept the old cost after a turn ended, while the dashboard showed the new cost. The band now takes the cost that the mod reads at the end of a turn.
- Desktop: a right-aligned cell did not end at the edge of its column, because the font of a desktop does not have a fixed width. The layout now puts the text at the edge.
- Desktop: the rule below the dashboard was shorter than the tables.
- Desktop: the `agents` header did not start where the names of the agents start.

### [0.3.2] - 2026-10-06

Tested on Claude Code 2.1.291.

#### Fixed

- The working time left out a run of an agent outside a turn of the main loop: a skill that runs in a subagent and is typed as `/skill`, or a background agent after the turn ended. A run of an agent now holds a work interval from its first step to its end.

#### Changed

- `docs/specs/2026-10-04-flight-deck-design.md` is now the full spec of the mod. It includes the agent pane spec and the agent stop detection spec, which are removed.

### [0.3.1] - 2026-10-06

Tested on Claude Code 2.1.291.

#### Fixed

- The band's `agents` count left out an agent with no spawn event (a skill that runs in a subagent).

### [0.3.0] - 2026-10-06

Tested on Claude Code 2.1.291.

#### Added

- Dashboard `side requests` row for the ledger cost outside the model rows (a prompt suggestion, compaction). It is not a model.
- Dashboard `advisor` row: the calls and the time of the advisor, with the model from the `advisorModel` setting. Its cost is an estimate: the growth of the ledger cost that no step holds, over the turns that called the advisor. The row shows `—` until the turn is over and the ledger holds it.
- Dashboard `cost(%)` column: each row's share of the total, in a color by its size.
- Cache lifetimes from the `promptCacheTtl` and `subagentPromptCacheTtl` settings.
- Cache lifetimes from the environment, in the engine's order: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL` and `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` before the settings, then `ENABLE_PROMPT_CACHING_1H`.
- Over a plan limit (a `five_hour` or `seven_day` window at 100%), the main loop is priced at the 5m cache lifetime.

#### Changed

- Model cost is priced per step at its loop's cache lifetime (1h or 5m).
- `cacheTtl` applies to the main loop only and defaults to `1h`. Subagents use 5m.
- Dashboard: the cost column is `cost($)` and the total reads `total ≈$`.
- Dashboard: the runs cell of the main loop's model shows `main`, or `main+N` when N agent runs used that model.
- Agents table: the header is `agents` and is built as a row is, so `runs` and `time` sit above their cells. The runs and the time of an agent are green while it runs and yellow for 5 minutes after it ends.
- Dashboard and agents table: the time column has no clock icon.
- Agent view: a dot parts the model, the runs and the working time below the title.

#### Fixed

- Countdown ignored the `cacheTtl` option before the first event.

### [0.2.0] - 2026-10-06

#### Added

- Agents pane with an agent table, agent view and transcript.
- Cost dashboard per model.
- Subagent and background task counts.
- Animated counts.

#### Changed

- Renamed from `token-meter` to `flight-deck`.

#### Fixed

- Desktop: a click that focuses the pane also presses the button.

### [0.1.0] - 2026-10-04

#### Added

- Band above the prompt: tokens, cache hit, tool calls, working time and cache countdown.
