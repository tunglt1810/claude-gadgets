# Rename token-meter to flight-deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mod `mods/token-meter/` becomes `mods/flight-deck/`, with the plugin name `flight-deck`, and keeps its stored session data.

**Architecture:** A pure rename. No behavior changes. The plugin name is a literal in four kinds of places: the manifest, the state contract, the atoms and the test mounts. All of them change in one commit, because a partial rename fails `validate` or splits the state. The stored data lives in a file that the engine names after the plugin. The user copies that file once, by hand, outside the repo.

**Tech Stack:** Claude Code plugin API 2.1.290 (early access), TypeScript, Bun, Biome, `claude-code/testing`.

**Spec:** None. The requirements are the request that started this plan. They are copied into Global Constraints.

## Findings (from the typings and the disk, 2.1.290)

- `$.store` is per plugin. The typings say: "This plugin's own key-value store". It is "A JSON file of the plugin's own under the user's Claude Code configuration directory".
- On disk the file is `~/.claude/plugins/store/token-meter_inline-b4df6b7c20b5.json`. The suffix is the first 12 hex characters of `sha256("token-meter@inline")`. It is not a hash of the directory path. So the file follows the plugin name, not the folder.
- The new file name is `~/.claude/plugins/store/flight-deck_inline-784537e69f23.json` (`sha256("flight-deck@inline")`, first 12).
- The file is a flat JSON object. Its keys are the store keys: `sessions`, `session:<id>`, `agents:<id>`. A copy under the new name is a full migration.
- A plugin cannot read another plugin's `$.store`. `$.fs.read` can read any path, but the file name scheme is not in the typings. A code migration would depend on an undocumented scheme. This plan does not add one.
- `userConfig` values are stored in `settings.json` `pluginConfigs[<plugin>].options`. For a `--plugin-dir` plugin the key is `<name>` or `<name>@inline`. So `cacheTtl` is keyed by plugin name too.
- `~/.claude/settings.json` has no `pluginConfigs` entry today. `cacheTtl` uses its default `5m`. Nothing to migrate. If the user sets it before the rename, the user sets it again after.
- `~/.claude/settings.json` sets `CLAUDE_CODE_PLUGIN_DIRS` to `/Users/bez/Workspace/repos/bez/claude-gadgets/mods/token-meter`.
- `CLAUDE.md`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `bunfig.toml` and `.claude/hooks/validate-mod.sh` have no mod name. They use `mods/*/` or `mods/<name>/`. They do not change.
- The images in `previews/` show the band only. They do not show the name. They do not change.

## Global Constraints

- English for code, comments, docs and commit messages.
- No behavior change. No new feature, no new test, no new dependency.
- The only string that changes is the mod name `token-meter` (and `token meter` in prose). Identifiers such as `meter`, `Meter`, `currentMeter` and the atom key `meter` stay.
- The command `/agent-log` keeps its name. The pane title `Agents` and the pane id `agents` stay. Reason: neither contains the mod name, and a user already knows them.
- `plugin.json` `description` stays. It does not contain the name.
- `plugin.json` `version` stays `0.1.0` unless the user decides otherwise (Open Questions).
- Use `git mv` to keep history.
- The executor never edits a file outside the repo. Task 3 lists the steps for the user.
- `bun run check` passes at the end of Task 1 and Task 2.
- Do not commit until the user asks.

## Decisions

- Historical docs stay as they are: `docs/specs/2026-10-04-token-meter-design.md`, `docs/specs/2026-10-06-token-meter-agent-pane-design.md`, `docs/specs/2026-10-06-agent-stop-detection-analysis.md`, `docs/plans/2026-10-04-token-meter.md`, `docs/plans/2026-10-06-token-meter-agent-pane.md`, `docs/plans/2026-10-06-agent-stop-detection.md`. They record what was built, under the name it had then. A rename in them rewrites history and breaks the link between a plan and its commits. This plan file is the record of the rename.
- The stored data migrates by a one-time file copy that the user runs (Task 3). A copy, not a move: the old file stays as a backup until the user deletes it.

## Review Focus

