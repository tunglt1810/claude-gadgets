# flight-deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that draws a band above the prompt with input/output/cache-hit tokens, tool-call count, total model working time and a styled cache countdown; data survives resume; runs on CLI and Desktop.

**Architecture:** Pure logic (accumulation, formatting, tone thresholds, snapshots, work clock) lives in `src/*.ts` and is testable without the engine. `hooks/register.tsx` only wires events (`turn.start`, `turn.step`, `turn.complete`, `tool.call`, `ui.render`) to atoms, `$.store` and `clock.every`. Drawn state lives in `$.state`; the copy that survives resume lives in `$.store`, keyed by session id.

**Tech Stack:** TypeScript 7.0.2, Bun 1.x (install and scripts), Biome 2.5.15 (lint + format), plugin API `claude-code` (EARLY ACCESS), `claude plugin validate` / `claude plugin test`.

**Spec:** `docs/specs/2026-10-04-flight-deck-design.md` (its "Post-verification amendments" win over earlier sections).

## Global Constraints

- Docs, code comments, identifiers, commit messages and user-visible strings are English.
- Dependencies pinned to exact versions: `typescript@7.0.2`, `@biomejs/biome@2.5.15`; no ranges (`^`, `~`), `bunfig.toml` has `exact = true`, `bun.lock` committed, installs use `bun install --frozen-lockfile`. No other dependencies.
- Mod lives in `mods/flight-deck/`; plugin name `flight-deck`.
- Every mod file is `.ts`/`.tsx`, an ES module, linked by static `import`; no dynamic `import()`.
- The module has no DOM/Node; everything outside goes through `$`.
- `ui.render` never writes state; state is written only from events or timers.
- Sum tokens from `turn.step` only, never `turn.complete`. A step with `agentId` (subagent) adds tokens but does NOT change `lastStepAt`.
- Work time is the union of `turn.start` -> `turn.complete` intervals (aborted/error included); an `active` counter prevents double counting overlapping turns. `busySince` and `active` are never persisted.
- `userConfig.cacheTtl`: `"5m"` (default) or `"1h"`.
- Band elements come from `$.ui.resolve(e)` and must render on `terminal` and `desktop`.
- `Text` has no blink: pulse by alternating `bold`/`inverse` per tick.
- Biome: `noExplicitAny` is an error; type `$` from the engine types instead of `any`.
- The repo is not a git repo: no commit steps; the checkpoint is `bun run check` + `claude plugin validate` + `claude plugin test` all green.
- Scratch files go in `.tmp/`, never `/tmp`.

## Review Focus

- Session id changes mid-run (resume, `/clear`): totals must reload for the new id and never leak from the old one (Task 3).
- Cache expired (`lastStepAt` past the TTL, or no step yet): countdown shows `expired`/`--`, never a negative number (Tasks 1, 4).
- Overlapping or aborted turns: `workMs` stays correct, non-negative, not double counted (Tasks 1, 3).
- `turn.step` with `usage: null` or missing fields: totals never become `NaN` (Tasks 1, 3).
- Division by zero in cache-hit % before any tokens exist (Task 1).
- Subagent steps must not extend the main countdown (Task 3).

## File Structure

```
package.json  bunfig.toml  bun.lock  biome.json  tsconfig.base.json  .gitignore
mods/flight-deck/
├── .claude-plugin/plugin.json
├── hooks/hooks.json
├── hooks/register.tsx        # wires events, atoms, store, timer, ui.render
├── src/usage.ts              # Totals, addUsage, cacheHitPct
├── src/format.ts             # formatTokens, formatCountdown, formatDuration
├── src/countdown.ts          # ttlMs, remainingMs, countdownTone, cacheHitTone
├── src/work.ts               # Work, startTurn, endTurn, workElapsed
├── src/snapshot.ts           # Snapshot, storeKey, parseSnapshot
├── src/band.tsx              # Band component
├── types/index.d.ts          # PluginState contract
├── tsconfig.json
└── src/*.test.ts, hooks/register.test.ts
```

---

### Task 0: Repo tooling (Bun, TypeScript 7, Biome, pinned)

