# flight-deck: context breakdown design spec

Status: design for version 0.6.0. It adds to `2026-10-04-flight-deck-design.md`. That spec stays the full spec of the mod. The styling rules are in `docs/design-system.md`.

## 1. Goal

The pane shows what fills the context window of the main loop, and what that content costs.

- The agents screen has a context block below the dashboard. It shows the context length, a bar and three totals.
- A new context screen shows the overhead by category and the cost that the overhead carries.
- The context screen also shows the MCP servers that the session did not use.
- The person uses these numbers to remove an MCP server, a memory file or a skill that costs more than it gives.

## 2. Scope

In scope:

- The context window of the main loop.
- The overhead: the content that each request carries before the conversation.
- The dead weight: the loaded MCP tools of a server that the session did not call.
- The carry cost: an estimate of the cost of the overhead in this session.

Out of scope:

- A change to the band. The overhead does not change during a session, so the band does not show it.
- The context breakdown of a subagent. `$.session.usage` takes no agent id.
- The cost of each tool result in the messages. That is TODO item 7.
- A comparison with earlier sessions. That is TODO item 20.
- The dead weight of a skill or of a memory file. The mod cannot see when the model uses one.

## 3. Terms

| Term | Meaning |
|---|---|
| context sample | The part of one `$.session.usage({ breakdown })` reply that the mod keeps. |
| overhead | The tokens of each `used` category, without the `Messages` category. |
| messages | The context tokens less the overhead. |
| compact buffer | The window less the count at which auto-compaction starts. |
| dead weight | The tokens of the loaded tools of each MCP server that the session did not call. |
| carry cost | The overhead, multiplied by the steps of the main loop and by the cache read price. |

## 4. Data

### 4.1 Source

`$.session.usage({ breakdown })` gives `context.breakdown` (`SessionContextBreakdown`). The mod reads these fields:

| Field | Use |
|---|---|
| `context.tokens`, `context.window` | The context length and its percentage. `breakdown.totalTokens` replaces an absent `context.tokens`. |
| `breakdown.categories` | The category rows. A row counts when its `kind` is `used`. |
| `breakdown.mcpTools` | The tools of each MCP server. A tool counts when `isLoaded` is true. |
| `breakdown.memoryFiles`, `breakdown.skills`, `breakdown.agents` | The items below a category row. |
| `breakdown.autoCompactThreshold`, `breakdown.isAutoCompactEnabled` | The compact buffer. |

The window is the window of the model (`context.window`), not `breakdown.rawMaxTokens`. Thus the percentage and the color agree with the context length of an agent (`docs/design-system.md`, context tone).

### 4.2 Category names

The typings tell a plugin to use `kind`, not `name`. No `kind` separates the messages from the overhead. Thus the mod uses two sets of names:

- `Messages` is not part of the overhead.
- `MCP tools`, `Memory files`, `Skills` and `Custom agents` each have items.

A category with a different name stays a row with no items. A `Messages` row with a different name becomes part of the overhead. The spike of section 9 confirms the names.

### 4.3 When the mod reads the breakdown

A `full` breakdown sends one token-count request for each tool and each memory file. A `summary` breakdown sends none.

| Event | Detail |
|---|---|
| The main loop completes a turn | `summary` |
| The pane opens | `summary` |
| The context screen opens | `full` |
| The person presses `recount` | `full` |

The mod reads no breakdown in `ui.render`.

### 4.4 State

| State | Place | Contents |
|---|---|---|
| Context state | Atom `context` | The session id, the latest context sample, the base token count and the number of turns since the base. |
| `steps` | `Snapshot`, stored | The steps of the main loop that had a usage. |
| `mcpCalls` | `Snapshot`, stored | The wire names of the MCP tools that a loop called, each name one time. |
| `isContext`, `openCategories` | `PaneView` | The context screen is in view. The names of the open category rows. |

The context state is not stored. After a resume, the first `summary` fills it again.

## 5. Calculations

All functions are pure and are in `src/context.ts`.

- `overhead` is the sum of the category rows. It is not more than the context tokens.
- `messages` is the context tokens less `overhead`.
- `buffer` is `window - autoCompactThreshold`, not less than 0. It is 0 when auto-compaction is off.
- The base is the token count of the first sample. A sample with fewer tokens than the last sample is a compaction: it becomes the new base and the turn count becomes 0.
- `perTurn` is `(tokens - base) / turns`, rounded. It is absent when `turns` is 0.
- `turnsLeft` is `(autoCompactThreshold - tokens) / perTurn`, rounded down. It is absent when `perTurn` is not more than 0 or when auto-compaction is off.
- The carry cost of `n` tokens is `n * steps * readPrice / 1000000`. `readPrice` is the cache read price of the main model in `src/price.ts`. It is absent for a model with no price.
- A server is unused when `mcpCalls` has none of its loaded tools.
- `deadWeight` is the sum of the tokens of the unused servers.

The carry cost is an estimate: it uses the overhead of the latest sample for each step. Each drawn carry cost has the `≈` prefix.

## 6. Drawing

### 6.1 Context block

The block is below the dashboard on the agents screen. It is absent when the session has no context sample.

```
[ context ]  ctx 84.2k/200k 42% · +3.1k/turn · ≈26 turns to compact
██████▄▄▄▄▄▄▄▄▄▄▄▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▂▂▂▂▂▂
overhead 31.4k · messages 52.8k · dead weight 11.6k
────────────────────────────────────────────────────────
```

