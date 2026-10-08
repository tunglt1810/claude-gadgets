# flight-deck: design system

This file collects the styling rules of `mods/flight-deck`. Each rule names its source file and symbol. The code is the authority. Where a spec disagrees with the code, this file follows the code and lists the difference in "Open points".

Source files are in `mods/flight-deck/src/` unless a path says otherwise.

## 1. Palette

`PALETTE` in `palette.ts` holds the colors. It is Monokai Pro (classic filter). Every surface uses the raw hex values.

| Name | Hex | Use |
|---|---|---|
| `fg` | `#fcfcfa` | Plain emphasis: the work time (`layout.ts`), the model id in the band of an agent view, an idle title (`pane.tsx`). |
| `dim` | `#727072` | Separators, an expired countdown, an idle agent mark, a share under 10%. |
| `strip` | `#403e41` | The background of a bar that lies over other rows (the sticky bar, `pane.tsx`). |
| `red` | `#ff6188` | Danger, a failed tool call, a stopped agent, `-removed` in a diff, an error text, a share of 50% or more. |
| `orange` | `#fc9867` | Counts: `calls`, `bg`, the agents button, the `◆ agent` mark. A share from 25% to 49%. |
| `yellow` | `#ffd866` | Cost (`$ cost`), a warning tone, a running tool call, a recent agent, a share from 10% to 24%. |
| `green` | `#a9dc76` | The `ok` tone, `+added` in a diff, a running agent, a done tool call. |
| `cyan` | `#78dce8` | `in` tokens (`↑ in`) and a prompt row in a transcript (`pane.tsx`, `item`). |
| `purple` | `#ab9df2` | `out` tokens (`↓ out`). |

Rule: draw a color from `PALETTE` only. Do not write a hex value in another place.

## 2. Tones

A dim cell uses the `dim` flag (`dimColor`). A color uses a `PALETTE` value.

### 2.1 Context percentage

Source: `contextTone`, `contextColor` and `contextPct` in `window.ts`.

The percentage is `tokens / window`, rounded, kept between 0 and 100. The window is the window of the model of the step (`contextWindow`): 1M for a model with a `[1m]` suffix or a native 1M id, 200k for the others.

| Percentage | Tone | Color |
|---|---|---|
| less than 50 | `ok` | `green` |
| 50 to 79 | `warn` | `yellow` |
| 80 or more | `danger` | `red` |

### 2.2 Cache hit

Source: `cacheHitTone` in `countdown.ts`. The band maps the tone to a color with `TONE` in `layout.ts`.

| Percentage | Tone | Color |
|---|---|---|
| 70 or more | `ok` | `green` |
| 40 to 69 | `warn` | `yellow` |
| less than 40 | `danger` | `red` |

### 2.3 Cache countdown

Source: `countdownTone` in `countdown.ts`. The pulse and the dim state are in `bandSegments` in `layout.ts`.

| Time left | Tone | Color |
|---|---|---|
| more than 60 s | `ok` | `green` |
| 15 s to 60 s | `warn` | `yellow` |
| less than 15 s | `danger` | `red`, with a pulse |
| zero or less, or no step yet | `expired` | `dim` |

- The pulse alternates bold and inverse each second (`Math.floor(now / 1000) % 2`). The terminal has no blink attribute.
- Only the `danger` tone pulses.

### 2.4 Cost share

Source: `shareColor` in `dashboard.ts`. The share is `sharePct`: the cost of a row over the session total, as a whole percent.

| Share | Color |
|---|---|
| 50 or more | `red` |
| 25 to 49 | `orange` |
| 10 to 24 | `yellow` |
| less than 10 | `dim` |

A row with no cost or no total has an empty share cell.

### 2.5 Agent status mark

Source: `TONE`, `END_MARK` and `agentMark` in `pane.tsx`.

| Status | Mark | Color |
|---|---|---|
| `running` | turning braille spinner | `green` |
| `idle` | `⣿` | `dim` |
| `stopped` | `⣿` | `red` |

### 2.6 Agent recency

Source: `recency` and `RECENT_MS` in `table.ts`. The colors are `RECENCY_TONE` in `pane.tsx`.

| State | Rule | Color of the runs and time cells |
|---|---|---|
| `active` | the agent is running | `green` |
| `recent` | the agent ended less than 5 minutes ago | `yellow` |
| `old` | all other agents | dim |

The name button is dim unless the agent is running. A Button takes no color, so the status is in the mark before it.

### 2.7 Tool call outcome

Source: `TOOL_MARK` and `TOOL_TONE` in `pane.tsx`.

