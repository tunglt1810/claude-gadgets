# flight-deck: cache break design spec

Status: design for version 0.7.0. It adds to `2026-10-04-flight-deck-design.md`. That spec stays the full spec of the mod. The styling rules are in `docs/design-system.md`.

## 1. Goal

The mod finds each cache break of the main loop. For each break it shows the cause and the cost.

- A cache break is a step that reads much less from the prompt cache than the step before it wrote or read.
- The pane has a new cache screen. It lists the breaks of the session: the time, the cause, the tokens that the API wrote again, and the cost.
- The band shows a mark after a break, with the cause.
- The person uses the list to stop the causes that are not necessary: a model change, a changed tool list, a changed system prompt.

## 2. Scope

In scope:

- The steps of the main loop.
- Eight causes: `compact`, `history`, `model`, `ttl`, `tools`, `prompt`, `context`, `unknown`.
- The list of the breaks of one session. It stays after a resume.

Out of scope:

- The cache of a subagent. A subagent has its own cache with a lifetime of 5 minutes, and its breaks are usual.
- A change to the behavior of the engine. The mod only reads.
- The price of the next cache miss, and a warning before the cache expires. That is TODO item 14.
- A comparison with earlier sessions. That is TODO item 20.
- The input schema of a tool. No API gives it to a plugin.

## 3. Terms

| Term | Meaning |
|---|---|
| prompt | The input side of one step: `input_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens` together (`contextTokens` in `window.ts`). |
| prefix | The prompt of the main step before this one. The API can serve it from the cache. |
| expected | The smaller of the prefix and the prompt of this step. |
| break | A main step whose cache read is less than half of the expected tokens. |
| rewritten | The expected tokens less the cache read of the step. |
| lost cost | The cost of the rewritten tokens as cache writes, less their cost as cache reads. |
| fingerprint | The hashes that the mod keeps of the system prompt sections, of the context blocks and of the listed tools. |
| listed tool | A tool whose schema is in the tool list of a request. A deferred tool is not a listed tool. |

## 4. Data

### 4.1 Sources

| Source | The mod reads |
|---|---|
| `turn.step` input | `model`, `messageCount`, `agentId`, and the time of the request (`$.clock.now()` before `next`). |
| `turn.step` result | `usage`: the three token counts of the prompt. |
| `session.compact` input | `trigger` and `agentId`. Its result gives `tokensBefore` and `tokensAfter`. |
| `prompt.compose` result | The sections of the system prompt: `id`, `scope` and `text`. The input gives `traits`. |
| `prompt.context` result | The blocks of the first user message: `name` and `text`. |
| `tool.describe` result | `isDeferred` of each tool. |
| `$.tool.list()` | The name and the description of each tool of the session. |

The four hooks on `session.compact`, `prompt.compose`, `prompt.context` and `tool.describe` change nothing. Each one returns the result of `next(e)` as it is. A failure of the mod's own record must not fail the event: the record is in a `try` block.

### 4.2 Fingerprint

The fingerprint has three parts. Each part is a map from a name to a hash of a text. The hash is a 32-bit string hash (`hashOf` in `breaks.ts`). The mod keeps no text.

| Part | When the mod reads it | Content |
|---|---|---|
| sections | At step 0 of a main turn: the last `prompt.compose` result before that step. | The hash of the text of each section, by its `id`. |
| context | At each `prompt.context` event. | The hash of the text of each block, by its `name`. |
| tools | Before each main step, from `$.tool.list()`. | The hash of the description of each listed tool, by its name. |

Rules:

- A `prompt.compose` event with the trait `analysis` or `teammate` gives no sections. The engine sends nothing for an `analysis` render.
- A tool is deferred when its last `tool.describe` result says so. A tool with no `tool.describe` result is deferred when it is an MCP tool (`mcp` of `ToolInfo`). Section 9 gives the reason.
- The mod keeps the fingerprint of the last main step and the fingerprint of the step before it. A cause compares the two.

### 4.3 State

The snapshot of the session (`Snapshot`) gets five optional fields. The store keeps them with the session id, so a resume in a new process has them.

| Field | Content |
|---|---|
| `lastPrompt` | Of the last main step with a usage: `tokens`, `model`, `messageCount`, `at`, and the fingerprint. It has `cause` when that step was a break. |
| `breaks` | The break entries, the oldest first. The list keeps the newest 50. |
| `breakCount` | The count of all breaks of the session, also of the entries that left the list. |
| `lostUsd` | The sum of the lost cost of all breaks of the session, also of the entries that left the list. |
| `deferred` | The names of the deferred tools that a `tool.describe` result gave. |

