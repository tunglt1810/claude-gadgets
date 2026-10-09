# claude-gadgets

Mods (hot-reloadable function-hook plugins) for Claude Code. One self-contained plugin per `mods/<name>/`. The plugin API is EARLY ACCESS: trust the generated typings over memory.

## Compatibility

- Built and tested against **Claude Code 2.1.295** (`claude --version`); the typings in use start with `// Written by Claude Code 2.1.295.`
- Bun 1.4.2 (not pinned in the repo).
- The plugin API may change between Claude Code releases without notice. After an update: let the engine rewrite `mods/<name>/.claude-plugin/types/` (load the mod once), run `bun run check`, then update the version on this line.
- Claude Desktop runs its own Claude Code (`~/Library/Application Support/Claude/claude-code/<version>/`), which is older than the CLI for some days after a release. An engine refuses the whole tree of a pane that has one element or prop it does not know, and the pane is then empty.
- Thus a mod stays backward compatible: put an API that is newer than the desktop's engine behind a check of `$.session.version()` (`src/engine.ts`), and keep the old drawing as the other branch. To check, run `"<that folder>/<hash>/claude.app/Contents/MacOS/claude" plugin test mods/<name>`. The tests answer `session.version` as the CLI's release (`engineBase`), so only the tests of the new branch fail there; a failure of another test is a tree that the desktop refuses.
- Not verified on any other Claude Code version.

## Commands

```sh
bun install --frozen-lockfile
bun run check       # lint + typecheck + validate + test; must be green before "done"
```

Load a mod: `claude --plugin-dir mods/<name>` (hot reloads on save). Desktop: `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`; it does not hot reload: type `/reload-plugins --force` in the prompt after a change.

## Conventions

- Docs, code comments, identifiers, commit messages and user-visible strings are English.
- The one exception: a translation of the README is `docs/i18n/README.<lang>.md`. `README.md` is the source. Each translation names the commit of `README.md` that it follows, and each README has the row of language links below its title.
- Dependencies are pinned to exact versions (`bunfig.toml` `exact = true`); never add a range.
- A changelog entry is one short sentence: what changed for the person who uses the mod. The cause and the method go in the commit message or the spec, not in the changelog.
- Specs go in `docs/specs/`, plans in `docs/plans/`, scratch files in `.tmp/` (never `/tmp`).
- TDD: write the failing test first, watch it fail, then implement.
- New mod: use the `/new-mod <name>` skill; add it to the root `package.json` scripts.

## Mod layout

`hooks/register.tsx` only wires events to state; pure logic lives in `src/` and is unit-tested without the engine.

## Engine rules (each of these failed `validate` or a test once)

- `types/index.d.ts` is self-contained: no imports, only `export type` plus `declare module 'claude-code'`. `src/` imports its types from `../types`.
- A function that receives `$` must be a module-level `function` declaration in the hooks module, not a closure inside `register`.
- `turn.step` is a streaming event: the hook is `async function*` and uses `const res = yield* next(e)`.
- `ui.render` never writes state. Write from events or timers, and compute inside the updater (`update($, atom, c => ...)`) so concurrent events do not overwrite each other.
- Plugin files link with static `import` only; `import()` does not load.
- `session.start` does not fire on `/clear` or in-process resume: key data by `$.session.id()` and reload on mismatch.
- A subagent raises `turn.complete` (with `agentId`) but no `turn.start`.

## Testing

- Tests import `test`, `expect`, `mock` from `claude-code/testing`; the test `$` has only event nouns (no `$.state`, `$.store`). Observe state through `$.ui.mount(...)` and persistence through a session-id round trip.
- Test hooks sit beneath the plugin and must answer the events used (`session.id` returns `{ value }`; `turn.step` is an async generator echoing `turnId`/`index`). Read a step's stream to the end before awaiting `.result`.
- Loop UI tests over `['terminal', 'desktop']`.

## Typings

`tsc` needs `mods/<name>/.claude-plugin/types/claude-code/index.d.ts` (gitignored). The engine writes it when it loads the mod; before that, copy the file the `plugin-authoring` skill names. Grep it for an event or prop rather than guessing.

## UI

The styling rules (palette, tones, number formats, glyphs, tables) are in [docs/design-system.md](docs/design-system.md). Read it before a change to drawn text.

- No emoji in drawn text: they are double width and misalign the row. Use single-width characters. The one exception is the pane title: its row has no columns.
- Size a band to `e.props.bodyColumns` and keep it to one row; drop parts instead of wrapping.
- `AbovePrompt` is raised on terminal and desktop only; `Pane` on every surface.
- The terminal draws a dragged pane at its new width with the last tree, before the hook answers. Take no box width from `bodyColumns` there: the part that takes the rest of a row has `flexGrow` and `flexShrink`, and a rule is a long line in a `Box` with `height={1}` and `overflow="hidden"`. A width from `bodyColumns` is wrong for one frame at each step of the drag.
- The terminal layout wraps a Button label to the width of its box. Put the Button in a box as wide as the label, inside a box with `flexShrink` and `overflow="hidden"`: the label stays on one row and the outer box cuts it.
- The engine draws the first 100,000 characters of a tree, in the order written, and it draws a later part over an earlier part. A row that lies over the body (a sticky row) is thus after the body, and a long body cuts it: keep the body below the limit.
- The engine scrolls a pane as one tree and has no sticky row. A row that stays in view is a `Box` with `position="absolute"` and `top` equal to `e.props.scroll.offset`. The engine moves the window when the `ui.scroll` hook returns and draws the pane later: store the event's offset, wait for the drawing, then call `next(e)`, or the row is gone for one frame. Terminal only: a desktop scrolls by the pixel and the offset is in rows.

### Desktop (each of these failed live once)

- A Button handle lives for one drawing: a redraw during a click drops the click (`ui_press not handled` in `~/Library/Logs/Claude/claude.ai-web.log`), and the second click lands. This applies to the band too: on a desktop its text is a `Client` (`src/bandClient.tsx`) and its hook reads no value that a timer writes. `ui.render` reads only the data it draws, and that data is written only when its JSON changes.
- Animate in a `Client` module with its own timer (`surface.every`), never by redrawing the pane.
- A desktop unmounts every `Client` of a mod (`flooded the page with messages`) when they send more than 400 messages in one second. A drawing sends one, a `setState` two more, a new timer one. A `Client` that does not change sets no state; a timer reads `surface.state` and sets it only while its cell changes, because the props of an instance change (an agent ends) and the timer stays.
- In a row next to a Button, draw every other cell as a `Client` too: a `Text` does not line up with a Button. Give each cell a fixed width.
- Text that must start below a Button's label is a Button too: a desktop draws a label after a margin of its own. Put words that belong together in one label: the font is not fixed-width, so cells of a fixed width stand apart.
- A click on a pane that does not hold the keys raises only `ui.focus`, not `ui.press`. Read the focus state before `next(e)`: landing the ring redraws the pane focused inside `next`.
- Before a screen change, call `$.ui.focus({ requestId, key })` for a button on the new screen; the ring is lost when its button leaves the screen.
- `$.ui.open` `rows`/`columns` are requests: desktop ignores them, and no API sets or reads the pane size.
- Debug with a log, not a guess: push events to a module array, write it to `$.store` in one call, and read `~/.claude/plugins/store/<name>_inline-*.json`.
