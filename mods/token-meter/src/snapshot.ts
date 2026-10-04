import type { Snapshot } from '../types'
import { emptyTotals } from './usage'

export type { Snapshot }

export const emptySnapshot = (): Snapshot => ({
  totals: emptyTotals(),
  tools: 0,
  lastStepAt: null,
  workMs: 0,
  costUsd: 0,
  added: 0,
  removed: 0,
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
    costUsd: num(r.costUsd),
    added: num(r.added),
    removed: num(r.removed),
  }
}

// False for a value of an older shape: live state outlasts a hot reload, so after the mod
// gains a field the state it finds lacks it (and `undefined + n` is NaN).
export const isComplete = (s: Partial<Snapshot>): boolean =>
  [s.tools, s.workMs, s.costUsd, s.added, s.removed].every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  )

// Recency index of stored sessions: the id first, duplicates removed, anything past `max`
// is dropped so the store does not grow by a key per session forever.
export const touchSessions = (
  index: unknown,
  id: string,
  max: number,
): { keep: string[]; drop: string[] } => {
  const known = Array.isArray(index) ? index.filter((x): x is string => typeof x === 'string') : []
  const all = [id, ...known.filter((x) => x !== id)]
  return { keep: all.slice(0, max), drop: all.slice(max) }
}
