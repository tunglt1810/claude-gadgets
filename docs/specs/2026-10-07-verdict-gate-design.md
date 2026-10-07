# verdict-gate: design spec

Status: version 0.1.0. Tested on Claude Code 2.1.292.

## 1. Goal

In auto mode, a safety classifier reviews each tool call that no permission rule decides. Sometimes the classifier gives no verdict. The engine then denies the call, and the model tries the same call again and again.

The mod stops that loop. It asks the user to decide, and it can keep the decision for the session.

## 2. Scope

In scope:

- A call that the engine denies because the classifier gave no verdict.
- A question to the user, with the whole call in view.
- Session rules that answer the question for later calls of the same type.

Out of scope:

- A call that the classifier judged unsafe. The denial stays.
- A permission rule in a settings file. `$.settings` has no write method, and a settings rule stops the review for good.
- A change to the permission mode.
- A run with no user (`claude -p`). The denial stays.

## 3. Terms

| Term | Meaning |
|---|---|
| call | One tool call of the model, with one `tool_use_id`. |
| no-verdict denial | A denial of the engine that contains a phrase of section 4.2. |
| judgment | A denial in which the classifier found the call unsafe. |
| input | The `input` that `tool.check` read for the call. A hook below the mod can change a call, so this is not always the input of `tool.call`. |
| question | The dialog that `$.ui.ask` shows. |
| rule | A tool name or a Bash command prefix that the user approved for the session. |
| simple command | A Bash command that has none of the characters of section 7.2. |

## 4. Detection

### 4.1 Conditions

The mod asks the question only when all four conditions are true:

1. `tool.check` returned `ask` for the call. Thus the mode's decider received the call.
2. The tool did not run. The engine raises `classic.PostToolUse` or `classic.PostToolUseFailure` for a tool that ran, before `tool.call` has its answer.
3. `next(e)` of `tool.call` returned `deny`, or `isError` with `text`.
4. That text is a no-verdict denial.

Condition 2 is necessary because a tool that ran can print the same phrases.

### 4.2 Phrases

The phrases come from the binary of Claude Code 2.1.292. The engine gives a plugin no code for the cause of a denial, so the mod reads the text.

A no-verdict denial has one of these phrases:

- `gave no verdict`
- `was not reviewed:`
- `auto mode could not evaluate`
- `auto mode cannot determine the safety of`
- `The API told auto mode's safety classifier`

A judgment has one of these phrases:

- `denied by the Claude Code auto mode classifier`
- `Permission for this action has been denied`
- `judged this action dangerous`

A rejection of the user in the permission dialog has one of these phrases:

- `The user doesn't want to proceed with this tool use`
- `The user doesn't want to take this action`

A text with a judgment phrase or a rejection phrase is not a no-verdict denial, also when it has a phrase of the first list.

## 5. Question

The text is `Auto mode did not review this <tool> call: <input>. Run it?`.

- The chip of the question is `No verdict`. It separates this question from a question of the model.
- The input is JSON. Thus a line break shows as `\n`.
- Each other character that is not printable ASCII shows as its code point, for example `\u{202e}`. A terminal hides or obeys a control character, and a letter of a different script can look like an ASCII letter.
- The question shows the input whole. The user approves only what the question shows.
- When the shown text is longer than 2000 characters, the mod asks no question and the denial stays.

## 6. Answers

| Answer | Result |
|---|---|
| `Run once` | The mod calls `next(e)` again. Its `tool.check` hook changes an `ask` to `allow` for that `tool_use_id`, when the input is the input that the question showed. A `deny` from a rule or a hook below the mod stays. |
| `Do not run` | The call returns `{ deny: 'The user refused this call. Do not issue it again.' }`. |
| The user dismisses the dialog, or no user is there | The denial stays. |

An approval is for one `tool_use_id` and one input. When the input of the second run is different, the denial stays. The mod removes the approval when the `tool.call` hook returns.

The mod shows one question at a time. A call that waits gets its question, or the match of a new rule, after the answer.

## 7. Session rules

### 7.1 Third answer

The question gets a third option between the two: `Do not ask again: <rule>`. This answer runs the call and adds the rule.

| Tool | Rule | Example |
|---|---|---|
| Bash | The prefix of the command (section 7.2). | `Bash(git push:*)` |
| Each other tool | The tool name. | `Read`, `mcp__gh__issue` |

When a Bash command has no prefix, the question has only the two options of section 6.

### 7.2 Bash prefix

