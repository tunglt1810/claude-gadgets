# token-meter: design spec

## Goal
A Claude Code mod (hot-reloadable plugin) that draws one band above the prompt tracking the current session. One module runs on the CLI (`terminal`) and Claude Desktop (Code tab, `desktop`).

## Scope (agreed)
- Input, output and cache-hit tokens, accumulated per session.
- Total number of tool calls.
- Total time the model has been working (union of `turn.start` -> `turn.complete` intervals, aborted/error turns included; overlapping turns are not double counted; the clock runs live while a turn is active; `workMs` survives resume).
- Cache countdown with styling. Default TTL is 5 minutes; `userConfig.cacheTtl` (`5m` | `1h`) switches to 1 hour.
- Styling on the whole band, not only the countdown.
- Data survives session resume.
- Out of scope: detail pane, status line, marketplace, TTL auto-detection.

## Conventions
- Docs, code comments, identifiers and commit messages are in English (chat with the user stays Vietnamese).
- Toolchain: Bun (install and scripts), TypeScript 7, Biome (lint + format). Every dependency is pinned to an exact version (`bunfig.toml` sets `exact = true`, `bun.lock` is committed, CI/dev installs use `--frozen-lockfile`).
- Pinned versions at design time (checked against the registry on 2026-10-04): `typescript@7.0.2`, `@biomejs/biome@2.5.15`. No other runtime or dev dependency (the plugin runtime is the engine's; tests use `claude-code/testing`).

## Repo layout (monorepo, one plugin per mod)
```
claude-gadgets/
├── package.json  bunfig.toml  bun.lock  biome.json  tsconfig.base.json
├── mods/token-meter/
│   ├── .claude-plugin/plugin.json      # name, version, types, userConfig.cacheTtl
│   ├── hooks/{hooks.json, register.tsx}
│   ├── src/{usage,format,countdown,work,snapshot}.ts, band.tsx
│   ├── types/index.d.ts                # PluginState contract
│   ├── tsconfig.json
│   └── *.test.ts
├── docs/{specs,plans}/
├── .tmp/                               # gitignored scratch
└── README.md                           # how to load/develop a mod
```
A new mod is a new `mods/<name>/`. No shared `packages/` yet (YAGNI); extract one when a second mod needs shared code. `mods/*/.claude-plugin/types/` is engine-generated and gitignored.

Dev loop: `claude --plugin-dir mods/<name>` (hot reload; a symlink is watched at its target). Desktop: set `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Relative static `import`s between the plugin's `.ts`/`.tsx` files work; dynamic `import()` does not.

## Design
**Data**
- `turn.step` -> `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) is summed into totals; the main thread's step also sets `lastStepAt`.
- `tool.call` -> `tools += 1`.
- Cache hit % = `cache_read / (input + cache_read + cache_creation)`.
- Countdown = `lastStepAt + ttl - now`, ticked once a second by `$.clock.every` while the band matters.
- Work time: `turn.start` opens an interval (`active` counter, `busySince`), `turn.complete` closes it and adds to `workMs`.

**State:** `$.state` atoms for drawn values (`meter`, `now`), declared in `types/index.d.ts`.

**UI:** a `ui.render` hook on `{ component: 'AbovePrompt' }`, elements from `$.ui.resolve(e)`. Example: `↓12.4k ↑3.1k ⚡89% · 🔧14 · ⏱12:05 · ⏳3:42`.
- Countdown: green above 60s, yellow 15-60s, red and pulsing below 15s, dim with strikethrough once expired; plus a small progress bar.
- Cache-hit %: green >= 70%, yellow 40-70%, red < 40%.
- Work clock: blue, bold while a turn is running.
- One color table shared by both surfaces.

**Persistence / resume**
- After each `turn.step`, `tool.call` and `turn.complete`, write `{ totals, tools, lastStepAt, workMs }` to `$.store` under `session:<id>`.
- Every read/write compares `$.session.id()` with the id the atoms were loaded for and reloads from `$.store` on mismatch. This covers `--resume`, in-process resume and `/clear` without relying on `session.start`.
- To verify when implementing: whether `--resume` keeps the old id or issues a new one. If it issues a new one and totals are lost, take the target id from `session.end` (`e.resume.id`).
- After resume `lastStepAt` may be past the TTL, so the countdown shows "expired".

