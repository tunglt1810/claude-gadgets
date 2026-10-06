# flight-deck: agent context design spec

Status: design for version 0.5.0. It adds to `2026-10-04-flight-deck-design.md`. That spec stays the full spec of the mod.

## 1. Goal

The pane shows how full the context window of each agent is.

- The agents table has an expand button on each row. The button shows or hides a detail row.
- The detail row shows the model, the effort and the context length of the agent.
- The transcript screen shows the context length of the agent in view.
- A color shows the context percentage.
- The pane title has an icon. On the terminal, an empty row is between the title and the pane body.
- The band shows the cache hit percentage and the cache countdown as one group, after the tokens.

## 2. Scope

In scope:

- The context length of each subagent.
- The context window of a model, as far as a plugin can know it.
- The expand state of each row of the agents table.

Out of scope:

- A context length in the band above the prompt.
- The context length of the main loop. The status line of the engine shows it.
- A window that the mod cannot see. See section 4.3.

## 3. Terms

| Term | Meaning |
|---|---|
| context tokens | The input side of the latest step of an agent: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Output tokens are not included. |
| context window | The largest number of input tokens that the model of the agent accepts. |
| context percentage | `round(context tokens / context window * 100)`, kept between 0 and 100. |
| detail row | The row below an agent row that shows the model, the effort and the context length. |

The engine calculates `used_percentage` of the status line with the same formula (Claude Code 2.1.291, function `GPn` in the binary).

## 4. Data

### 4.1 Type

`AgentEntry` gets one optional field:

```ts
// The input side of the agent's latest step, and the window of the step's model.
context?: { tokens: number; window: number }
```

The registry holds the field. Thus the field stays available after `--resume`, and the pane gets it with no new data path.

### 4.2 Write

The `turn.step` hook writes the field for a step that has an `agentId`.

- `tuned()` in `src/registry.ts` gets a `context` parameter. It writes the model, the effort and the context in one update.
- A step with `usage: null` does not change the context of the entry.
- `parseRegistry` reads the field. It ignores a value that does not have two finite numbers.

### 4.3 Window

A new file, `src/window.ts`, holds three pure functions.

```ts
contextWindow(model: string, isDisabled1m: boolean): number
contextPct(c: { tokens: number; window: number }): number
contextTone(pct: number): 'ok' | 'warn' | 'danger'
```

`contextWindow` follows the resolver of the engine (Claude Code 2.1.291, function `gv` in the binary), in this sequence:

1. If `isDisabled1m` is true, the window is 200000.
2. If the model id contains `[1m]`, the window is 1000000.
3. If the model id, without the `claude-` prefix, starts with a prefix of the table below, the window is 1000000.
4. For all other ids, the window is 200000.

| Prefix | Models of the catalog |
|---|---|
| `opus-4-7`, `opus-4-8`, `opus-5` | Opus 4.7, 4.8, 5, 5.5 |
| `sonnet-5` | Sonnet 5, 5.5 |
| `fable-5` | Fable 5, 5.1 |
| `mythos-5` | Mythos 5, 5.1 |

The `turn.step` hook reads the environment variable `CLAUDE_CODE_DISABLE_1M_CONTEXT` with `$.env.get`. The values `1`, `true`, `yes` and `on` set `isDisabled1m`.

The mod cannot see these inputs of the engine. For them, the window can be incorrect:

- The beta header `context-1m-2025-08-07`.
- A server override of the window of `claude-sonnet-4-6`.
- A remote model catalog.

Not known: whether the `model` of a `turn.step` event keeps the `[1m]` suffix. The stored data of 28 agents has only three ids, and none has a suffix: `claude-haiku-4-5-20251001`, `claude-sonnet-5-5`, `claude-opus-5-5`. The table gives the correct window for these three ids.

### 4.4 Color

| Context percentage | Tone | Color |
|---|---|---|
| less than 50 | `ok` | `PALETTE.green` |
| 50 to 79 | `warn` | `PALETTE.yellow` |
| 80 or more | `danger` | `PALETTE.red` |

A model with a window of 1000000 compacts at approximately 967000 tokens. Thus the red tone starts before a compaction.

## 5. Agents table

### 5.1 Row

```
     agents                      runs      time
⣿  ▾ Explore · find window api      1   0:01:12
     sonnet-5-5 · high · ctx 182.4k/1M 18%
⣿  ▸ general-purpose · web search   0   0:00:41
  ⣿  ▸ Explore · child              1   0:00:09
```

- The expand button is between the mark and the name. Its label is `▸` (closed) or `▾` (open). Its key is `expand:<agentId>`.
- The width of the expand button does not change. The name column is narrower by that width and one gap.
- The name button does not change. It opens the transcript of the agent.
- The header row has an empty cell above the expand buttons. Thus the `agents` header starts above the names, and a desktop aligns the header with the rows.