- `context` is a Button with the key `context`. It opens the context screen.
- The context length is a cell after the Button, because a Button takes no color. Its text is `contextText` and its color is `contextColor`.
- The parts after the context length are dim. A narrow row drops `turns to compact` first, then the growth, then the counts of the context length.
- `dead weight` is absent when it is 0.

### 6.2 Bar

The bar is a new element. `docs/design-system.md` gets these rules.

- The bar has 40 cells. Each cell is a lower block element (`▁` to `█`). These characters stand on one line on each surface. A shade character does not: version 0.6.0 used shades at first, and they were some pixels off.
- `█` (full height) is the overhead and `▄` (half height) is the messages. Both have the context tone color.
- `▁` (one eighth) is the free room and `▂` (two eighths) is the compact buffer. Both are dim.
- An overhead of more than 0 tokens has at least one cell.
- The bar is one `Text` with a `Text` for each segment. It is in a box of one row that cuts it. The box takes no width from `bodyColumns`.

### 6.3 Context screen

```
[ ← agents ]  context                      full  [ recount ]
ctx 84.2k/200k 42% · +3.1k/turn · ≈26 turns to compact
██████▄▄▄▄▄▄▄▄▄▄▄▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▂▂▂▂▂▂
────────────────────────────────────────────────────────
overhead 31.4k · 16% of window · ≈$0.42 over 38 steps
  category                      tokens share(%) carry($)
▸ MCP tools                      14.2k      45%    ≈0.19
▸ System tools                    8.1k      26%    ≈0.11
▾ Memory files                    4.0k      13%    ≈0.05
    Project/CLAUDE.md             2.9k
    User/CLAUDE.md                1.1k
  System prompt                   3.2k      10%    ≈0.04
▸ Skills                          1.9k       6%    ≈0.03
────────────────────────────────────────────────────────
dead weight 11.6k
server                                     tools  tokens
figma-mcp-go                                  62    9.8k
chrome-devtools                               29    1.8k
```

- The back Button has the key `back` and the label `← agents`. The `recount` Button has the key `recount`.
- The word after the title is the detail of the sample: `summary` or `full`. It is dim.
- `overhead` and `dead weight` are bold, as `total` is in the dashboard.
- The overhead table has the costliest category first. `share(%)` is the share of the category in the overhead, with the color of `shareColor`.
- A category with items is a Button with the key `cat:<name>`. Its mark is `▸` (closed) or `▾` (open). A category with no items has no mark, and its Button does nothing.
- An item row is dim. It shows the name and the tokens. An MCP server shows its number of loaded tools after its name: `figma-mcp-go · 62 tools`. A memory file shows its type and the last part of its path.
- `carry($)` shows `—` for a model with no price.
- The dead weight section is absent when no server is unused.
- A session with no context sample shows `No context yet.`, dim.

### 6.4 Terminal and desktop

The screen follows the surface table of `docs/design-system.md`:

- On a desktop, each cell is a `Client`, and the category column is a Button in a box of a width in cells. The header of the category column and each item row are Buttons that do nothing.
- On the terminal, the category column grows and shrinks, and the number columns have a fixed width.
- A person must examine the bar and the tables on a live desktop.

## 7. Actions

| Key | Action | Result |
|---|---|---|
| `context` | `{ kind: 'context' }` | The context screen opens. The focus moves to `back`. The mod reads a `full` breakdown. |
| `back` | `{ kind: 'back' }` | From the context screen: the agents screen opens and the focus moves to `context`. |
| `recount` | `{ kind: 'recount' }` | The mod reads a `full` breakdown. |
| `cat:<name>` | `{ kind: 'category', name }` | The category row opens or closes. |

A change of session closes the context screen and closes each category row.

## 8. Tests

- `src/context.test.ts` tests each calculation of section 5, the bar cells and the row cells.
- `src/snapshot.test.ts` tests a stored snapshot of version 0.5.1, which has no `steps` and no `mcpCalls`.
- `hooks/register.test.ts` tests the block, the screen, the actions and the dead weight on `['terminal', 'desktop']`.

## 9. Spike

A live session must answer these questions before the release. Task 1 of the plan does it.

1. The names of the categories of section 4.2.
2. Whether a `summary` breakdown has the `mcpTools`, `memoryFiles` and `skills` lists.
3. The difference between the tokens of a `summary` and of a `full` breakdown.
4. How long a `full` breakdown takes.

If a `summary` breakdown has no lists, the pane open of section 4.3 reads a `full` breakdown when the session has no `full` sample.

### 9.1 Results

Measured on Claude Code 2.1.292, in a headless session (`claude -p`) before its first response. The model window was 1000000.

1. The `used` categories are `System prompt`, `System tools`, `MCP tools`, `MCP server instructions`, `Custom agents`, `Memory files`, `Skills` and `Messages`. The `deferred` categories are `MCP tools (deferred)` and `System tools (deferred)`. `Autocompact buffer` is `buffer` and `Free space` is `free`. The names of section 4.2 are correct.
2. A `summary` breakdown has the `mcpTools`, `memoryFiles`, `skills` and `agents` lists, with tokens. Thus the pane open reads a `summary` breakdown.
3. `totalTokens` was 24584 for `summary` and 21102 for `full`. The `summary` estimate was 16 percent more.
4. `summary` took 9 ms. `full` took 851 ms, with 3 loaded MCP tools and 6 memory files.

Other results:

- `context.tokens` is absent before the first response. The mod then uses `breakdown.totalTokens`.
- The `full` breakdown had no `System tools` row. A category row is thus not always present.
- Two memory files can have the same type and the same file name. Their item rows then show the same name.
