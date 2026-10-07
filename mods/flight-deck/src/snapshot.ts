import type { AgentUsage, Snapshot, Totals } from '../types'
import { emptyTotals } from './usage'

// In `mcpCalls`: the session ran before the mod kept its MCP calls, so no server is known as
// not called.
export const UNKNOWN_CALLS = '*'

export type { Snapshot }

export const emptySnapshot = (): Snapshot => ({
  totals: emptyTotals(),
  tools: 0,
  lastStepAt: null,
  workMs: 0,
  costUsd: 0,
  added: 0,
  removed: 0,
  agents: 0,
  bg: 0,
  byAgent: {},
  byModel: {},
  costByModel: {},
  advisor: { calls: 0, ms: 0, usd: 0, base: 0 },
  steps: 0,
  mcpCalls: [],
})

export const storeKey = (sessionId: string): string => `session:${sessionId}`

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const parseTotals = (raw: unknown): Totals => {
  const t = isRecord(raw) ? raw : {}
  return {
    input: num(t.input),
    output: num(t.output),
    cacheRead: num(t.cacheRead),
    cacheWrite: num(t.cacheWrite),
  }
}

const parseAdvisor = (raw: unknown): Snapshot['advisor'] => {
  const a = isRecord(raw) ? raw : {}
  return {
    calls: num(a.calls),
    ms: num(a.ms),
    usd: num(a.usd),
    base: num(a.base),
    ...(typeof a.model === 'string' ? { model: a.model } : {}),
    ...(a.pending === true ? { pending: true } : {}),
  }
}

const stepAt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const parseAgents = (raw: unknown): Record<string, AgentUsage> =>
  Object.fromEntries(
    Object.entries(isRecord(raw) ? raw : {})
      .filter((kv): kv is [string, Record<string, unknown>] => isRecord(kv[1]))
      .map(([id, a]) => [
        id,
        {
          totals: parseTotals(a.totals),
          tools: num(a.tools),
          added: num(a.added),
          removed: num(a.removed),
          lastStepAt: stepAt(a.lastStepAt),
          ...(typeof a.parentId === 'string' ? { parentId: a.parentId } : {}),
        },
      ]),
  )

// Defensive read: the store is JSON written by an earlier version or by hand.
export const parseSnapshot = (raw: unknown): Snapshot => {
  if (!isRecord(raw)) return emptySnapshot()
  const r = raw
  return {
    totals: parseTotals(r.totals),
    tools: num(r.tools),
    lastStepAt: stepAt(r.lastStepAt),
    workMs: num(r.workMs),
    costUsd: num(r.costUsd),
    added: num(r.added),
    removed: num(r.removed),
    agents: num(r.agents),
    bg: num(r.bg),
    byAgent: parseAgents(r.byAgent),
    byModel: Object.fromEntries(
      Object.entries(isRecord(r.byModel) ? r.byModel : {}).map(([m, t]) => [m, parseTotals(t)]),
    ),
    costByModel: Object.fromEntries(
      Object.entries(isRecord(r.costByModel) ? r.costByModel : {}).map(([m, c]) => [m, num(c)]),
    ),
    advisor: parseAdvisor(r.advisor),
    ...(typeof r.engineGap === 'number' ? { engineGap: num(r.engineGap) } : {}),
    steps: num(r.steps),
    // A record of an older version has no list: its calls are not known.
    mcpCalls: Array.isArray(r.mcpCalls)
      ? r.mcpCalls.filter((x): x is string => typeof x === 'string')
      : typeof r.tools === 'number'
        ? [UNKNOWN_CALLS]
        : [],
    ...(typeof r.mainModel === 'string' ? { mainModel: r.mainModel } : {}),
  }
}

// False for a value of an older shape: live state outlasts a hot reload, so after the mod
// gains a field the state it finds lacks it (and `undefined + n` is NaN).
export const isComplete = (s: Partial<Snapshot>): boolean =>
  [s.tools, s.workMs, s.costUsd, s.added, s.removed, s.agents, s.bg, s.steps].every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  ) &&
  isRecord(s.byAgent) &&
  isRecord(s.byModel) &&
  isRecord(s.costByModel) &&
  Array.isArray(s.mcpCalls) &&
  [s.advisor?.calls, s.advisor?.ms, s.advisor?.usd, s.advisor?.base].every(Number.isFinite)

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
