# claude-gadgets

Mods (hot-reloadable function-hook plugins) for Claude Code. One self-contained plugin per `mods/<name>/`. The plugin API is EARLY ACCESS: trust the generated typings over memory.

## Compatibility

- Built and tested against **Claude Code 2.1.291** (`claude --version`); the typings in use start with `// Written by Claude Code 2.1.291.`
- Bun 1.4.2 (not pinned in the repo).
- The plugin API may change between Claude Code releases without notice. After an update: let the engine rewrite `mods/<name>/.claude-plugin/types/` (load the mod once), run `bun run check`, then update the version on this line.
- Not verified on any other Claude Code version, and not yet run live on Claude Desktop.

## Commands

```sh
bun install --frozen-lockfile
bun run check       # lint + typecheck + validate + test; must be green before "done"
```

Load a mod: `claude --plugin-dir mods/<name>` (hot reloads on save). Desktop: `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`; it does not hot reload: type `/reload-plugins --force` in the prompt after a change.

## Conventions

- Docs, code comments, identifiers, commit messages and user-visible strings are English.
- Dependencies are pinned to exact versions (`bunfig.toml` `exact = true`); never add a range.
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

- No emoji in drawn text: they are double width and misalign the row. Use single-width characters. The one exception is the pane title: its row has no columns.
- Size a band to `e.props.bodyColumns` and keep it to one row; drop parts instead of wrapping.
- `AbovePrompt` is raised on terminal and desktop only; `Pane` on every surface.

### Desktop (each of these failed live once)

- A Button handle lives for one drawing: a redraw during a click drops the click. `ui.render` reads only the data it draws, and that data is written only when its JSON changes.
- Animate in a `Client` module with its own timer (`surface.every`), never by redrawing the pane.
- In a row next to a Button, draw every other cell as a `Client` too: a `Text` does not line up with a Button. Give each cell a fixed width.
- Text that must start below a Button's label is a Button too: a desktop draws a label after a margin of its own. Put words that belong together in one label: the font is not fixed-width, so cells of a fixed width stand apart.
- A click on a pane that does not hold the keys raises only `ui.focus`, not `ui.press`. Read the focus state before `next(e)`: landing the ring redraws the pane focused inside `next`.
- Before a screen change, call `$.ui.focus({ requestId, key })` for a button on the new screen; the ring is lost when its button leaves the screen.
- `$.ui.open` `rows`/`columns` are requests: desktop ignores them, and no API sets or reads the pane size.
- Debug with a log, not a guess: push events to a module array, write it to `$.store` in one call, and read `~/.claude/plugins/store/<name>_inline-*.json`.