1. A stale `'token-meter'` literal in one `atom({ plugin, key })` or one `$.ui.mount({ plugin })`. It can compile against a stale contract and split the state, or make a test mount draw nothing. Guard: the grep in Task 1 Step 5 must find no match under `mods/`.
2. Ignored files left behind by `git mv`. `.claude-plugin/types/` is gitignored. If it stays in `mods/token-meter/`, `tsc` fails for `mods/flight-deck/`, and an empty old folder confuses the user. Guard: Task 1 Step 2.
3. A session that still runs with `--plugin-dir mods/token-meter` after the move. It loses its plugin folder and can write to the old store file after the copy. Guard: Task 0 closes every such session, and Task 3 copies only when none runs.
4. The store copy overwrites data. If `flight-deck` loads once before the copy, the engine creates the new file, and a blind `cp` replaces it. Guard: Task 3 Step 2 copies only when the target is absent.
5. The Desktop app keeps the old `CLAUDE_CODE_PLUGIN_DIRS` path. The mod does not load there, with no error in the repo. Guard: Task 3 Step 3 and Task 4 Step 3.

---

### Task 0: Preconditions

**Files:** none.

- [ ] **Step 1: Check the working tree is clean**

Run: `git status --short`
Expected: no output. Today the tree has the uncommitted work of `docs/plans/2026-10-06-agent-stop-detection.md` in `mods/token-meter/`. Finish and commit it first, or ask the user. Do not mix it into the rename commit.

- [ ] **Step 2: Ask the user to close every session that loads `token-meter`**

This includes the Desktop app, because `CLAUDE_CODE_PLUGIN_DIRS` loads the mod there. Wait for the user to confirm.

### Task 1: Move the mod and rename the plugin

**Files:**
- Move: `mods/token-meter/` to `mods/flight-deck/`
- Modify: `mods/flight-deck/.claude-plugin/plugin.json:2`
- Modify: `mods/flight-deck/types/index.d.ts:107`
- Modify: `mods/flight-deck/hooks/register.tsx:38,39,41,46,56,57`
- Modify: `mods/flight-deck/hooks/register.test.ts:45,439,742,870,898,960,1014`
- Modify: `package.json:13-15`

**Interfaces:**
- Produces: the plugin name `flight-deck`, the state ref `{ plugin: 'flight-deck', key: K }` for `K` in `meter`, `now`, `shown`, `agents`, `pane`, `spin`, and the root scripts that point at `mods/flight-deck`.

- [ ] **Step 1: Move the folder**

Run: `git mv mods/token-meter mods/flight-deck`

- [ ] **Step 2: Check nothing stays behind**

Run: `ls -A mods/token-meter 2>&1; ls mods/flight-deck/.claude-plugin/types/claude-code/index.d.ts`
Expected: `No such file or directory` for the first. The typings file exists for the second. If ignored files stay in `mods/token-meter/`, move `mods/token-meter/.claude-plugin/types` to `mods/flight-deck/.claude-plugin/types` with `mv`, then remove the empty `mods/token-meter/` with `rmdir` (not `rm -rf`).

- [ ] **Step 3: Replace the name in the mod**

Replace every `token-meter` with `flight-deck` in the five files listed above (one in `plugin.json`, one in `types/index.d.ts`, six in `register.tsx`, seven in `register.test.ts`, three in `package.json`). Change nothing else on those lines.

- [ ] **Step 4: Run the gate**

Run: `bun run check`
Expected: PASS. `typecheck`, `validate` and `test` now run on `mods/flight-deck`.

- [ ] **Step 5: Check no old name stays in live files**

Run: `git grep -n -i -e 'token-meter' -e 'token meter' -- mods package.json`
Expected: no output.

### Task 2: Update the live docs

**Files:**
- Modify: `README.md:9,24,27,31,45,60,67`
- Modify: `.claude/skills/new-mod/SKILL.md:3,18`

- [ ] **Step 1: Edit `README.md`**

- Lines 9, 27, 31: `` `token-meter` `` becomes `` `flight-deck` ``.
- Line 24: `claude --plugin-dir mods/flight-deck`.
- Line 45: `copy mods/flight-deck and trim it`.
- Lines 60 and 67: the alt text `token meter preview` becomes `flight deck preview`.

