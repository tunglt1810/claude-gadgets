# Marketplace and Claude Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person installs `flight-deck` and `verdict-gate` with `/plugin install`, and the two mods are ready for a submission to the Claude directory.

**Architecture:** The repository becomes a plugin marketplace: one file, `.claude-plugin/marketplace.json`, names the two mods by their relative paths. The mods do not move and their code does not change. A git tag for each mod gives the directory a ref and a commit to pin.

**Tech Stack:** Claude Code 2.1.296 (`claude plugin validate`, `claude plugin marketplace`, `claude plugin install`), Bun 1.4.2, git, `gh`.

**Spec:** None. The source is the section "Step 6: Share it" of <https://claude.dev/blog/getting-started-with-claude-code-mods/#step-6-share-it>.

**Assumption:** "Anthropic folder" is the Claude directory, to which a person submits a plugin at <https://claude.ai/directory/manage>. A marketplace in this repository is necessary for that submission. If the assumption is wrong, Tasks 1 to 4 stay correct and Task 6 changes.

## Facts found before this plan

- `claude plugin validate --strict` passes for each mod and gives no warning.
- Each mod is self-contained: no import leaves `mods/<name>/`.
- The only ignored path in a mod is `.claude-plugin/types/`, which the engine writes when it loads the mod.
- The repository `tunglt1810/claude-gadgets` is public, has the MIT license and has no git tag.
- An entry of the official marketplace has `name`, `description`, `author`, `source`, `category` and `homepage`. An entry of another repository has a `source` with `path`, `ref` and `sha`.
- `~/.claude/settings.json` loads the two mods from this repository through `CLAUDE_CODE_PLUGIN_DIRS`.
- The store file of a mod that loads from a directory is `flight-deck_inline-<hash>.json`.
- `README.md` line 30 says the default of `cacheTtl` is `5m`. `mods/flight-deck/.claude-plugin/plugin.json` says `1h`. The manifest is correct: its value comes from the source. Task 4 corrects the README.
- The session of the agent has `CLAUDE_CODE_PLUGIN_DIRS` in its environment. A `claude` command that the agent runs gets the variable, also after the key is removed from the settings file.
- `docs/i18n/README.vi.md` says it follows the commit `dda3edb`. `README.md` changed after that commit, in `58a02a8`.

## Global Constraints

- Work on the branch `feat/marketplace`. Do not push without the approval of the user.
- Do not change a file in `mods/<name>/hooks` or `mods/<name>/src`.
- Do not change the version of a mod: its behavior does not change.
- `bun run check` must be green at the end of each task.
- Docs, commit messages and manifest text are English, in ASD-STE100.
- Dependencies stay pinned. Add no dependency.
- Scratch files go in `.tmp/`.
- Tasks 3, 5 and 6 change things outside this repository. Get the approval of the user before each of them.

## Review Focus

- A plugin name that loads two times (from `CLAUDE_CODE_PLUGIN_DIRS` and from the marketplace): the install test must run with one source only. Task 3 owns this.
- The store file of an installed mod can have a different name from `flight-deck_inline-*.json`. Then the saved session data and `allowSend` do not carry over. Task 3 records the name and Task 4 puts it in the README.
- A desktop that runs an engine before 2.1.295: the installed mod must draw its pane there. Task 3 owns this.
- A person who installs from a tag gets the commit of the tag, not `main`. Task 5 puts each tag on a commit that has the marketplace file.
- The `cacheTtl` option has no value until the person sets it. The installed mod must then use the default of its manifest. Task 3 owns this.

---

### Task 1: Marketplace manifest

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Modify: `package.json` (script `validate`)

**Interfaces:**
- Produces: the marketplace name `claude-gadgets` and the plugin ids `flight-deck@claude-gadgets` and `verdict-gate@claude-gadgets`. Tasks 3, 4 and 6 use these names.

- [ ] **Step 1: Make the branch**

```sh
git switch -c feat/marketplace
```

- [ ] **Step 2: Add the check that fails**

In `package.json`, replace the `validate` script:

```json
"validate": "claude plugin validate --strict .claude-plugin/marketplace.json && claude plugin validate mods/flight-deck && claude plugin validate mods/verdict-gate",
```