A simple command has none of these characters: `;` `&` `|` `<` `>` `$` `` ` `` `(` `)` `{` `}` `\`, and no line break. Only a simple command has a prefix.

A command also has no prefix when it has a tab or a character that is not printable ASCII. The shell does not part words at such a character.

The prefix is the first two words, when all three conditions are true:

- The first word has no `=`.
- The first word is not a wrapper or a shell. A path before the name does not change this.
- The second word is a subcommand: it has only lowercase letters, digits and hyphens, and starts with a letter.

The wrappers and the shells are:

- `sudo`, `doas`, `env`, `command`, `exec`, `eval`
- `nohup`, `time`, `timeout`, `nice`, `ionice`, `xargs`, `watch`, `ssh`
- `sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`
- `npx`, `bunx`, `pnpx`, `uvx`

A command with no subcommand has no prefix. One word tells too little about what the command runs.

| Command | Prefix |
|---|---|
| `git push origin main` | `git push` |
| `bun run check` | `bun run` |
| `rm -rf build` | none |
| `bash -c "rm -rf x"` | none |
| `python a.py` | none |
| `sudo bash -c "echo hi"` | none |
| `npx cowsay hi` | none |
| `FOO=1 git push` | none |
| `git status && rm -rf x` | none |

### 7.3 Match

A rule applies to a call only when the call has a no-verdict denial (section 4.1). When the classifier gives a verdict, the rule does nothing.

A call matches a rule when the rule of the call (sections 7.1 and 7.2) is that rule. Thus a compound command matches no rule.

On a match, the mod asks no question:

1. It approves the call as `Run once` does.
2. It shows a toast: `verdict-gate ran <rule> with no review`.

The 2000-character limit does not apply to a match, because the user approved the rule.

### 7.4 Life of a rule

- The mod keeps the rules in memory, by `$.session.id()`.
- A different session id starts with no rules.
- A reload of the mod removes all rules.
- A new rule stays only when its first call got past the check. When the second run has a no-verdict denial again, the mod removes the rule.
- A subagent uses the rules of its session.

## 8. Layout

| File | Content |
|---|---|
| `hooks/register.tsx` | The `tool.check` and `tool.call` hooks, the hooks of the two classic events of section 4.1, and the maps of asked and approved calls. |
| `src/verdict.ts` | `isNoVerdict` and `question`. |
| `src/rule.ts` | `ruleOf` gives the rule of a call. |

The mod has no `$.state` value, so it has no types contract.

## 9. Tests

The test hooks stand for the engine. The `tool.call` hook asks `$.tool.check` first, as core does.

- Each phrase of section 4.2 is a no-verdict denial. A judgment and a tool error are not.
- `Run once` runs the call one time. The next call gets a new question.
- `Do not run` runs nothing and returns the deny text.
- A dismissed question, a judgment and a call longer than the limit keep the denial.
- A tool error with a phrase raises no question when `tool.check` returned `allow`, and when the tool ran after an `ask`.
- Each row of the table in section 7.2.
- The third answer runs the call. A later match runs with no question and shows the toast.
- A match longer than the limit runs.
- A compound command with a matching start gets a question.
- A different session id has no rules.
- A rule does not run a call that the classifier judged.
- The question shows the input of `tool.check`. An approval or a rule does not run a different input.
- An approval does not run a call that a rule below the mod denies.
- Calls at the same time get one question at a time.
- A rule is not kept when its first call did not run. It stays when that call ran and failed with a phrase.
- A hidden character shows as its code point. A wrapper and a character that is not printable ASCII give no rule.
- The question has the `No verdict` chip.

## 10. Checks in a live session

### 10.1 Done

A scratch mod recorded the events of headless sessions on Claude Code 2.1.292:

- A real call raises `tool.check` with its `tool_use_id`. The input has the fields of the tool, for Bash `command` and `description`.
- A hook below the mod can change the input. `tool.check` gets the changed input.
- A denial of the mode's decider (`dontAsk` mode) comes from `next(e)` as `isError` with the denial as `text`. No classic event comes before it.
- A tool that ran raises `classic.PostToolUse`, or `classic.PostToolUseFailure` when it failed, before `next(e)` gives its answer.
- A second `next(e)` in one `tool.call` hook runs the tool. The engine raises `tool.check` again with the same `tool_use_id`, and an `allow` from a hook lets the call run.

### 10.2 Open

The sessions did not get a no-verdict denial: the classifier answered each call. Do these checks when the classifier next gives no verdict:

1. The denial text contains a phrase of section 4.2.
2. After `Do not run`, the model does not issue the call again.
3. The dialog, the chip and the toast look correct on the terminal and on a desktop.

## 11. Known limits

- A new Claude Code release can change the phrases. Then the mod asks no question, and the denial stays.
- A deny after `next(e)` makes the engine write one dim line to the transcript.
- A no-verdict state can last: a classifier transcript that is too long gives no verdict for each call. During that time a rule runs each match with no review.
- Text that is not ASCII, such as Vietnamese, is hard to read in the question, because each such character shows as a code point.
- The list of wrappers is not complete. A wrapper that is not in the list gets a prefix.
- A tool rule is wide: `Write` runs each write. A Bash rule does not limit the words after the subcommand. The question shows the rule before the user approves it.