- [ ] **Step 2: Edit `.claude/skills/new-mod/SKILL.md`**

Line 3: `from the working flight-deck layout`. Line 18: `next to flight-deck`. These lines are instructions for a future mod, so they must name a folder that exists.

- [ ] **Step 3: Check no old name stays outside the history docs**

Run: `git grep -n -i -e 'token-meter' -e 'token meter' -- . ':!docs'`
Expected: no output. The matches under `docs/` are history (see Decisions).

- [ ] **Step 4: Run the gate and show the change**

Run: `bun run check && git status --short`
Expected: PASS. Status shows renames `R mods/token-meter/... -> mods/flight-deck/...` and `M` for `package.json`, `README.md`, `.claude/skills/new-mod/SKILL.md`. Do not commit. Report to the user and wait.

### Task 3: Manual steps for the user (outside the repo)

**Files:** none in the repo. The executor gives these steps to the user. The executor does not run them.

- [ ] **Step 1: Confirm no session runs the mod**

Close every Claude Code session and the Desktop app that load the mod.

- [ ] **Step 2: Copy the stored data under the new name**

```sh
cd ~/.claude/plugins/store
old=token-meter_inline-b4df6b7c20b5.json
new=flight-deck_inline-784537e69f23.json
[ -e "$new" ] && echo "STOP: $new exists" || cp -p "$old" "$new"
```

If the script prints `STOP`, `flight-deck` already loaded once and has its own file. Then decide: drop that file and copy, or keep it and lose the old numbers.

Optional check of the name rule before the copy: `printf '%s' 'flight-deck@inline' | shasum -a 256 | cut -c1-12` prints `784537e69f23`.

- [ ] **Step 3: Change the Desktop path**

In `~/.claude/settings.json`, in the `env` block, change `CLAUDE_CODE_PLUGIN_DIRS` from `/Users/bez/Workspace/repos/bez/claude-gadgets/mods/token-meter` to `/Users/bez/Workspace/repos/bez/claude-gadgets/mods/flight-deck`. Restart the Desktop app.

- [ ] **Step 4: Change the CLI command**

Use `claude --plugin-dir mods/flight-deck`. Update any shell alias or script that has `mods/token-meter`.

- [ ] **Step 5: Check the user config**

Run: `grep -n 'token-meter' ~/.claude/settings.json`
Expected: only the line from Step 3, before the change, and no match after it. A `pluginConfigs` entry for `token-meter` means `cacheTtl` was set. Then set it again for `flight-deck` with `/config`, and remove the old entry.

- [ ] **Step 6: Keep the old store file as a backup**

Delete `token-meter_inline-b4df6b7c20b5.json` only after Task 4 passes.

### Task 4: Live check

**Files:** none.

- [ ] **Step 1: Load the renamed mod**

Run: `claude --plugin-dir mods/flight-deck --resume <id>`, with `<id>` a session from the old store (the `sessions` key lists them).
Expected: the band shows that session's old numbers (tokens, calls, work, cost) at once, not zeros.

- [ ] **Step 2: Check the store file in use**

Do one turn. Then run: `ls -l ~/.claude/plugins/store/`
Expected: `flight-deck_inline-784537e69f23.json` has a new modification time. `token-meter_inline-b4df6b7c20b5.json` does not change. If the engine writes a file with another name, the name rule is wrong: stop and tell the user.

- [ ] **Step 3: Check the pane and the Desktop app**

Run `/agent-log`. Expected: the pane `Agents` opens and lists the agents of the resumed session. Open the Desktop app. Expected: the band shows there.

## Open Questions

1. Stored data: copy the old store file (this plan, Task 3 Step 2), or drop it and start from zero? Dropping loses the numbers of up to 50 past sessions on `--resume`. Nothing else breaks.
2. Version: keep `0.1.0`, or bump to `0.2.0` because the name and the store change?
3. README: add a short "Renamed from token-meter" note with the Task 3 steps, for other users of the repo? This plan leaves it out.
4. In-flight work: commit the agent-stop-detection changes before the rename (this plan assumes so)?