**Files:**
- Create: `package.json`, `bunfig.toml`, `biome.json`, `tsconfig.base.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the config files.**

`package.json`:
```json
{
  "name": "claude-gadgets",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@biomejs/biome": "2.5.15",
    "typescript": "7.0.2"
  },
  "scripts": {
    "lint": "biome check .",
    "fix": "biome check --write .",
    "typecheck": "tsc -p mods/flight-deck --noEmit",
    "validate": "claude plugin validate mods/flight-deck",
    "test": "claude plugin test mods/flight-deck",
    "check": "bun run lint && bun run typecheck && bun run validate && bun run test"
  }
}
```
`bunfig.toml`:
```toml
[install]
exact = true
```
`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "files": { "includes": ["**", "!**/.tmp", "!**/.claude-plugin/types", "!bun.lock"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } },
  "linter": { "rules": { "recommended": true, "suspicious": { "noExplicitAny": "error" } } }
}
```
`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  }
}
```
Append to `.gitignore`: `mods/*/.claude-plugin/types/`, `node_modules/`.

- [ ] **Step 2: Install and verify pins.** Run `bun install`. Expected: `bun.lock` created; `package.json` versions unchanged (still exact). Run `bunx tsc --version` → `Version 7.0.2`; `bunx biome --version` → `2.5.15`.
- [ ] **Step 3: Lint the (still empty) repo.** `bun run lint` → Expected: no errors. If Biome rejects a key in `biome.json`, fix it to the schema of 2.5.15 (`bunx biome migrate` is allowed).

---

### Task 1: Scaffold + pure logic (usage, format, countdown, work)

**Files:**
- Create: `mods/flight-deck/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx` (stub), `types/index.d.ts`, `tsconfig.json`
- Create: `src/usage.ts`, `src/format.ts`, `src/countdown.ts`, `src/work.ts`
- Test: `src/usage.test.ts`, `src/format.test.ts`, `src/countdown.test.ts`, `src/work.test.ts`

**Interfaces (all paths under `mods/flight-deck/`):**
- Produces:
  - `type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number }`; `emptyTotals(): Totals`
  - `addUsage(t: Totals, u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null): Totals`
  - `cacheHitPct(t: Totals): number` (0..100, 0 when the denominator is 0)
  - `formatTokens(n: number): string` (`999`, `1.2k`, `12.4k`, `1.5M`)
  - `formatCountdown(ms: number | null): string` (`3:42`, `0:05`, `--` for null, `expired` for `<= 0`)
  - `formatDuration(ms: number): string` (`0:42`, `12:05`, `1:02:03`; negative/NaN -> `0:00`)
  - `type Tone = 'ok' | 'warn' | 'danger' | 'expired'`
  - `ttlMs(cfg: '5m' | '1h'): number`
  - `remainingMs(lastStepAt: number | null, now: number, ttl: number): number | null`
  - `countdownTone(remaining: number | null): Tone` (`> 60000` ok, `15000..60000` warn, `0 < r < 15000` danger, null or `<= 0` expired)
  - `cacheHitTone(pct: number): 'ok' | 'warn' | 'danger'` (`>= 70` ok, `>= 40` warn, else danger)
  - `type Work = { workMs: number; active: number; busySince: number | null }`; `emptyWork()`; `startTurn(w, at)`; `endTurn(w, at)`; `workElapsed(w, now)`

- [ ] **Step 1: Manifest and multi-file smoke test.** Create the files below and run `claude plugin validate mods/flight-deck`. If the `userConfig` shape is rejected, fix it per the error and record the correct shape in the spec. If relative imports between plugin files are rejected, collapse `src/*.ts` into `register.tsx` plus one helpers file and update "File Structure".

`.claude-plugin/plugin.json`:
```json
{
  "name": "flight-deck",
  "version": "0.1.0",
  "description": "Band tracking session tokens, tool calls, model working time and cache countdown",
  "types": "./types/index.d.ts",
  "userConfig": {
    "cacheTtl": {
      "type": "string",
      "title": "Cache TTL",
      "description": "Prompt cache lifetime used by the countdown",
      "options": ["5m", "1h"],
      "default": "5m"
    }
  }
}
```
`hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`

`hooks/register.tsx` (stub that imports one src file as a smoke test):
```tsx
import type { Register } from 'claude-code'
import { emptyTotals } from '../src/usage'

export const register: Register = (_on, _options) => {
  void emptyTotals
}
```
`types/index.d.ts` (placeholder, extended in Task 3):
```ts
declare module 'claude-code' {
  interface PluginState {
    'flight-deck': Record<string, never>
  }
}
export {}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["hooks", "src", "types"] }`. Once the engine has loaded the mod, extend the generated `.claude-plugin/types/tsconfig.json` as well if `bun run typecheck` cannot resolve `claude-code`.

Expected: `claude plugin validate` clean.

- [ ] **Step 2: Write the failing tests.**

`src/usage.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { addUsage, cacheHitPct, emptyTotals } from './usage'

test('addUsage accumulates and ignores null / missing fields', () => {
  let t = addUsage(emptyTotals(), {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 80,
    cache_creation_input_tokens: 10,
  })
  t = addUsage(t, null)
  t = addUsage(t, { output_tokens: 7 })
  expect(t).toEqual({ input: 10, output: 12, cacheRead: 80, cacheWrite: 10 })
})

test('cacheHitPct = cacheRead / (input + cacheRead + cacheWrite), 0 when empty', () => {
  expect(cacheHitPct(emptyTotals())).toBe(0)
  expect(cacheHitPct({ input: 10, output: 0, cacheRead: 80, cacheWrite: 10 })).toBe(80)
})
```
`src/format.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { formatCountdown, formatDuration, formatTokens } from './format'

test('formatTokens', () => {
  expect([999, 1200, 12400, 1500000].map(formatTokens)).toEqual(['999', '1.2k', '12.4k', '1.5M'])
})

test('formatCountdown', () => {
  expect(formatCountdown(222000)).toBe('3:42')
  expect(formatCountdown(5000)).toBe('0:05')
  expect(formatCountdown(null)).toBe('--')
  expect(formatCountdown(0)).toBe('expired')
  expect(formatCountdown(-500)).toBe('expired')
})

test('formatDuration', () => {
  expect([42000, 725000, 3723000, -5, Number.NaN].map(formatDuration)).toEqual([
    '0:42',
    '12:05',
    '1:02:03',
    '0:00',
    '0:00',
  ])
})
```
`src/countdown.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { cacheHitTone, countdownTone, remainingMs, ttlMs } from './countdown'

test('ttlMs', () => {
  expect(ttlMs('5m')).toBe(300000)
  expect(ttlMs('1h')).toBe(3600000)
})

test('remainingMs: null before any step, negative once past the TTL', () => {
  expect(remainingMs(null, 1000, 300000)).toBeNull()
  expect(remainingMs(0, 100000, 300000)).toBe(200000)
  expect(remainingMs(0, 400000, 300000)).toBe(-100000)
})

test('countdownTone thresholds', () => {
  expect(countdownTone(120000)).toBe('ok')
  expect(countdownTone(60000)).toBe('warn')
  expect(countdownTone(14999)).toBe('danger')
  expect(countdownTone(0)).toBe('expired')
  expect(countdownTone(null)).toBe('expired')
})

test('cacheHitTone thresholds', () => {
  expect([90, 70, 69, 40, 39].map(cacheHitTone)).toEqual(['ok', 'ok', 'warn', 'warn', 'danger'])
})
```
`src/work.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { emptyWork, endTurn, startTurn, workElapsed } from './work'

test('single turn adds the start -> end interval', () => {
  let w = startTurn(emptyWork(), 1000)
  expect(workElapsed(w, 4000)).toBe(3000)
  w = endTurn(w, 6000)
  expect(w).toEqual({ workMs: 5000, active: 0, busySince: null })
})

test('overlapping turns are not double counted', () => {
  let w = startTurn(emptyWork(), 0)
  w = startTurn(w, 2000)
  w = endTurn(w, 3000)
  expect(w.workMs).toBe(0)
  w = endTurn(w, 5000)
  expect(w.workMs).toBe(5000)
})

test('extra end never goes negative; backwards time is clamped', () => {
  expect(endTurn(emptyWork(), 100)).toEqual(emptyWork())
  expect(endTurn(startTurn(emptyWork(), 5000), 1000).workMs).toBe(0)
})
```

- [ ] **Step 3: Run to see them fail.** `bun run test` -> Expected: FAIL (modules missing).

- [ ] **Step 4: Minimal implementation.**

`src/usage.ts`:
```ts
export type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number }

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export const emptyTotals = (): Totals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export const addUsage = (t: Totals, u: Usage | null): Totals =>
  u === null
    ? t
    : {
        input: t.input + (u.input_tokens ?? 0),
        output: t.output + (u.output_tokens ?? 0),
        cacheRead: t.cacheRead + (u.cache_read_input_tokens ?? 0),
        cacheWrite: t.cacheWrite + (u.cache_creation_input_tokens ?? 0),
      }

// Share of prompt tokens served from the cache; 0 before any tokens exist.
export const cacheHitPct = (t: Totals): number => {
  const all = t.input + t.cacheRead + t.cacheWrite
  return all === 0 ? 0 : Math.round((t.cacheRead / all) * 100)
}
```
`src/format.ts`:
```ts
export const formatTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

export const formatCountdown = (ms: number | null): string => {
  if (ms === null) return '--'
  if (ms <= 0) return 'expired'
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const formatDuration = (ms: number): string => {
  const s = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}
```
`src/countdown.ts`:
```ts
export type Tone = 'ok' | 'warn' | 'danger' | 'expired'

export const ttlMs = (cfg: '5m' | '1h'): number => (cfg === '1h' ? 3_600_000 : 300_000)

// Milliseconds until the prompt cache lapses; null before the first step.
export const remainingMs = (lastStepAt: number | null, now: number, ttl: number): number | null =>
  lastStepAt === null ? null : lastStepAt + ttl - now

export const countdownTone = (r: number | null): Tone =>
  r === null || r <= 0 ? 'expired' : r < 15_000 ? 'danger' : r <= 60_000 ? 'warn' : 'ok'

export const cacheHitTone = (pct: number): 'ok' | 'warn' | 'danger' =>
  pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'danger'
```
`src/work.ts`:
```ts
// Model working time: the union of turn intervals. `active` counts open turns so
// overlapping turns (subagents) are not double counted.
export type Work = { workMs: number; active: number; busySince: number | null }

export const emptyWork = (): Work => ({ workMs: 0, active: 0, busySince: null })

export const startTurn = (w: Work, at: number): Work => ({
  ...w,
  active: w.active + 1,
  busySince: w.active === 0 ? at : w.busySince,
})

export const endTurn = (w: Work, at: number): Work => {
  if (w.active === 0) return w
  const active = w.active - 1
  return active > 0
    ? { ...w, active }
    : { workMs: w.workMs + Math.max(0, at - (w.busySince ?? at)), active: 0, busySince: null }
}

// Total including the interval that is still open.
export const workElapsed = (w: Work, now: number): number =>
  w.workMs + (w.busySince === null ? 0 : Math.max(0, now - w.busySince))
```

- [ ] **Step 5: Verify.** `bun run fix && bun run check` -> Expected: lint, typecheck (if types are not laid yet, run it after the first load), validate and test all pass.

---

### Task 2: Snapshot and persistence (pure)

**Files:**
- Create: `src/snapshot.ts`
- Test: `src/snapshot.test.ts`

**Interfaces:**
- Consumes: `Totals`, `emptyTotals` (Task 1).
- Produces:
  - `type Snapshot = { totals: Totals; tools: number; lastStepAt: number | null; workMs: number }` (`active`/`busySince` live in state only, never stored)
  - `emptySnapshot(): Snapshot`
  - `storeKey(sessionId: string): string` -> `` `session:${sessionId}` ``
  - `parseSnapshot(raw: unknown): Snapshot` (corrupt or missing data -> `emptySnapshot()`; wrongly typed numbers -> 0/null)

- [ ] **Step 1: Failing test.**
```ts
import { expect, test } from 'claude-code/testing'
import { emptySnapshot, parseSnapshot, storeKey } from './snapshot'

test('storeKey is per session id', () => {
  expect(storeKey('abc')).toBe('session:abc')
})

test('parseSnapshot: undefined / garbage -> empty', () => {
  expect(parseSnapshot(undefined)).toEqual(emptySnapshot())
  expect(parseSnapshot('x')).toEqual(emptySnapshot())
  expect(
    parseSnapshot({ totals: { input: 'a' }, tools: 'b', lastStepAt: 'c', workMs: 'd' }),
  ).toEqual(emptySnapshot())
})

test('parseSnapshot keeps valid data', () => {
  const s = {
    totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    tools: 5,
    lastStepAt: 600,
    workMs: 7000,
  }
  expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
})
```
- [ ] **Step 2:** `bun run test` -> FAIL.
- [ ] **Step 3: Implement.**
```ts
import { emptyTotals, type Totals } from './usage'

export type Snapshot = { totals: Totals; tools: number; lastStepAt: number | null; workMs: number }

export const emptySnapshot = (): Snapshot => ({
  totals: emptyTotals(),
  tools: 0,
  lastStepAt: null,
  workMs: 0,
})

export const storeKey = (sessionId: string): string => `session:${sessionId}`

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// Defensive read: the store is JSON written by an earlier version or by hand.
export const parseSnapshot = (raw: unknown): Snapshot => {
  if (typeof raw !== 'object' || raw === null) return emptySnapshot()
  const r = raw as Record<string, unknown>
  const t = (typeof r.totals === 'object' && r.totals !== null ? r.totals : {}) as Record<
    string,
    unknown
  >
  return {
    totals: {
      input: num(t.input),
      output: num(t.output),
      cacheRead: num(t.cacheRead),
      cacheWrite: num(t.cacheWrite),
    },
    tools: num(r.tools),
    lastStepAt:
      typeof r.lastStepAt === 'number' && Number.isFinite(r.lastStepAt) ? r.lastStepAt : null,
    workMs: num(r.workMs),
  }
}
```
- [ ] **Step 4:** `bun run fix && bun run test` -> PASS.

---

### Task 3: Hooks: tracking, state, resume by session id, work time

**Files:**
- Modify: `types/index.d.ts`, `hooks/register.tsx`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: atom `meter` (`Snapshot & { sessionId: string | null; active: number; busySince: number | null }`) and atom `now` (`number`); hooks `turn.step`, `tool.call`, `turn.start`, `turn.complete`; internal `ensureLoaded($)` (compare `$.session.id()` with `meter.sessionId`, reload from `$.store` on mismatch) and `save($, id, snap)`.

- [ ] **Step 1: Update the contract `types/index.d.ts`.**
```ts
import type { Snapshot } from '../src/snapshot'

declare module 'claude-code' {
  interface PluginState {
    'flight-deck': {
      meter: Snapshot & { sessionId: string | null; active: number; busySince: number | null }
      now: number
    }
  }
}
export {}
```
- [ ] **Step 2: Failing tests** in `hooks/register.test.ts`, using `mock.store(on, entries)` and `mock.clock(on)` from `claude-code/testing` (exact signatures: `.claude-plugin/types/claude-code/index.d.ts` after the first load). One `test(...)` per case:
  1. Two main `turn.step`s with usage `{input_tokens:10, output_tokens:5, cache_read_input_tokens:80, cache_creation_input_tokens:10}` -> `meter.totals` doubles and `lastStepAt` equals the clock time of the second step.
  2. A `turn.step` with `agentId: 'sub1'` -> totals grow, `lastStepAt` unchanged.
  3. A `turn.step` with `usage: null` -> totals unchanged, no `NaN`.
  4. Three `tool.call`s -> `tools` is 3.
  5. Resume: `mock.store(on, { 'session:S2': { totals: {...}, tools: 7, lastStepAt: 1000, workMs: 0 } })`, current session id `S2` -> the first event loads `tools = 7`. Then switch the session id to `S3` (no snapshot) -> state is empty, nothing leaks from `S2`.
  6. After each step, `$.store` holds `session:<id>` equal to the snapshot.
  7. `turn.start` at t=1000 and `turn.complete` at t=6000 -> `workMs` 5000, `busySince` null, store holds `workMs: 5000`.
  8. Two overlapping `turn.start`s then two `turn.complete`s -> `workMs` equals the outer interval only.
  9. `turn.complete` with `reason: 'aborted'` still closes the interval and adds to `workMs`.
- [ ] **Step 3:** `bun run test` -> FAIL.
- [ ] **Step 4: Implement `hooks/register.tsx`.** Take the `$` type from the generated engine types (grep `.claude-plugin/types/claude-code/index.d.ts` for the engine interface type) and use it as `Api` below; `any` is forbidden by Biome.
```tsx
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { emptySnapshot, parseSnapshot, type Snapshot, storeKey } from '../src/snapshot'
import { addUsage } from '../src/usage'
import { endTurn, startTurn } from '../src/work'

type Api = /* the engine `$` type, taken from the generated types */ never
type Meter = Snapshot & { sessionId: string | null; active: number; busySince: number | null }