One break entry:

| Field | Content |
|---|---|
| `at` | The time of the request. |
| `cause` | One of the eight causes. |
| `detail` | One line of text. Section 5.2 gives it for each cause. |
| `rewritten` | Tokens. |
| `lostUsd` | The lost cost, or `null` for a model with no price. |

A module variable holds the compaction that came after the last main step: its `trigger` and its two token counts. The next main step reads it and clears it.

## 5. Calculations

All functions are in `src/breaks.ts`. They are pure and have unit tests.

### 5.1 Detection

`detect(last, step)` gives a break or `null`.

- With no `lastPrompt`, there is no break. The first step of a session has no prefix.
- `expected` = the smaller of `last.tokens` and the prompt of the step.
- There is no break when `expected` is less than 4,000 tokens. A short prompt can be below the minimum that the API caches.
- There is a break when the cache read of the step is less than 50 percent of `expected`.
- `rewritten` = `expected` less the cache read.
- The lost cost = `rewritten` × (the cache write price less the cache read price) ÷ 1,000,000.
- The two prices are those of the model of the step and of the cache lifetime of the main loop. The prompt of the step selects the rate (`price.ts`).

A step that adds a large tool result is not a break: its cache read is the full prefix.

### 5.2 Cause

`causeOf` gives the first cause of this table that applies.

| Order | Cause | Condition | Detail |
|---|---|---|---|
| 1 | `compact` | A compaction of the main loop came after the last main step. | `auto · 171.0k → 38.0k` (the trigger and the two token counts, when the result has them) |
| 2 | `history` | `messageCount` is less than that of the last main step. | `214 → 96 messages` |
| 3 | `model` | The model is not the model of the last main step. | `opus-5-5 → sonnet-5-5` (`shortModel`) |
| 4 | `ttl` | The time from the last main step is more than the cache lifetime of the main loop. | `idle 1:12:04` (`formatDuration`) |
| 5 | `tools` | The tools part of the two fingerprints is different. | `- Write`, `+ mcp__a__b`, or `Bash changed` |
| 6 | `prompt` | The sections part is different. | `memory changed` |
| 7 | `context` | The context part is different. | `claudeMd changed` |
| 8 | `unknown` | No condition applies. | `no change seen` |

Rules for the detail of causes 5, 6 and 7:

- A removed name has `- ` before it. An added name has `+ ` before it. A name with a different hash has ` changed` after it.
- The detail names the first difference. More differences give ` · +N more` after it.
- A part that one of the two fingerprints does not have gives no difference.

A model change also changes a section of the system prompt (section 9). The order of the table gives `model` for it.

## 6. Drawing

### 6.1 Band

The `hit cache` group gets one part after the countdown: `✗ <cause>`, in `red`.

```
↑ in 1.2M  ↓ out 48.1k │ ◈ cache 12%  ◔ 59:41  ✗ model │ ⌘ calls 212  ◷ 52:10 │ $ cost 3.21   [ ▸ agents 3 ]
```

- The part is present when the last main step with a usage was a break.
- The part is first in the drop order, before `bg`.
- The band of an agent view does not have the part.

### 6.2 Cache row of the agents screen

The agents screen gets one row below the context block: the `cache` button, then one cell.

```
[ cache ]  3 breaks · ≈$1.84 lost
```

- With no break, the cell is `no break`, dim.
- With a break, the cell is `<count> breaks · ≈$<lost> lost`, in `yellow`. One break gives `1 break`.
- The count is the count of all breaks of the session, also of the entries that left the list.
- The cell is a `Client` on a desktop, as each cell next to a Button.

### 6.3 Cache screen

```
[ ← agents ]

3 breaks · ≈$1.84 lost

time   cause                          rewritten   lost($)
14:02  model                             182.4k     ≈0.91
       opus-5-5 → sonnet-5-5
14:31  compact                            38.0k     ≈0.19
       auto · 171.0k → 38.0k
14:47  tools                             124.0k     ≈0.62
       - Write
15:10  ttl                               148.9k     ≈0.74
       idle 1:12:04
─────────────────────────────────────────────────────────
```