- [ ] **Step 3: Run the check and see it fail**

Run: `bun run validate`
Expected: FAIL, because `.claude-plugin/marketplace.json` does not exist.

- [ ] **Step 4: Write the manifest**

Create `.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "claude-gadgets",
  "description": "Mods for Claude Code: a session flight deck and a gate for tool calls that auto mode denied without a verdict",
  "owner": {
    "name": "bez"
  },
  "plugins": [
    {
      "name": "flight-deck",
      "description": "Band tracking session tokens, tool calls, model working time and cache countdown, with a pane that shows each subagent's transcript",
      "author": {
        "name": "bez"
      },
      "source": "./mods/flight-deck",
      "category": "monitoring",
      "homepage": "https://github.com/tunglt1810/claude-gadgets/tree/main/mods/flight-deck"
    },
    {
      "name": "verdict-gate",
      "description": "Asks the user to run a tool call that auto mode denied without a verdict",
      "author": {
        "name": "bez"
      },
      "source": "./mods/verdict-gate",
      "category": "security",
      "homepage": "https://github.com/tunglt1810/claude-gadgets/tree/main/mods/verdict-gate"
    }
  ]
}
```

Each `description` is the same text as the `description` in the `plugin.json` of that mod.

- [ ] **Step 5: Run the check and see it pass**

Run: `bun run validate`
Expected: three lines `✔ Validation passed`.

If `--strict` gives a warning about a field, correct the field that the warning names. Do not remove `--strict`.

- [ ] **Step 6: Run the full check**

Run: `bun run fix && bun run check`
Expected: exit code 0.

- [ ] **Step 7: Commit**

```sh
git add .claude-plugin/marketplace.json package.json
git commit -m "feat: make the repository a plugin marketplace"
```

---

### Task 2: Plugin metadata for a listing

**Files:**
- Modify: `mods/flight-deck/.claude-plugin/plugin.json`
- Modify: `mods/verdict-gate/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the fields `homepage`, `repository` and `keywords`, which a listing shows.

- [ ] **Step 1: Add the fields to `flight-deck`**

In `mods/flight-deck/.claude-plugin/plugin.json`, add after `"license": "MIT"`:

```json
  "homepage": "https://github.com/tunglt1810/claude-gadgets/tree/main/mods/flight-deck",
  "repository": "https://github.com/tunglt1810/claude-gadgets",
  "keywords": ["mod", "tokens", "cost", "prompt-cache", "subagents", "context"]
```

- [ ] **Step 2: Add the fields to `verdict-gate`**

In `mods/verdict-gate/.claude-plugin/plugin.json`, add after `"license": "MIT"`:

```json
  "homepage": "https://github.com/tunglt1810/claude-gadgets/tree/main/mods/verdict-gate",
  "repository": "https://github.com/tunglt1810/claude-gadgets",
  "keywords": ["mod", "auto-mode", "permissions", "classifier"]
