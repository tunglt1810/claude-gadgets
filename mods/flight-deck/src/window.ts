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
// (the `native_1m` rows of the catalog in the Claude Code 2.1.291 binary).
const NATIVE_1M = ['opus-4-7', 'opus-4-8', 'opus-5', 'sonnet-5', 'fable-5', 'mythos-5'] as const

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
