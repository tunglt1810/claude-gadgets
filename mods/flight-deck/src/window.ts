import type { Registry } from '../types'
import { formatTokens } from './format'
import { PALETTE } from './palette'

// The input side of an agent's latest step, and the window of the step's model.
export type Context = { tokens: number; window: number }

// A step's usage: its output is not part of the window, so it is never read.
type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// The tokens a step was answered over, as the status line's `used_percentage` counts them:
// the output is not part of them.
export const contextTokens = (u: Usage): number =>
  (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)

const SMALL = 200_000
const LARGE = 1_000_000
// The models whose window is 1M with no suffix, by the start of the id after `claude-`
// (the `native_1m` rows of the catalog in the Claude Code 2.1.293 binary).
const NATIVE_1M = [
  'opus-4-7',
  'opus-4-8',
  'opus-5',
  'sonnet-5',
  'fable-5',
  'mythos-5',
  'haiku-5-5',
] as const

// The engine's resolver, read from the Claude Code 2.1.291 binary (minified, names restored):
//
//   function contextWindow(model, betas) {
//     if (has1mSuffix(model) && !CLAUDE_CODE_DISABLE_1M_CONTEXT) return 1e6
//     if (betas?.includes('context-1m-2025-08-07') && supports1mBeta(model)) return 1e6
//     const declared = declaredWindow(model)
//     if (declared !== undefined) return sonnet46Override(model) ?? declared.believed
//     if (isNative1m(model)) return 1e6
//     return 200000
//   }
//
// A plugin sees neither the betas, nor the server override, nor a remote catalog.
export const contextWindow = (model: string, isDisabled1m: boolean): number => {
  if (isDisabled1m) return SMALL
  if (/\[1m\]/i.test(model)) return LARGE
  const id = model.toLowerCase().replace(/^claude-/, '')
  return NATIVE_1M.some((p) => id === p || id.startsWith(`${p}-`)) ? LARGE : SMALL
}

// The bounds of an auto-compact window (the engine's `AR` and `OH`).
const MIN_COMPACT = 100_000
const MAX_COMPACT = 1_000_000

const isCompactWindow = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MIN_COMPACT && v <= MAX_COMPACT

// The key that `modelSettings` names a model by: a dated, `[1m]`, Bedrock or Vertex
// spelling of the model gives the canonical name.
export const settingsKey = (model: string): string =>
  model
    .toLowerCase()
    .replace(/\[1m\]$/, '')
    .replace(/^(?:[a-z]+\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/[-@]\d{8}$/, '')

// A settings value as an object, or an empty one.
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

// A settings value as the engine's schema keeps it: a window, `auto`, or nothing
// (a value out of range is dropped, as if the file did not set it).
const kept = (v: unknown): number | 'auto' | undefined =>
  v === 'auto' || isCompactWindow(v) ? v : undefined

// A whole number as the engine reads one (`Au`, Claude Code 2.1.310): `1e6`, groups of
// three digits with one separator (`400,000`, `400_000`), else what parseInt reads.
const SCIENTIFIC = /^[+-]?(\d+(\.\d*)?|\.\d+)[eE][+-]?\d+$/
const GROUPED = /^[+-]?\d{1,3}([_,\u00A0\u202F ])\d{3}(?:\1\d{3})*$/
const wholeNumber = (text: string): number => {
  if (text.length <= 32) {
    if (SCIENTIFIC.test(text)) {
      const n = Number(text)
      return Number.isInteger(n) ? n : Number.NaN
    }
    if (GROUPED.test(text)) return Number.parseInt(text.replace(/[_,\u00A0\u202F ]/g, ''), 10)
  }
  return Number.parseInt(text, 10)
}

// The variable `CLAUDE_CODE_AUTO_COMPACT_WINDOW` as the engine reads it: `400k`, `0.4m`,
// `400000` or `400,000`; a size below the minimum is the minimum, above the maximum the
// maximum, and a value that is no size is ignored.
export const envWindow = (env: string | undefined): number | undefined => {
  if (env === undefined) return undefined
  const text = env.trim()
  const unit = { k: 1_000, m: 1_000_000 }[text.slice(-1).toLowerCase()]
  const n = unit !== undefined ? Number.parseFloat(text) * unit : wholeNumber(text)
  if (Number.isNaN(n) || n < 1) return undefined
  return Math.min(MAX_COMPACT, Math.max(MIN_COMPACT, Math.round(n)))
}

// The auto-compact window that the settings files (lowest precedence first) give a loop
// of `model`, or undefined when none sets one. Read from the Claude Code 2.1.310 binary:
// a file with a top-level `autoCompactWindow` replaces the model windows of the files
// before it, a file with none adds its model windows to theirs. The variable
// (`envWindow`) wins over the files; a subagent's window is lowered to the window of its
// definition (`capped`).
export const compactWindow = (
  model: string,
  layers: readonly Readonly<Record<string, unknown>>[],
): number | undefined => {
  let fold: { top: unknown; byModel: Record<string, unknown> } = { top: undefined, byModel: {} }
  for (const layer of layers) {
    const own: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj(layer.modelSettings))) {
      const w = kept(obj(v).autoCompactWindow)
      if (w === undefined) continue
      const key = settingsKey(k)
      // The canonical spelling wins over another spelling of the same model.
      if (k === key || !Object.hasOwn(own, key)) own[key] = w
    }
    const top = kept(layer.autoCompactWindow)
    fold =
      top === undefined
        ? { top: fold.top, byModel: { ...fold.byModel, ...own } }
        : { top, byModel: own }
  }
  const key = settingsKey(model)
  const w = Object.hasOwn(fold.byModel, key) ? fold.byModel[key] : fold.top
  return isCompactWindow(w) ? w : undefined
}

