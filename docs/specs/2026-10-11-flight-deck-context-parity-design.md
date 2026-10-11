# flight-deck: context parity design spec

Status: design for version 0.9.0. It changes `2026-10-07-flight-deck-context-breakdown-design.md` (the context spec). Where the two specs disagree, this spec is correct. The styling rules are in `docs/design-system.md`.

## 1. Goal

The context screen of the pane shows the same numbers as the context window of Claude Desktop.

- The context length of the main loop uses the compaction window, not the window of the model.
- The context screen shows each row of the breakdown: the conversation, the overhead, the compact buffer, the free room and the deferred tools.
- The bar shows each large category in its own color.
- The mod keeps its own data: the carry cost, the dead weight and the growth of a turn.

The person set a compaction window of 400000 tokens with `/autocompact 400k`. On a model with a window of 1000000 tokens, Claude Desktop shows `226.9k / 400k (57%)`. Version 0.8.1 of the mod shows 23 percent for the same context.

This spec also removes the note about the cache read price of Sonnet 5.5 (section 7).

## 2. Scope

In scope:

- The context block of the agents screen and the context screen.
- The bar and its colors.
- The cache read price of Sonnet 5.5.

Out of scope:

- The band. It shows a context length only in an agent view.
- The context length of an agent. It keeps the window of the model. `$.session.usage` takes no agent id, so the mod cannot read the compaction window of a subagent (`autoCompactWindow`, new in Claude Code 2.1.296).
- A button that compacts the session. The person uses auto-compaction.
- The grid of `/context` (`gridRows`).

## 3. Terms

This spec adds these terms to section 3 of the context spec.

| Term | Meaning |
|---|---|
| compaction window | The window that the engine measures the context against: `breakdown.rawMaxTokens`. It is the window of the model, or a smaller count that a setting gives. |
| row | One entry of `breakdown.categories`. Its `kind` is `used`, `buffer`, `free` or `deferred`. |
| overhead row | A row of kind `used` whose name is not `Messages`. |
| room to compact | The count at which auto-compaction starts, less the context tokens. |

## 4. Data

### 4.1 Source

A live session gave these values on Claude Code 2.1.296 and on the engine 2.1.295 of Claude Desktop. The setting was `modelSettings.<model>.autoCompactWindow: 400000`.

| Field | Value |
|---|---|
| `context.window` | 1000000 |
| `breakdown.rawMaxTokens` | 400000 |
| `breakdown.autocompactSource` | `settings` |
| `breakdown.autoCompactThreshold` | 367000 |
| The row of kind `buffer` | 33000 |

- The two engines give the same fields. Thus the mod needs no check of `$.session.version()` for this change.
- `$.config.list()` has the `autoCompact` switch only. It does not have the compaction window.
- The setting is for one model. The mod reads the breakdown at each turn end, so a change of model changes the window of the next sample.

### 4.2 Window

The window of a context sample is `breakdown.rawMaxTokens`. If that field is absent or is not more than 0, the window is `context.window`.

This replaces the last paragraph of section 4.1 of the context spec. The percentage and the color of the main loop now use the compaction window. An agent keeps the window of its model.

### 4.3 Rows

A context sample keeps each row of the breakdown that has tokens, with its `name`, `tokens` and `kind`.

- The tokens of the conversation are the tokens of the `Messages` row. A sample with no `Messages` row uses the context tokens less the overhead.
- The overhead is the sum of the overhead rows. It is not more than the context tokens.
- The items of a row go by its name, as in section 4.2 of the context spec. One name is new: `MCP tools (deferred)` has the servers of the tools that are not loaded.
- The loaded tools of each server stay a separate list. The dead weight uses that list only.

### 4.4 State

`ContextSample` and `ContextView` change:

| Type | Change |
|---|---|
| `ContextSample` | `categories` becomes `rows`. Each entry has a `kind`. `window` holds the compaction window. |
| `ContextView` | `categories` becomes `rows`. Each entry has a `kind`, a `share` and a `carryUsd`. `toCompact` is new. |

A sample of the older shape (a hot reload) has no `rows`. The mod reads it as a session with no sample. The next turn end gives a new sample.

## 5. Calculations

All functions are pure and are in `src/context.ts`.

- `share` of a row is its tokens divided by the window, as a percentage with one decimal. A row of kind `deferred` has no share.
- `carryUsd` of an overhead row does not change: section 5 of the context spec. Each other row has no carry cost.
- `toCompact` is `autoCompactThreshold - tokens`, not less than 0. It is absent when auto-compaction is off.
- `turnsLeft` is `toCompact / perTurn`, rounded down. Its conditions do not change.
- The order of the rows is: each row of kind `used`, the costliest first, then `buffer`, `free` and `deferred`.

## 6. Drawing

### 6.1 Context block

The block keeps its three rows. The context length uses the compaction window, and the first row gets the room to compact (section 6.3).

```
[ context ]  ctx 226.9k/400k 57% · +3.1k/turn · 140k to compact
████████████████████████████████████████
overhead 52.2k · messages 174.7k · dead weight 11.6k
```

### 6.2 Bar