## Post-verification amendments
- Subagents: `turn.step` carries `agentId` (absent on main). Only main-thread steps update `lastStepAt` (subagents have their own caches). Totals include subagents. Sum `turn.step` only, never `turn.complete`.
- No blink: `Text` has no blink prop (only `strikethrough`, `bold`, `dimColor`, ...). Pulsing alternates `bold`/`inverse` per tick.
- `$.session.usage()` has no cumulative tokens (context, rate limits, cost only), so totals are accumulated from `turn.step`.
- README notes: a session using the 1-hour cache should set `cacheTtl=1h` (default stays `5m`).

- After review: a subagent's `turn.complete` (no `turn.start`, has `agentId`) is ignored by the work clock; state updates compute inside `update` so concurrent events do not overwrite each other; the band reads the stored snapshot when the live state belongs to another session; `lastStepAt` is the time the request was sent; `session.start` (re)starts the tick when the cache is still live (`--resume`, hot reload).

- Restyle (after seeing it on Desktop): Monokai Pro hex palette (`src/palette.ts`); no emoji (double width, misaligned, overlapped text), plain labels instead: `↓12.4k · ↑3.1k · hit 89% · tools 14 · work 12:05 · cache 3:42 ━━━━━━╌╌╌╌`; the old `░` bar drew as a gray block, now a thin `━` line (filled in the tone color, track `#403e41`); one non-wrapping row that drops parts (bar, hit, tools, work, out, in) until it fits `bodyColumns`.

- `↓` is every prompt token (`input + cacheRead + cacheWrite`): `input_tokens` alone is only the uncached remainder (a warm cache shows `↓16`). The band root is a single `Text` with nested `Text`s instead of a `Box` row, (kept as a single row). The extra blank row under the band is not caused by the tree: plain Ink renders every variant (Box row, nested Text) as exactly 1 line, and the engine's `AbovePromptSite` (`flexDirection: column`, `maxHeight`, no margin/padding) adds none. It is the engine's own spacing above the prompt rule.

- Grouping and icons (supersedes the plain-label format above): `↓12.5k ↑3.1k ◈ 89% │ ⌘ 14 ◷ 12:05 │ ◔ 3:42 ━━━━━━━━━━` = tokens │ activity │ cache. Icons are single-width, text-presentation characters (`◈` hit, `⌘` tools, `◷` work time, `◔` cache countdown; arrows for in/out), never emoji (those are double width and misaligned the row). Narrow widths drop, in order: bar, hit, tools, work, out, in; empty groups and their separators disappear.

- Labels (supersedes the icon-only format above): every metric is `icon label value` with identical spacing, input and output included: `↓ in 12.5k  ↑ out 3.1k  ◈ hit 89% │ ⌘ tools 14  ◷ work 12:05 │ ◔ cache 3:42 ━━━━━━━━━━`. Two spaces between metrics in a group.

- Final wording: input goes up to the server (`↑ in`), output comes back down (`↓ out`); the tool-call counter is labelled `calls`: `↑ in 12.5k  ↓ out 3.1k  ◈ hit 89% │ ⌘ calls 14  ◷ work 12:05 │ ◔ cache 3:42 ━━━━━━━━━━`.

- Cost and diff (the status line's figures, in a third group): `… │ ⌘ calls 14  ◷ work 12:05 │ $ cost 0.42  ± diff +120 -30 │ ◔ cache 3:42 ━━━━━━━━━━`. Cost is `session.measure`'s `cost.usd` (the engine's session total: stored as the latest figure, never summed). The plugin API does not expose the status line's `total_lines_added`/`total_lines_removed`, so the mod counts them itself from `tool.call` results, following the engine's rule as read from 2.1.289 (parity is not proven for an edit whose patch is empty): the `+` and `-` lines of `structuredPatch`, or every line of `content` when the patch is empty (a created file); failed and denied calls count nothing. This is not `git diff`: repeated edits add up, manual edits are not counted, a commit does not reset it. Drop order is now bar, diff, hit, calls, work, cost, out, in.

## Tests (`claude plugin test`)
- Usage accumulation across steps; `null` usage and missing fields.
- Token and duration formatting; cache-hit %.
- Countdown and cache-hit tone thresholds; expired/unknown states.
- Work time: single turn, overlapping turns, aborted turn.
- Reload after resume (same id and changed id).
- Band renders on `terminal` and `desktop`.

## Risks
- The plugin API is EARLY ACCESS and may change between releases.
- Claude Desktop may not draw `AbovePrompt` the same way as the terminal; check with a `surface: 'desktop'` test, then run it for real.
- TypeScript 7 is the native compiler; the engine-generated `tsconfig.json` and types must work with it. Verify in Task 0 and fall back to the engine's documented `tsc` setup if not.
