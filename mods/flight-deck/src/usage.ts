import type { Totals } from '../types'

export type { Totals }

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
