import type { Snapshot, Totals } from '../types'

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

type ServerToolUse = { name: string; startedAt: number; endedAt?: number }

// The ledger cost that no step holds.
export const restOf = (s: Pick<Snapshot, 'costUsd' | 'costByModel'>): number =>
  s.costUsd - Object.values(s.costByModel).reduce((sum, c) => sum + c, 0)

// The advisor calls of one step added to the session's: the API ran them inside the request.
// `model` is the settings' `advisorModel`. A call with a result took time and has a cost to
// settle; a call with no result (it failed, or the response was cut) has neither.
export const advised = (
  a: Snapshot['advisor'],
  uses: readonly ServerToolUse[],
  model: unknown,
): Snapshot['advisor'] => {
  const calls = uses.filter((u) => u.name === 'advisor')
  if (calls.length === 0) return a
  const ms = calls.reduce(
    (sum, u) => sum + Math.max(0, (u.endedAt ?? u.startedAt) - u.startedAt),
    0,
  )
  return {
    ...a,
    calls: a.calls + calls.length,
    ms: a.ms + ms,
    ...(typeof model === 'string' ? { model } : {}),
    ...(ms > 0 ? { pending: true } : {}),
  }
}

// The advisor's cost, once the ledger holds the turn that called it: how much the rest grew
// since the turn started. The steps are in the model rows, so the growth is the advisor's (and
// any side request of the same turn: an estimate). The engine measures the ledger late, so
// call this between turns only. A rest that did not grow is a ledger that does not hold the
// call yet: the call stays to settle.
export const settled = (s: Snapshot): Snapshot['advisor'] => {
  const { pending, ...a } = s.advisor
  const grown = restOf(s) - a.base
  return pending === true && grown > 0 ? { ...a, usd: a.usd + grown, base: restOf(s) } : s.advisor
}

// At the start of a turn: settle, then take the rest as the start of the next growth.
export const rebased = (s: Snapshot): Snapshot['advisor'] => {
  const a = settled(s)
  return a.pending === true ? a : { ...a, base: restOf(s) }
}