| Outcome | Mark | Color | Label |
|---|---|---|---|
| running (no result) | turning braille spinner | `yellow` | normal |
| `done` | `✓` | `green` | dim |
| `failed` | `✗` | `red` | normal |

### 2.8 Cache break cause

Source: `causeColor` in `breaks.ts`.

| Cause | Color |
|---|---|
| `ttl`, `compact` | `yellow` |
| `history`, `model`, `tools`, `prompt`, `context`, `unknown` | `red` |

The cell after the `cache` button is dim with no break, and `yellow` with a break (`breaksHead` in `breaks.ts`).

## 3. Number formats

| Value | Function (file) | Rule | Example |
|---|---|---|---|
| Tokens | `formatTokens` (`format.ts`) | Under 1000: the whole number. From 1000: one decimal and `k`. From 1000000: one decimal and `M`. | `842`, `12.5k`, `1.2M` |
| Dollars | `formatUsd` (`format.ts`) | Two decimals. No sign. A value that is not finite or not positive gives `0.00`. | `0.42` |
| Duration | `formatDuration` (`format.ts`) | `m:ss`. With hours: `h:mm:ss`. A bad value gives `0:00`. | `12:05`, `1:02:09` |
| Countdown | `formatCountdown` (`format.ts`) | `m:ss`. Zero or less: `expired`. Unknown: `--`. | `3:42` |
| Context | `contextText` (`window.ts`) | Full: `ctx <tokens>/<window> <pct>%`. Short: `ctx <pct>%`. The window is `1M` or `200k` (`windowLabel`). | `ctx 84.2k/200k 42%` |

Other rules:

- `contextFit` (`window.ts`) gives the full text if it fits the room. Else it gives the short text. Else it gives nothing.
- An estimate has the prefix `≈`: a cost cell is `≈` and the value (`pane.tsx`, `board`), and the dashboard headline is `total ≈$` and the value. The band has no `≈`.
- A header names its unit: `cost($)` and `cost(%)` (`pane.tsx`, `board`).
- `—` (em dash) is a cost that is unknown (`pane.tsx`, `board`).
- `--` is a countdown with no step yet (`formatCountdown`).
- The runs cell is a bare count in the agents table. In the dashboard it is `runsText` (`dashboard.ts`): a count, `main`, or `main+<count>`.
- A cell that shows a running value pads to its width. `cellText` in `cell.ts` does the formatting for both surfaces.

## 4. Glyphs

Rule: use single-width, text-presentation characters only. Do not use an emoji. An emoji is double width and misaligns the row. The only exception is the pane title `🤖 Flight Deck` (`PANE_TITLE` in `hooks/register.tsx`): its row has no columns.

| Glyph | Use | Source |
|---|---|---|
| `↑ in`, `↓ out`, `◈ cache`, `⌘ calls`, `◇ bg`, `◷ work`, `$ cost`, `± diff`, `◔ cache` | Band labels | `LABEL` in `layout.ts` |
| `◔` | Countdown beside the percentage (no label) | `LABEL.clock` in `layout.ts` |
| `◆` | Mark of the band of an agent view (`◆ agent`) | `bandSegments` in `layout.ts` |
| `▸` / `▾` | Disclosure: closed / open. Used by the agents button, the expand button of an agent, and a tool call. | `layout.ts`, `pane.tsx` |
| `⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷` | Spinner frames of a running agent or tool. One frame each 120 ms. | `SPINNER`, `SPIN_MS` in `spinner.ts` |
| `⣿` | Mark of an ended agent | `END_MARK` in `pane.tsx` |
| `✓` / `✗` | Tool call done / failed. `✗ <cause>` is also the cache break part of the band. | `TOOL_MARK` in `pane.tsx`, `bandSegments` in `layout.ts` |
| `◷ ` | Work time of an agent in the pane. The agents table has no icon in its time column. | `CLOCK` in `pane.tsx` |
| `─` | Rule that closes a table | `line` and `rule` in `pane.tsx` |
| `─` × 12, dim | Short rule before each new prompt of a transcript | `TURN_RULE_LENGTH` in `pane.tsx` |
| `█` | Each cell of the context bar. The color shows the part. | `barSegments` in `context.ts` |
| `»` | The message button of an agent. | `controlLabels` in `control.ts` |
| `■` | The stop button of a running agent. `?` after it asks for the second press. | `controlLabels` in `control.ts` |
| `›` | The label of a message field. | `say` in `pane.tsx` |
| `← agents` | Back label | `BACK` in `pane.tsx` |