```

- [ ] **Step 3: Validate each mod with `--strict`**

Run: `claude plugin validate --strict mods/flight-deck && claude plugin validate --strict mods/verdict-gate`
Expected: two lines `✔ Validation passed` and no warning about `homepage`, `repository` or `keywords`.

If the validator refuses a field, remove that field from the two files. The marketplace entry has the `homepage`.

- [ ] **Step 4: Run the full check and commit**

```sh
bun run fix && bun run check
git add mods/flight-deck/.claude-plugin/plugin.json mods/verdict-gate/.claude-plugin/plugin.json
git commit -m "chore: add homepage, repository and keywords to the plugin manifests"
```

---

### Task 3: Install test from the local marketplace

This task changes `~/.claude/settings.json` and the installed plugins of the user. Get the approval of the user first.

**Files:**
- Modify (outside the repository): `~/.claude/settings.json`
- Create: `.tmp/install-test.md` (the results, not committed)

**Interfaces:**
- Consumes: `flight-deck@claude-gadgets`, `verdict-gate@claude-gadgets` from Task 1.
- Produces: the name of the store file of an installed mod. Task 4 writes it in the README.

- [ ] **Step 1: Remove the directory source**

Copy the value of `CLAUDE_CODE_PLUGIN_DIRS` from `~/.claude/settings.json` to `.tmp/install-test.md`. Then remove the key from the `env` block. Start no session with `--plugin-dir`.

The session of the agent keeps the variable. Thus the agent runs each `claude plugin` command of this plan with the prefix `env -u CLAUDE_CODE_PLUGIN_DIRS`. The user does Steps 3 and 4 in a new terminal and in a Claude Desktop that started again. The session of the agent cannot do them: it keeps the directory copies.

- [ ] **Step 2: Add the marketplace and install the mods**

```sh
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin marketplace add "$PWD"
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin install flight-deck@claude-gadgets --scope user
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin install verdict-gate@claude-gadgets --scope user
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin list
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin configure flight-deck@claude-gadgets
```

Expected: `claude plugin list` shows `flight-deck@claude-gadgets` at version 0.9.0 and `verdict-gate@claude-gadgets` at version 0.1.1. `claude plugin configure` shows the option `cacheTtl` as not set, with its default.

- [ ] **Step 3: Test on the terminal**

Start `claude` in a directory that is not this repository. Record each result in `.tmp/install-test.md`.

1. The band is above the prompt after the first turn.
2. `/agent-log` opens the pane. `context` and `cache` open their screens.
3. In auto mode, a tool call without a verdict opens the dialog of `verdict-gate`.

- [ ] **Step 4: Test on Claude Desktop**

Start Claude Desktop again and open a session in the Code tab. Record:

1. The band and the pane draw.
2. A press on `◆ agents N` opens the pane on the first click.

- [ ] **Step 5: Record the name of the store file**

```sh
ls ~/.claude/plugins/store/
```

Write the name of the new file of `flight-deck` in `.tmp/install-test.md`. If it does not start with `flight-deck_`, tell the user: the README pattern `plugins/store/flight-deck_*.json` is then wrong, and Task 4 corrects it.

- [ ] **Step 6: Choose the daily source**

Ask the user which source they want for daily work:

- The installed copy. The user updates it with `claude plugin marketplace update claude-gadgets`.
- The directory source, for development. Uninstall the two plugins and put `CLAUDE_CODE_PLUGIN_DIRS` back from `.tmp/install-test.md`.

Do what the user chooses. Do not keep the two sources together.

---

### Task 4: README

**Files:**
- Modify: `README.md` (section "Loading a mod", line 30)
- Modify: `docs/i18n/README.vi.md` (section "Nạp một mod", line 5)

**Interfaces:**
- Consumes: the marketplace name from Task 1 and the store file name from Task 3.

- [ ] **Step 1: Add the install section to `README.md`**

Put this section before `## Loading a mod`:

````markdown
## Install

Run these commands in Claude Code:

```text
/plugin marketplace add tunglt1810/claude-gadgets
/plugin install flight-deck@claude-gadgets
/plugin install verdict-gate@claude-gadgets
/reload-plugins
```

A mod starts when the plugins load again. If a mod does not show, start Claude Code again.

A mod is code that runs in Claude Code on your machine, with the access that Claude Code has. Read the source before you install it.

The mods are tested on Claude Code 2.1.296.
````

- [ ] **Step 2: Change the title of the section for development**

Change `## Loading a mod` to `## Loading a mod from a clone`. Add this sentence as the first line of the section:

```markdown
Use one source for a mod: the installed plugin or a directory, not the two together.
```

- [ ] **Step 3: Correct the default of `cacheTtl`**

Replace line 30:

```markdown
`flight-deck` option `cacheTtl` is `1h` (default) or `5m`. Set `5m` when your session uses the 5-minute prompt cache.
```

- [ ] **Step 4: Correct the store pattern if Task 3 found a different name**

Do this step only if the store file of the installed mod does not match `plugins/store/flight-deck_*.json`. In the section "Agents pane", replace that pattern with a pattern that matches the two names from Task 3.

- [ ] **Step 5: Commit the English README**

```sh
bun run fix && bun run check
git add README.md
git commit -m "docs: install from the marketplace"
git rev-parse --short HEAD
```