const meter = atom<Meter>(
  { plugin: 'flight-deck', key: 'meter' } as const,
  { ...emptySnapshot(), sessionId: null, active: 0, busySince: null },
)
const nowAtom = atom({ plugin: 'flight-deck', key: 'now' } as const, 0)

export const register: Register = (on, _options) => {
  // Load by session id on every event: covers --resume, in-process resume and /clear
  // without relying on session.start (which does not fire for those).
  const ensureLoaded = async ($: Api): Promise<string> => {
    const id = await $.session.id()
    const cur = await read($, meter)
    if (cur.sessionId === id) return id
    const snap = parseSnapshot(await $.store.get(storeKey(id)))
    await update($, meter, () => ({ ...snap, sessionId: id, active: 0, busySince: null }))
    return id
  }

  // Only the persistent part of the meter is stored; active/busySince are runtime-only.
  const save = (
    $: Api,
    id: string,
    s: Snapshot,
  ): Promise<void> =>
    $.store.set(storeKey(id), {
      totals: s.totals,
      tools: s.tools,
      lastStepAt: s.lastStepAt,
      workMs: s.workMs,
    })

  on('turn.step', async ($, e, next) => {
    const res = await next(e)
    const id = await ensureLoaded($)
    const at = await $.clock.now()
    const cur = await read($, meter)
    // Subagents (agentId set) have their own caches: count their tokens but do not
    // touch the main countdown.
    const isMain = e.agentId === undefined
    const nextMeter = {
      ...cur,
      totals: addUsage(cur.totals, res.usage),
      lastStepAt: isMain && res.usage !== null ? at : cur.lastStepAt,
    }
    await update($, meter, () => nextMeter)
    await update($, nowAtom, () => at)
    await save($, id, nextMeter)
    return res
  })

  on('tool.call', async ($, e, next) => {
    const id = await ensureLoaded($)
    const cur = await read($, meter)
    const nextMeter = { ...cur, tools: cur.tools + 1 }
    await update($, meter, () => nextMeter)
    await save($, id, nextMeter)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await ensureLoaded($)
    const at = await $.clock.now()
    const cur = await read($, meter)
    await update($, meter, () => ({ ...cur, ...startTurn(cur, at) }))
    await update($, nowAtom, () => at)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = await ensureLoaded($)
    const at = await $.clock.now()
    const cur = await read($, meter)
    const nextMeter = { ...cur, ...endTurn(cur, at) }
    await update($, meter, () => nextMeter)
    await update($, nowAtom, () => at)
    await save($, id, nextMeter)
    return next(e)
  })
}
```
(`ensureLoaded` runs before reading `cur` in every hook, so a snapshot loaded for a new id is never overwritten with stale state.)
- [ ] **Step 5:** `bun run fix && bun run check` -> PASS.

---

### Task 4: Band (UI + styling) and countdown timer

**Files:**
- Create: `src/band.tsx`
- Modify: `hooks/register.tsx` (add `ui.render` and the timer)
- Test: `hooks/register.test.ts` (add UI cases)

**Interfaces:**
- Consumes: `workElapsed`, `formatDuration`, `countdownTone`, `cacheHitTone`, `remainingMs`, `ttlMs`, `formatTokens`, `formatCountdown`, `cacheHitPct`, atoms `meter` and `now`.
- Produces: `Band({ ui, snap, now, ttl })` returning JSX; a `ui.render` hook on `{ component: 'AbovePrompt' }`; a `clock.every(1000)` timer that writes `now` and stops once the cache has expired AND no turn is running.

Line: `↓{input} ↑{output} ⚡{pct}% · 🔧{tools} · ⏱{work} · ⏳{countdown} {bar}`. `↓` is uncached `input_tokens`, `⚡` is the cache-hit share, `⏱` is `formatDuration(workElapsed(...))` (blue, bold while a turn is running), and the bar is 10 cells `█`/`░` of `remaining / ttl`. One color table in `band.tsx`: `ok` green, `warn` yellow, `danger` red, `expired` dim + strikethrough; in `danger` the countdown alternates `bold`/`inverse` by `Math.floor(now / 1000) % 2`.

- [ ] **Step 1: Failing UI tests.** With `mock.clock` and `ui.mount({ plugin: 'flight-deck', surface, component: 'AbovePrompt', props: { hasSurvey: false } })`, looped over `['terminal', 'desktop'] as const`:
  1. After one main `turn.step`, the band contains `↓10`, `↑5`, `⚡80%`, `🔧0`, `⏳5:00` (default 5m TTL).
  2. `clock.advance(250_000)` -> `0:50`, countdown `color` is `yellow`.
  3. `clock.advance(40_000)` more -> `0:10`, `color` is `red`.
  4. `clock.advance(20_000)` more -> `expired`, `strikethrough` on, the timer stops (advancing further does not change the content).
  5. With `{ options: { cacheTtl: '1h' } }` -> `⏳60:00` after a step.
  6. No step yet -> countdown `--`, no error.
  7. `hasSurvey: true` -> the band is not drawn (`next(e)`).
  8. `turn.start` then `clock.advance(3000)` (not completed) -> `⏱0:03`, growing per tick; after `turn.complete` the clock holds its last value.
- [ ] **Step 2:** `bun run test` -> FAIL.
- [ ] **Step 3: Implement `src/band.tsx`.** Type `ui` from the engine's `$.ui.resolve` return type (no `any`).
```tsx
import { cacheHitTone, countdownTone, remainingMs, ttlMs } from './countdown'
import { formatCountdown, formatDuration, formatTokens } from './format'
import type { Snapshot } from './snapshot'
import { cacheHitPct } from './usage'
import { workElapsed } from './work'