All agent marks and spinner frames are eight-dot braille glyphs. One font draws them at one size. Every mark has a width of two cells (`MARK_WIDTH`).

## 5. Separators

| Separator | Where | Source |
|---|---|---|
| ` │ ` (dim) | Between band groups | `SEP` in `layout.ts` |
| two spaces | Between the parts inside a band group | `build` in `layout.ts` |
| two spaces, no `│` | Before the agents button | `build` in `layout.ts` |
| ` · ` (dim) | Between the parts of a pane row: the detail row (model, effort, context), the title row of a transcript (model, runs, time, context), the agent title (`type · description`) | `SEP` in `detail.ts` and `pane.tsx`, `agentTitle` in `registry.ts` |

## 6. Band layout

Source: `bandSegments`, `GROUPS`, `DROP_ORDER` in `layout.ts`. The `Band` component is in `band.tsx`.

- A metric is `icon label value`.
- The groups, in order: `ctx`, then `in out`, then `hit cache break`, then `tools bg work`, then `cost diff`.
- `ctx` is present only in an agent view that has a context.
- The agents button is in no group. It is the last part, at the right end of the row. A gap takes the free room before it.
- The band is one row. It fits `columns`. It never wraps.
- A band that is too narrow drops parts in this order (first dropped first): `break`, `bg`, `diff`, `hit`, `tools`, `work`, `cost`, `out`, `in`, `ctx`, `agents`.
- `break` is `✗ <cause>` in `red`. It is present when the last main step was a cache break. The band of an agent view does not have it.
- The fit uses the target counts. A part does not come and go while a count runs.
- The countdown beside the percentage has no label: `◔ 3:42`. When `hit` is dropped, it has the label again: `◔ cache 3:42`.
- The band draws no bar after the countdown.
- The work time is bold while a turn is open.
- The cost part is yellow. The `diff` part is `+added` in green and `-removed` in red.
- A band without the agents button is one `Text` with nested `Text`. A band with the button is a `Box` of three parts: the text, a `Box` with `flexGrow`, and the button (`band.tsx`).
- The band of an agent view starts with `◆ <name>` (orange, bold) and the model id (`fg`). It has no `cost`, `work`, `agents` or `bg` (`SESSION_ONLY`). Its numbers do not run.
- The name takes the room that the band has left. A name with less than 8 cells of room is not shown. The mark then says `agent` (`MIN_NAME`).

## 7. Tables

Source: `agentTable` in `table.ts`, `board` and `AgentPane` in `pane.tsx`.

- The header row is dim and lowercase: `model cost($) cost(%) runs time` and `agents runs time`.
- The first column takes the rest of the width: `model` in the dashboard, the name in the agents table. Its text is cut when it is too long. The least width is `MIN_MODEL` (5) for the model and `MIN_NAME` (8) for the name.
- A number column has a fixed width in cells and is right-aligned. Its header ends at the same edge. Widths: `USD_WIDTH` 9, `PCT_WIDTH` 7, `RUNS_WIDTH` 7 in the dashboard, `TIME_WIDTH` 9.
- The agents table `runs` column is as wide as its longest value or its header.
- A gap of one cell is between columns (`gap={1}`).
- The `runs` and `time` columns end at the same right edge in the two tables.
- A rule closes the dashboard (`dash:rule`). It has the width of the pane.
- The dashboard has a bold headline cell above the table: `total ≈$1.42`.
- A dashboard row with a warning (`note` of `ModelRow`, from `priceNote` in `price.ts`) has a second row below it. The row is the warning text in `yellow`. It starts at the left edge and takes the width of the pane.
- A cell keeps its width when its value changes.
- Each row is one row. A row never wraps.
- The cache screen table has the columns `time cause rewritten lost($)`. Widths: `CLOCK_WIDTH` 5, `REWRITTEN_WIDTH` 9, `LOST_WIDTH` 8. `cause` takes the rest of the width. The detail of an entry is a second row, dim, that starts below the cause.
- A detail row below an agent has the same leading cells as the agent row (indent, mark width, expand width), so the two rows align.

## 8. Buttons and empty states

- A Button takes no color. A colored value is a cell after the Button. Examples: the status mark before the agent name, the context cell after the detail button.
- The terminal draws a Button as `[ label ]`: four cells of chrome (`BUTTON_CHROME`). Compute a width with it.
- A Button on the terminal is in a box as wide as its label, inside a box with `flexShrink` and `overflow="hidden"` (`oneRow` in `pane.tsx`).
- A back button names its destination: `← agents` (`BACK`).
- The agents button is `variant="primary"`. The `wrap` button is primary while wrap is on.
- A button that must look like text is `plain`. An ended agent and a done tool call are `dimColor`.
- An empty state is dim text: `No agents yet.`, `No messages yet.`, `Loading...`, `no step yet` (detail row).
- A denied transcript shows its reason in `red`.

