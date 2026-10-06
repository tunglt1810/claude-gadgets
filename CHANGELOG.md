# Changelog

All notable changes to the mods in this repository are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and each mod follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## flight-deck

### [Unreleased]

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