const COLOR = { ok: 'green', warn: 'yellow', danger: 'red', expired: undefined } as const

type Props = {
  ui: Ui // `$.ui.resolve(e)` result type, from the generated engine types
  snap: Snapshot & { active: number; busySince: number | null }
  now: number
  ttl: '5m' | '1h'
}

export const Band = ({ ui, snap, now, ttl }: Props) => {
  const { Box, Text } = ui
  const total = ttlMs(ttl)
  const rem = remainingMs(snap.lastStepAt, now, total)
  const tone = countdownTone(rem)
  const pct = cacheHitPct(snap.totals)
  const filled = rem === null || rem <= 0 ? 0 : Math.max(1, Math.round((rem / total) * 10))
  // The terminal has no blink attribute: pulse by alternating bold/inverse each second.
  const pulse = tone === 'danger' && Math.floor(now / 1000) % 2 === 0
  return (
    <Box>
      <Text color="cyan">↓{formatTokens(snap.totals.input)} </Text>
      <Text color="magenta">↑{formatTokens(snap.totals.output)} </Text>
      <Text color={COLOR[cacheHitTone(pct)]}>⚡{pct}% </Text>
      <Text dimColor>· </Text>
      <Text>🔧{snap.tools} </Text>
      <Text dimColor>· </Text>
      <Text color="blue" bold={snap.busySince !== null}>
        ⏱{formatDuration(workElapsed(snap, now))}{' '}
      </Text>
      <Text dimColor>· </Text>
      <Text
        color={COLOR[tone]}
        bold={pulse}
        inverse={pulse}
        dimColor={tone === 'expired'}
        strikethrough={tone === 'expired' && rem !== null}
      >
        ⏳{formatCountdown(rem)}
      </Text>
      <Text color={COLOR[tone]} dimColor={tone === 'expired'}>
        {' '}
        {'█'.repeat(filled)}
        {'░'.repeat(10 - filled)}
      </Text>
    </Box>
  )
}
```
If `Text` has no `inverse`, use `bold` only and adjust test 3.
- [ ] **Step 4: Wire into `hooks/register.tsx`.** Import `Band`, `ttlMs`; inside `register`:
```tsx
  const ttl: '5m' | '1h' = _options.cacheTtl === '1h' ? '1h' : '5m'
  let timer: { cancel: () => void } | null = null

  // One 1s tick drives both the countdown and the live work clock; it stops itself
  // once the cache has lapsed and no turn is running.
  const startTimer = ($: Api) => {
    if (timer !== null) return
    timer = $.clock.every(1000, async () => {
      const at = await $.clock.now()
      await update($, nowAtom, () => at)
      const s = await read($, meter)
      const isCacheDone = s.lastStepAt === null || s.lastStepAt + ttlMs(ttl) <= at
      if (isCacheDone && s.busySince === null) {
        timer?.cancel()
        timer = null
      }
    })
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const snap = await read($, meter)
    const now = await read($, nowAtom)
    return <Band ui={$.ui.resolve(e)} snap={snap} now={now || snap.lastStepAt || 0} ttl={ttl} />
  })
