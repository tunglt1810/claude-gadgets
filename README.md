# claude-gadgets

Mods (hot-reloadable plugins) for Claude Code. Each mod is a self-contained plugin under `mods/<name>/`.

## Mods

| Mod | What it does |
| --- | --- |
| `token-meter` | Band above the prompt: input/output/cache-hit tokens, tool calls, model working time and a styled prompt-cache countdown. Data survives resume. |

## Toolchain

Bun, TypeScript 7 and Biome, every dependency pinned to an exact version (`bunfig.toml` sets `exact = true`).

```sh
bun install --frozen-lockfile
bun run check      # biome + tsc + claude plugin validate + claude plugin test
```

`tsc` needs the engine's typings in `mods/<name>/.claude-plugin/types/claude-code/index.d.ts`. Claude Code writes them when it loads a mod; to type-check before the first load, copy the file the `plugin-authoring` skill names (it is gitignored).

## Loading a mod

- CLI: `claude --plugin-dir mods/token-meter` (hot reloads on save).
- Claude Desktop (Code tab): set `CLAUDE_CODE_PLUGIN_DIRS` to the absolute mod path in the `env` block of `~/.claude/settings.json`.

`token-meter` option `cacheTtl` is `5m` (default) or `1h`. Set `1h` when your session uses the 1-hour prompt cache.

## Adding a mod

Run the `/new-mod <name>` skill, or copy `mods/token-meter` and trim it. Rules the engine enforces: the `types` contract is self-contained (no imports), helpers that take `$` are module-level function declarations, and plugin files link with static `import` only.

## Layout

```
mods/<name>/{.claude-plugin/plugin.json, hooks/, src/, types/index.d.ts, tsconfig.json}
docs/specs/   design specs
docs/plans/   implementation plans
```

## Preview

### Claude Code CLI

![Claude Code CLI token meter preview](previews/preview-cli.png)

### Claude Desktop

![Claude Desktop token meter preview](previews/preview-desktop.png)