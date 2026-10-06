---
name: new-mod
description: Scaffold a new Claude Code mod under mods/<name>/ from the working flight-deck layout.
disable-model-invocation: true
---

# new-mod

Scaffold `mods/<name>/` (argument: the kebab-case mod name). Do not touch other mods.

1. Create `mods/<name>/` with:
   - `.claude-plugin/plugin.json`: `{ "name": "<name>", "version": "0.1.0", "description": "...", "author": { "name": "bez" }, "types": "./types/index.d.ts" }`
   - `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`
   - `hooks/register.tsx`: `import type { Register } from 'claude-code'` and `export const register: Register = (on, options) => {}`
   - `types/index.d.ts`: self-contained contract (no imports): `export type ...` for state values plus `declare module 'claude-code' { interface PluginState { '<name>': { ... } } }`
   - `tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["hooks", "src", "types", ".claude-plugin/types/claude-code/index.d.ts"] }`
   - one `src/<thing>.ts` with a matching `src/<thing>.test.ts` (tests import `test`, `expect`, `mock` from `claude-code/testing`)
2. Add the mod to the root `package.json` scripts (`typecheck`, `validate`, `test`) next to flight-deck.
3. Copy the engine typings to `mods/<name>/.claude-plugin/types/claude-code/index.d.ts` (see README) so `tsc` works.
4. Run `bun run check` and report the result. Write a failing test first for every behavior you add.

Engine rules: the contract has no imports; functions that receive `$` are module-level function declarations; `turn.step` hooks are `async function*` and use `yield* next(e)`; never `import()` dynamically.