```
Rename the `register` parameter `_options` to `options` and use it. Call `startTimer($)` in `turn.start` (so the work clock runs before any step), at the end of `turn.step`, and after `ensureLoaded` loads a snapshot with `lastStepAt`.
- [ ] **Step 5:** `bun run fix && bun run check` -> PASS on both surfaces.

---

### Task 5: Real-world verification, README, hook, `new-mod` skill

**Files:**
- Create: `README.md`, `.claude/settings.json` (validate hook), `.claude/skills/new-mod/SKILL.md`

- [ ] **Step 1: CLI.** Run `claude --plugin-dir mods/flight-deck`, send a few prompts that call tools. Expected: band appears, numbers grow, the countdown runs and changes color, the work clock advances during a turn.
- [ ] **Step 2: Resume.** Exit, run `claude --resume`; totals, tools and work time must be kept. Record in the spec whether resume keeps the old session id; if the id changes and data is lost, take the target id from `session.end` (`e.resume.id`) in `ensureLoaded` and update the spec.
- [ ] **Step 3: Desktop.** Ask the user first (it edits a file outside the repo), then add `CLAUDE_CODE_PLUGIN_DIRS` (absolute path to `mods/flight-deck`) to the `env` block of `~/.claude/settings.json`, open the Code tab in Claude Desktop and check the band. If it does not show, record it as a risk in the spec.
- [ ] **Step 4: README.md (English).** Repo layout, toolchain (`bun install --frozen-lockfile`, `bun run check`), how to load a mod (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`), how to add a mod, and the note that sessions using the 1-hour cache should set `cacheTtl=1h`.
- [ ] **Step 5: Validate hook.** Via the `update-config` skill, add to the repo's `.claude/settings.json` a PostToolUse hook on Edit/Write for paths under `mods/<name>/` that runs `claude plugin validate mods/<name>`.
- [ ] **Step 6: `new-mod` skill (last, copied from the working flight-deck).** `.claude/skills/new-mod/SKILL.md`, user-only (`disable-model-invocation: true`), English: scaffolds `mods/<name>/` with manifest, `hooks.json`, minimal `register.tsx`, `types/`, `tsconfig.json` and one sample test, and adds the mod to the root scripts.

---

## Self-Review

- **Spec coverage:** tokens + cache hit (Tasks 1, 4), tool count (Task 3), work time (Tasks 1, 2, 3, 4), countdown + TTL option (Tasks 1, 4), styling (Task 4), resume (Tasks 2, 3, 5), CLI + Desktop (Tasks 4, 5), toolchain and pins (Task 0), monorepo/README/skill/hook (Task 5).
- **Placeholder scan:** the only deferred items are exact engine type names (`Api`, `Ui`), mock helper signatures and the `inverse` prop; each has a concrete resolution step (read the generated types, fall back to `bold`).
- **Type consistency:** `Totals`, `Snapshot`, `Work`, `Tone`, `ttlMs`, `remainingMs`, `countdownTone`, `cacheHitTone`, `formatTokens`, `formatCountdown`, `formatDuration`, `cacheHitPct`, `parseSnapshot`, `storeKey`, `startTurn`, `endTurn`, `workElapsed` are used consistently across tasks.