- The back button is `← agents` (`BACK`).
- The headline is bold. It has the text of the cell of section 6.2.
- The table follows the table rules of the design system. It has a dim lowercase header, number columns at the right, and a rule that closes it.
- `time` is the local time of the request, `HH:MM`, 5 cells wide. `rewritten` is 9 cells wide (`formatTokens`). `lost($)` is 8 cells wide: `≈` and `formatUsd`, or `—` with no price. `cause` takes the rest of the width.
- The cause is `yellow` for `ttl` and `compact`: the person can know these before they occur. Each other cause is `red`.
- The detail is a second row, dim. It starts below the cause.
- The newest entry is last.
- With no entry, the screen shows `No cache break yet.`, dim, and no table.
- A list that lost entries shows `<N> earlier breaks not shown`, dim, above the header.

### 6.4 Terminal and desktop

The layout is the same on the two surfaces. The cells use the `cell` and `rest` helpers of `pane.tsx`, as the dashboard does. The screen has no timer and no value that runs: a desktop draws it one time for each change of the list.

## 7. Actions

| Action | Effect |
|---|---|
| Press `cache` | The pane shows the cache screen. The focus goes to the back button. |
| Press `← agents` on the cache screen | The pane shows the agents screen. The focus goes to the `cache` button. |

`PaneView` gets `isCache`, as it has `isContext`. A session change sets it to false.

## 8. Tests

- `breaks.test.ts`: no break with no prefix, below 4,000 tokens, and at 50 percent. A break below 50 percent. A step with a large new tool result is no break. Each cause, the order of the causes, and each form of the detail. The lost cost at the two cache lifetimes and at the long rate of Haiku 5.5. The list keeps 50 entries and the sum keeps all.
- `layout.test.ts`: the `✗ <cause>` part, and its place in the drop order.
- `register.test.ts`, on `terminal` and `desktop`: a sequence of steps gives the entries on the cache screen. A session id round trip keeps them. The four hooks return the result of the engine with no change. The band shows the mark and removes it after a step that is not a break.
- `snapshot.test.ts`: a record of an older version has no break and no `lastPrompt`.

## 9. Spike

A throwaway mod logged the events of eight `claude -p` runs on Claude Code 2.1.293 (2026-10-08). The mod is not in the repository.

| Question | Result |
|---|---|
| When does `prompt.compose` fire? | One time before step 0 of each turn, and one time at the end of each turn with the trait `analysis`. It does not fire for each step. |
| Are the section hashes stable? | Yes. The 11 sections had the same hashes in four runs of one model, in different processes. |
| A model change | The cache read was 0 and the cache write was 35.1k. The section `heron_brook` had a different text. |
| A removed deferred tool (`NotebookEdit`) | `tools` of `prompt.compose` went from 26 to 25. The cache did not break (cache read 34.9k). |
| A removed listed tool (`Write`) | The cache read was 0 and the cache write was 35.1k. |
| The same tool back, in the cache lifetime | The older cache entry served the prompt (cache read 35.3k). |
| A deferred tool loaded with `ToolSearch` in a turn | The cache did not break. `$.tool.list()` did not change. |
| `prompt.context` | One time for each process. The hashes of `claudeMd`, `userEmail` and `currentDate` were stable. |
| `tool.describe` | 44 events for 26 tools in each process. 15 of the 26 tools were deferred. |

Thus:

- The sections come from `prompt.compose`, read one time for each turn.
- The tool list of `prompt.compose` and of `$.tool.list()` holds the deferred tools. A change of a deferred tool is not a cause. The mod must know which tools are deferred.
- A tool that comes back in the cache lifetime gives no break. The detection of section 5.1 agrees: it reads the cache read of the step.

## 10. Known limits

- A changed input schema of a tool, with the same name and description, gives `unknown`.
- The mod reads the sections at step 0. It thus does not see a system prompt that changes in a turn before the next turn. A break of a later step of that turn can give `unknown`.
- `prompt.compose` has no agent id. A background agent can raise it between the event of the main loop and step 0 of the main loop. The fingerprint then has the sections of that agent.
- After a hot reload of the mod, the engine does not raise `tool.describe` again in the session. The stored list of deferred tools and the MCP rule of section 4.2 replace it.
- The spike ran with `claude -p`. No MCP server connected or disconnected in it, and no desktop ran it.
- The first main step of a session that an earlier version stored has no prefix. Its break is not found.
- The lost cost is an estimate. It uses the listed prices, as each cost of the dashboard.