This replaces the color table of section 6.2 of the context spec. `docs/design-system.md` section 10 gets these rules.

The parts are in this order:

| Part | Color |
|---|---|
| `Messages` | `PALETTE.cyan` |
| `System tools` | `PALETTE.orange` |
| `MCP tools` | `PALETTE.green` |
| `Skills` | `PALETTE.yellow` |
| each other row of kind `used`, as one part | `PALETTE.dim` |
| compact buffer | the darker shade of `PALETTE.dim` (`darker`) |
| free room | `PALETTE.strip` |

- The first four parts are in the order of their tokens, the costliest first.
- A part with more than 0 tokens has one cell at least. The free room gets the cells that stay.
- The color of the context tone is on the context length only. The bar does not use it.
- A row with a different name is in the `dim` part.

### 6.3 Head row

```
ctx 226.9k/400k 57% · +3.1k/turn · 140k to compact · ≈45 turns
```

- `140k to compact` is the room to compact. `≈45 turns` replaces `≈45 turns to compact`.
- The parts after the context length are dim.
- A narrow row drops the turns first, then the growth, then the room to compact, then the counts of the context length.
- The window label shows the count of the window: `400k`, `200k` or `1M`.

### 6.4 Context screen

```
[ ← agents ]  context                              full  [ recount ]
ctx 226.9k/400k 57% · +3.1k/turn · 140k to compact · ≈45 turns
████████████████████████████████████████
──────────────────────────────────────────────────────────────────
overhead 52.2k · 13% of window · ≈$0.42 over 38 steps
  category                        tokens window(%) carry($)
  Messages                        174.7k     43.7%
▸ System tools                     15.9k      4.0%    ≈0.11
▸ MCP tools                        14.7k      3.7%    ≈0.19
▸ Skills                             10k      2.5%    ≈0.03
  System prompt                     4.9k      1.2%    ≈0.02
▸ Memory files                      4.1k      1.0%    ≈0.02
▸ Custom agents                     1.6k      0.4%    ≈0.01
  MCP server instructions             1k      0.3%    ≈0.01
  Autocompact buffer                 33k      8.3%
  Free space                      140.1k     35.0%
▸ MCP tools (deferred)            118.4k         —
  System tools (deferred)          24.4k         —
──────────────────────────────────────────────────────────────────
dead weight 11.6k
server                                       tools  tokens
figma-mcp-go                                    62    9.8k
```

- The table has each row of the sample, in the order of section 5.
- `window(%)` replaces `share(%)`. It is the share of the row in the window. For a row of kind `used`, its color is the color of the part of the bar that holds the row. For the compact buffer and the free room, the cell is dim: the colors of those parts are too dark for text. A row of kind `deferred` shows `—`, dim.
- `carry($)` has a value for an overhead row only. Each other row has an empty cell. `—` stays the text for a model with no price.
- A row with items is a Button with the mark `▸` or `▾`, as before. An item of `MCP tools (deferred)` shows the server and the number of its deferred tools.
- The `overhead` headline and the dead weight section do not change.

### 6.5 Terminal and desktop

Section 6.4 of the context spec applies. The new rows use the cells of the rows that the table has now. A person must examine the bar and the table on a live desktop.

## 7. Cache read price of Sonnet 5.5

Claude Code 2.1.296 prices a cache read of Sonnet 5.5 at $0.10 for each million tokens. The engine used $0.20 before. The price table of the mod has $0.10. Thus the engine and the mod agree.

The mod removes:

- `engineRead` from the price table in `src/price.ts`, and the comment that gives its source.
- `priceNote` and the `note` of a model row in the dashboard.
- `engineGap`: the function, the `Snapshot` field and its use in the `rest` row.

A stored snapshot can have an `engineGap` field. The mod ignores it.

## 8. Tests

Each test comes before its code.

- `src/context.test.ts`: the window of a sample, the rows and their order, `share` and `toCompact`.
- `src/context.test.ts`: the cells and the colors of the bar, the head row and its drop order.
- `src/price.test.ts`, `src/dashboard.test.ts`, `src/snapshot.test.ts` and `src/usage.test.ts`: no note, and no gap in the `rest` row.
- `hooks/register.test.ts`: the block and the screen on `['terminal', 'desktop']`, with a breakdown whose `rawMaxTokens` is less than `context.window`.

## 9. Documents

- `docs/design-system.md`: section 2.1 (the window of the main loop and the window of an agent) and section 10 (the bar).
- `README.md` and `docs/i18n/README.vi.md`: the context screen.
- `CHANGELOG.md`: version 0.9.0.
- `CLAUDE.md`: the compatibility line names Claude Code 2.1.296.

## 10. Known limits

- The context length of an agent uses the window of its model. A subagent with a smaller `autoCompactWindow` compacts before its percentage shows it.
- Claude Desktop keeps the engine 2.1.295 until its next update. That engine counts a cache read of Sonnet 5.5 at $0.20. The `rest` row of the dashboard holds the difference there.
- The colors of the bar go by the name of a row. A row that the engine gives a new name is in the `dim` part.
- The known limits of the context spec stay.