## 9. Terminal and desktop

The layout does not change between surfaces. Only the drawing method changes. The table is from the first spec (section 11.8). The code follows it (`pane.tsx`, `cellClient.tsx`).

| Part of the layout | Terminal | Desktop |
|---|---|---|
| Content width | `bodyColumns` less 2 | `bodyColumns` |
| Title | The first row of the pane, bold | The title bar of the desktop pane |
| Side margin | One cell of padding at the left and at the right | None. The desktop pane has its own margin. |
| Column that takes the width that stays | A box that grows and shrinks. The layout cuts its text. | A box of a width in cells. The mod cuts its text. |
| Text at the right edge of a column | Spaces before the text | A box of the column width that puts the text at its end |
| Header of the agent names | A `Text`, as a cell | A button that does nothing. A desktop draws the label of a button after a margin of its own. |
| Rule | A box of one row that cuts a longer line | A box of the content width that cuts a longer line |
| Cell that is not a button | A `Text` in a box of the cell width | A `Client` of the cell width |
| Spinner, live time, cost that runs | The pane is drawn again on each tick | The `Client` of the cell has its own timer |

Desktop rules:

- A desktop font is not fixed-width. A count of characters does not give a width. Give each part a width in cells.
- Draw each cell next to a Button as a `Client`. A `Text` does not line up with a Button.
- Put words that belong together in one Button label. Separate cells of a fixed width stand apart.
- Build a header or a detail row from the same parts as its data row (indent, mark box, expand box). A desktop sizes a box and a padding in different units.
- A Button handle lives for one drawing. A redraw during a click drops the click. Animate in a `Client` with its own timer. Do not redraw the pane.
- The band of an agent view has no countdown, because a pane redrawn each second drops a click on a desktop (`statSegments`).
- A desktop shows no sticky bar. It scrolls by the pixel, and the offset is in rows.

Terminal rules:

- A dragged pane is drawn at its new width with the last tree, before the hook answers. Take no box width from `bodyColumns` there.
- A rule is a long line (`RULE_LENGTH` 600) in a `Box` with `height={1}` and `overflow="hidden"`.
- A scrolled transcript shows a sticky bar: a `Box` with `position="absolute"`, `top` equal to the scroll offset, and `backgroundColor` `PALETTE.strip`. It holds the back button, the agent mark, the name (bold) and the context.
- The engine draws the first 100,000 characters of a tree. A sticky row comes after the body. Keep the body below the limit (`lastItems`, `drawnChars` in `pane.tsx`).

## 10. Bar

Source: `barCells` and `barSegments` in `mods/flight-deck/src/context.ts`, `bar` in `mods/flight-deck/src/pane.tsx`.

The pane has one bar: the context window of the main loop. The band has no bar.

- The bar has 40 cells (`BAR_CELLS`). It takes no width from the pane.
- Each cell is the full block `█`. A second character (a shade, a lower block) comes from a different font or has a different height. It is then some pixels off from the block beside it.
- Only the color shows the parts:

| Part | Color |
|---|---|
| overhead | the color of the context tone |
| messages | the darker shade of that color (`darker`: each channel at 55 percent) |
| free room | `PALETTE.strip` |
| compact buffer | `PALETTE.dim` |

- An overhead of more than 0 tokens has one cell at least.
- The bar is one `Text` with a `Text` for each segment, in a `Box` with `height={1}` and `overflow="hidden"`.

## 11. Known duplicates in the code

These duplicates exist today. This file lists them and does not fix them.

- `TONE` `{ ok, warn, danger }` is declared in `layout.ts` and in `window.ts`. The values are the same: `green`, `yellow`, `red`.
- `BUTTON_CHROME` (value 4) is declared in `layout.ts` and in `pane.tsx`.
- The name `SEP` has two values. It is `│` (in ` │ `) in `layout.ts`. It is `·` in `pane.tsx`. The dot between the cells of a row is `dotted` in `cell.ts`.
- `TONE` in `pane.tsx` is a third value of the same name. It maps an agent status to a color, and it is not a duplicate of the other two.

## 12. Open points

- The first spec (section 10) lists the band drop order without `ctx`. The code drops `ctx` after `in`, before `agents`. The context spec (section 8.1) says `ctx` goes last "after the tokens". The code agrees with it.