### 5.2 Detail row

The detail row starts below the first character of the name. It has these parts, with ` · ` between them:

1. The model id without the `claude-` prefix and the date (`shortModel`). Dim.
2. The effort. Dim. Absent when the entry has no effort.
3. `ctx <tokens>/<window> <pct>%`. The color of section 4.4. `formatTokens` gives the two numbers.

Rules:

- The row is one row. When it is wider than the pane, the mod removes `<tokens>/<window>` first. Then it cuts the model.
- An entry with no context has no third part.
- An entry with no model and no context shows `no step yet`, dim.
- On a desktop, each part is a `Client` cell, as the other cells of the table are.

### 5.3 State

`PaneView` gets `expandedAgents: string[]`. It holds the ids of the agents whose detail row is open.

- `PaneAction` gets `{ kind: 'expand'; agentId: string }`. The action adds the id, or removes it when it is there.
- `focusAction` in `src/action.ts` gives this action for the element `expand:<agentId>`. A desktop click on a pane that does not hold the keys raises only `ui.focus`.
- The state stays when the person opens a transcript and goes back.
- The store does not hold the state. A pane state with no `expandedAgents` (a hot reload) reads as an empty list.

## 6. Transcript screen

The row below the title gets a last part:

```
claude-sonnet-5-5 high · 2 runs · ◷ 0:01:12 · ctx 182.4k/1M 18%
```

- The part is `ctx <tokens>/<window> <pct>%` with the color of section 4.4.
- An entry with no context has no such part and no separator before it.

## 7. Pane title

- The title is `🤖 Flight Deck`.
- The rule "no emoji in drawn text" of `CLAUDE.md` has one exception: the pane title. The title row has no columns, so a double-width character does not move a column.
- No other row of the pane or of the band uses an emoji.
- `PANE_TITLE` holds the title. `$.ui.open` and the first row of the terminal pane use it.
- On the terminal, one empty row is between the title row and the pane body. A desktop draws its own title, and its pane body does not change.

## 8. Band

The cache hit percentage and the cache countdown are one group. The group is the second group of the band, after the tokens.

Before:

```
↑ in 12.5k  ↓ out 3.1k  ◈ hit 1% │ ⌘ calls 14  ▸ agents 2  ◇ bg 1  ◷ work 12:05 │ $ cost 0.42  ± diff +120 -30 │ ◔ cache 3:42 ━━━━━━━━━━
```

After:

```
↑ in 12.5k  ↓ out 3.1k │ ◈ cache 1%  ◔ 3:42 ━━━━━━━━━━ │ ⌘ calls 14  ▸ agents 2  ◇ bg 1  ◷ work 12:05 │ $ cost 0.42  ± diff +120 -30
```

- The label of the percentage is `cache`, not `hit`. Its color does not change.
- Beside the percentage, the countdown is the clock icon and the time: `◔ 3:42`, `◔ expired`, `◔ --`. Its color, its pulse and its bar do not change.
- A narrow band removes the percentage before the countdown. The countdown then has its label again: `◔ cache 3:42`.
- The sequence in which a narrow band removes its parts does not change.
- The band of an agent view has the same groups.
- The stats row of the transcript screen shows `◈ cache 90%`. It has no countdown.
- The diff is the last part of the band, and the `agents` button is after the countdown.

## 9. Redraw

The context of an entry changes at each step of its agent. The agents table then draws again at each such step.

The dashboard of the same screen already draws again at each step. Thus the number of redraws on a desktop does not increase, and the risk of a lost click does not increase.

## 10. Tests

Write each test before its code. The test must fail first.

| File | Checks |
|---|---|
| `src/window.test.ts` | Each branch of `contextWindow`. The three known ids. The limits 49, 50, 79 and 80 of `contextTone`. `contextPct` at 0 tokens and above the window. |
| `src/registry.test.ts` | `tuned` writes the context. A call with no context keeps the old value. `parseRegistry` reads a good value and ignores a bad one. |
| `src/action.test.ts` | `focusAction` gives `expand` for `expand:<id>`. |
| `src/layout.test.ts` | The cache group is the second group: the percentage, then the countdown with no label. A band with no percentage shows `◔ cache 3:42`. |
| `hooks/register.test.ts` | On `terminal` and `desktop`: a step of an agent, then a press of the expand button, shows the detail row. A second press hides it. The transcript screen shows the context part. The terminal pane shows the title, then an empty row. |

`bun run check` must pass.

## 11. Release

- `plugin.json` version: 0.5.0.
- `CHANGELOG.md`: one entry.
- `README.md`: the pane section shows the expand button and the context length.
- `CLAUDE.md`: the UI section names the pane title as the one exception to the emoji rule.
- New screen captures in `previews/`, if the pane looks different.