// The `name` of an agent file (`.claude/agents/*.md`) and its `autoCompactWindow`, read
// from its frontmatter; undefined for a file with no frontmatter or no name.
export const agentFile = (text: string): { name: string; window?: number } | undefined => {
  const head = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (head === undefined) return undefined
  // A value, without its quotes and without a comment after it.
  const value = (key: string) => {
    const m = new RegExp(
      `^${key}:[ \\t]*(?:"([^"]*)"|'([^']*)'|(.*?))(?:[ \\t]+#.*)?\\s*$`,
      'm',
    ).exec(head)
    return m === null ? undefined : (m[1] ?? m[2] ?? m[3])
  }
  const name = value('name')
  // The engine refuses a file with no name or description, or with a name that starts
  // with "-" or holds ":" (the plugin separator).
  if (name === undefined || name === '' || name.startsWith('-') || name.includes(':'))
    return undefined
  // A description may start on the next, indented line.
  const hasText = (v: string | undefined) => v !== undefined && v !== '' && !/^[>|][+-]?$/.test(v)
  if (!hasText(value('description')) && !/^description:[^\n]*\n[ \t]+\S/m.test(head))
    return undefined
  const raw = value('autoCompactWindow')
  const window = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined
  return isCompactWindow(window) ? { name, window } : { name }
}

// `tokens` over `window` as a whole percentage, kept between 0 and 100.
export const contextPct = (c: Context): number =>
  c.window > 0 ? Math.min(100, Math.max(0, Math.round((c.tokens / c.window) * 100))) : 0

export const contextTone = (pct: number): 'ok' | 'warn' | 'danger' =>
  pct >= 80 ? 'danger' : pct >= 50 ? 'warn' : 'ok'

const TONE = { ok: PALETTE.green, warn: PALETTE.yellow, danger: PALETTE.red } as const

export const contextColor = (c: Context): string => TONE[contextTone(contextPct(c))]

// A window as `1M` or `200k`: a whole count has no decimal.
const windowLabel = (n: number): string => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}k`)

// `ctx 182.4k/1M 18%`, or `ctx 18%` where the row has no room for the counts.
export const contextText = (c: Context, isFull: boolean): string =>
  isFull
    ? `ctx ${formatTokens(c.tokens)}/${windowLabel(c.window)} ${contextPct(c)}%`
    : `ctx ${contextPct(c)}%`

// The text of a context in `room` cells: with its counts, the percentage alone, or none.
export const contextFit = (c: Context, room: number): string | null =>
  [contextText(c, true), contextText(c, false)].find((t) => t.length <= room) ?? null

export const ctxKey = (agentId: string): string => `ctx:${agentId}`

// The tokens of each agent's context that run to a new count when they change, by name.
export const contextTargets = (entries: Registry): Record<string, number> =>
  Object.fromEntries(
    Object.values(entries).flatMap((a) =>
      a.context === undefined ? [] : [[ctxKey(a.id), a.context.tokens]],
    ),
  )

// The folders from the project root up to the home folder, the nearest first: where the
// engine looks for `.claude/agents` (it also stops at the git root). The home folder
// itself is none of them; outside it the walk goes to `/`.
export const ancestorDirs = (root: string, home: string): string[] => {
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  const stop = trim(home)
  const dirs: string[] = []
  for (let dir = trim(root); dir !== stop; ) {
    dirs.push(dir)
    const up = dir.slice(0, dir.lastIndexOf('/')) || '/'
    if (up === dir) break
    dir = up
  }
  return dirs
}

// `rel` in `dir`, with one slash at the root too.
export const inDir = (dir: string, rel: string): string =>
  dir === '/' ? `/${rel}` : `${dir}/${rel}`

// The folder of the agent files of a project folder.
export const agentsDir = (dir: string): string => inDir(dir, '.claude/agents')

// The settings layers that a read of the merged settings is made of, lowest precedence
// first; null when they are unknown: a read with settings but no layers, which the engine
// did not fill.
export const layersOf = (
  layers: readonly { settings: Readonly<Record<string, unknown>> }[] | undefined,
  merged: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>[] | null =>
  layers === undefined || (layers.length === 0 && Object.keys(merged).length > 0)
    ? null
    : layers.map((l) => l.settings)

// The windows of the agent types that plugins register, by full name (`<plugin>:<name>`),
// with the registration of `agent` applied: its `autoCompactWindow`, or none.
export const agentTypeWindow = (
  known: ReadonlyMap<string, number>,
  agent: string,
  spec: { autoCompactWindow?: unknown },
): Map<string, number> => {
  const next = new Map(known)
  if (isCompactWindow(spec.autoCompactWindow)) next.set(agent, spec.autoCompactWindow)
  else next.delete(agent)
  return next
}
