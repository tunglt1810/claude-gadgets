# Agent Stop Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agents pane of `token-meter` shows a killed, failed or aborted subagent as `stopped` (`×`, red), not as `running`.

**Architecture:** A third status `stopped` in the registry. Five signals set it, in the precedence of the spec. All the logic is pure reducers in `src/registry.ts`. `hooks/register.tsx` only connects the events.

**Tech Stack:** Claude Code plugin API 2.1.290 (early access), TypeScript, Bun, `claude-code/testing`.

**Spec:** `docs/specs/2026-10-04-flight-deck-design.md` (sections 11.4, 11.6 and 13). The analysis was a spec of its own before.

## Probe results (2.1.290, `.tmp/stop-probe/`, run with `claude -p`)

- P1: a subagent killed with `TaskStop` raises `turn.complete` with its `agentId`, `reason: 'aborted'`, `isAborted: true`, 18 ms after the call.
- P2: the kill notification raises `prompt.submit` with `origin.kind: 'task-notification'`. It arrives inside the running main turn (`turnId` set), at the end of the next main tool call (6 s later in the probe). `e.text` contains `<task-id>ID</task-id>` and `<status>killed</status>`.
- P3: `$.agent.list()` shows `killed` at once and for at least 30 s. A normal end shows `completed` from its `turn.complete` on.
- A normal end in `-p` mode gave a `peer` hand-back message, not a task notification, before the process ended.
- P4 to P7 need a person at the terminal (an interrupt, a permission prompt, an API error). Not run. Rule 2 maps `error` and `aborted` without them.

## Global Constraints

- Paths are relative to `mods/token-meter/` unless they start with `docs/`.
- English for code, comments, test names and drawn text. No emoji: `×` is single width.
- TDD. `bun run check` passes at the end.
- No timer and no new engine call. Only `prompt.submit` is a new hook.

## Decisions

- Precedence 3 (an event of the agent gives `running`) is above precedence 4 (the list). Thus `trackAgent` applies the list first and the event's change after it: `change(merged(entries, list, at), at)`.
- Rule 5 uses the list: when the stored registry of a session loads, a `running` entry that `$.agent.list()` does not show becomes `stopped`. A new process has none of the old agents in its list. An agent that runs in this process (a session switch with `/clear` and back) stays `running`. A hot reload keeps the atom and does not load.
- A notification for a task id that is not in the registry (a background Bash) changes nothing.
- A `stopped` agent does not add to `runs`. It sets `endedAt`.
- A `stopped` row is dim like an `idle` row. Only the mark is red.

## Review Focus

1. A restarted agent: an event after `stopped` gives `running` while the list still shows `killed`. Expected: `running`. Test in Task 1 (`merged` does not change a status that an event set after it) and Task 2.
2. A late `completed` notification after `turn.complete` with `answer`. Expected: `idle`, `runs` not counted twice. Test in Task 1.
3. A notification text with no `<task-id>`, or with an unknown status. Expected: no change. Test in Task 1.
4. A stored registry from the old version (`running`/`idle` only). Expected: it loads. Existing test.
5. A stored `running` agent that this process still runs. Expected: stays `running`. Test in Task 1 (`restored`).

---

### Task 1: Registry reducers

**Files:** Modify `types/index.d.ts`, `src/registry.ts`. Test `src/registry.test.ts`.

**Produces:**
- `AgentEntry.status: 'running' | 'idle' | 'stopped'`
- `stopped(r: Registry, id: string, at: number): Registry`: an unknown id adds a `stopped` entry; else status `stopped`, `endedAt: at`, `runs` kept.
- `ended(r: Registry, id: string, status: 'completed' | 'failed' | 'killed', at: number): Registry`: only a known id. `completed` gives `idle` (no run counted, `endedAt: at`). `failed` and `killed` give `stopped`.
- `taskNotice(text: string): { id: string; status: 'completed' | 'failed' | 'killed' } | null`: reads `<task-id>` and `<status>`.
- `merged`: a known `running` entry with list status `failed` or `killed` becomes `stopped`. A new entry from the list: `failed`/`killed` give `stopped`.
- `restored(r: Registry, list: readonly Listed[], at: number): Registry`: each `running` entry absent from `list` becomes `stopped`.
- `parseRegistry` keeps `stopped`.

- [ ] Write the failing tests: each bullet above, plus Review Focus 2, 3 and 5.
- [ ] Run `claude plugin test mods/token-meter`. Expected: FAIL.
- [ ] Implement.
- [ ] Run the tests. Expected: PASS.

### Task 2: Hooks

**Files:** Modify `hooks/register.tsx`. Test `hooks/register.test.ts` (the `engine` helper answers `prompt.submit`).

- `turn.complete` with an `agentId`: `reason === 'answer'` calls `completed`, else `stopped`.
- `prompt.submit` with `origin.kind === 'task-notification'`: after `next(e)`, `taskNotice(e.text)` and `ended` through `trackAgent`.
- `trackAgent`: `change(merged(...))` order.
- `loadAgents`: `restored(parseRegistry(stored), await $.agent.list(), at)`.

- [ ] Write the failing tests: an aborted `turn.complete` draws `×`; a `killed` notification draws `×`; an event after it spins again; a stored `running` entry loads as `×`.
- [ ] Run. Expected: FAIL.
- [ ] Implement.
- [ ] Run. Expected: PASS.

### Task 3: Pane

**Files:** Modify `src/pane.tsx`. Test `hooks/register.test.ts`.

- Mark `×`, color `PALETTE.red`, row `dimColor`. The title of a `stopped` agent uses `PALETTE.fg`.
- `MARK_RE` in the test accepts `×`.

- [ ] Write the failing test: the mark of a stopped agent is `×` and red on both surfaces.
- [ ] Implement. `bun run check`. Expected: PASS.
- [ ] Update the spec: status line and TODO with the probe results.
