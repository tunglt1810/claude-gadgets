import type { Dashboard, ModelRow, Registry, Snapshot } from '../types'
import { costOf } from './price'
import { workedMs } from './registry'

// A model id without its vendor prefix and its date: `haiku-4-5`.
export const shortModel = (model: string): string =>
  model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

// The dashboard of a session at `now`: a row per model that ran a step or an agent, the
// costliest first. Cost is estimated from the model's tokens; the total is the engine's.
export const dashboard = (snap: Snapshot, entries: Registry, now: number): Dashboard => {
  const rows = new Map<string, ModelRow>()
  const row = (model: string): ModelRow => {
    const cur = rows.get(model)
    if (cur !== undefined) return cur
    const totals = snap.byModel[model]
    const next = {
      model: shortModel(model),
      costUsd: totals === undefined ? 0 : costOf(model, totals),
      workMs: 0,
      runs: 0,
    }
    rows.set(model, next)
    return next
  }
  for (const model of Object.keys(snap.byModel)) row(model)
  if (snap.mainModel !== undefined) row(snap.mainModel).workMs += snap.workMs
  for (const a of Object.values(entries)) {
    if (a.model === undefined) continue
    const r = row(a.model)
    r.workMs += workedMs(a, now)
    r.runs += a.runs
  }
  return {
    costUsd: snap.costUsd,
    rows: [...rows.values()].sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1)),
  }
}