Keep the hash that the last command prints.

- [ ] **Step 6: Update the Vietnamese README**

In `docs/i18n/README.vi.md`:

1. Translate the section `## Install` as `## Cài đặt` and put it before `## Nạp một mod`. Keep the code block as it is.
2. Change `## Nạp một mod` to `## Nạp một mod từ bản clone` and translate the new first sentence.
3. Translate the corrected `cacheTtl` sentence and, if Step 4 changed it, the store pattern.
4. Run `git diff dda3edb HEAD -- README.md`. Translate each change that the Vietnamese file does not have.
5. In line 5, replace `dda3edb` with the hash from Step 5.

Apply the Vietnamese document rules: one idea per sentence, active voice, no semicolon.

- [ ] **Step 7: Commit**

```sh
bun run fix && bun run check
git add docs/i18n/README.vi.md
git commit -m "docs(i18n): install from the marketplace"
```

---

### Task 5: Publish and tag

This task pushes to GitHub. Get the approval of the user first.

**Files:** none.

**Interfaces:**
- Produces: the tags `flight-deck-v0.9.0` and `verdict-gate-v0.1.1` and their commit hash. Task 6 uses them.

- [ ] **Step 1: Open the pull request**

```sh
git push -u origin feat/marketplace
gh pr create --title "feat: plugin marketplace for the two mods" --body "Adds .claude-plugin/marketplace.json, the listing metadata of each mod and the install section of the README. The code of the mods does not change."
```

- [ ] **Step 2: After the user merges, tag the merge commit**

```sh
git switch main && git pull --ff-only
git tag flight-deck-v0.9.0
git tag verdict-gate-v0.1.1
git push origin flight-deck-v0.9.0 verdict-gate-v0.1.1
git rev-parse HEAD
```

Keep the full hash that the last command prints.

- [ ] **Step 3: Install from GitHub**

```sh
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin uninstall flight-deck@claude-gadgets
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin uninstall verdict-gate@claude-gadgets
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin marketplace remove claude-gadgets
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin marketplace add tunglt1810/claude-gadgets
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin install flight-deck@claude-gadgets --scope user
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin install verdict-gate@claude-gadgets --scope user
env -u CLAUDE_CODE_PLUGIN_DIRS claude plugin details flight-deck@claude-gadgets
```

Expected: the details show the version 0.9.0 and the GitHub marketplace as the source, not the local path.

The uninstall commands are necessary: the version is the same, and the engine can use the copy that it cached from the local path.

If the user chose the directory source in Task 3, Step 6, install nothing. Run only the `marketplace add` command and `claude plugin marketplace list`. The list must show the GitHub source.

---

### Task 6: Submission to the Claude directory

The user does this task: it needs their claude.ai account and it publishes to other people.

- [ ] **Step 1: Prepare the data**

Write `.tmp/directory-submission.md` with this content for each mod:

| Field | `flight-deck` | `verdict-gate` |
| --- | --- | --- |
| Repository | `https://github.com/tunglt1810/claude-gadgets.git` | the same |
| Path | `mods/flight-deck` | `mods/verdict-gate` |
| Ref | `flight-deck-v0.9.0` | `verdict-gate-v0.1.1` |
| Commit | the hash from Task 5, Step 2 | the same |
| Description | the `description` of its `plugin.json` | the same rule |
| Category | `monitoring` | `security` |
| Homepage | its `homepage` of Task 1 | the same rule |
| License | MIT | MIT |
| Images | `previews/preview-cli.png`, `previews/preview-cli-agent-dashboard.png`, `previews/preview-desktop.png` | none |

- [ ] **Step 2: Compare with the form**

The user opens <https://claude.ai/directory/manage> and reads the fields of the form. If the form asks for a field that the table does not have, add it to `.tmp/directory-submission.md` before the submission. `verdict-gate` has no image: if the form requires one, make a screenshot of its dialog and save it in `previews/`.

- [ ] **Step 3: Submit**

The user submits each mod and gives the result. After the directory accepts a mod, add one sentence that names the directory to the section `## Install` of `README.md`. Then update the Vietnamese README as in Task 4, Step 6.
