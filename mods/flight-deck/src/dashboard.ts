import type { Dashboard, ModelRow, Registry, Snapshot } from '../types'
import { PALETTE } from './palette'
import { costOf } from './price'
import { workedMs } from './registry'

// A model id without its vendor prefix and its date: `haiku-4-5`.
export const shortModel = (model: string): string =>
  model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

// The row of the ledger cost that no model row holds: requests that are not a step of a loop
// (the advisor, compaction, a fork of the main loop), and the error of the estimate. It is
// not a model. Absent under a cent, or when a row has no price.
export const SIDE = 'side requests'

// The row of the advisor: a step's usage leaves its tokens out, so its cost is the growth of
// the ledger over the turns that called it. Unknown (and in the side requests row) until then.
export const ADVISOR = 'advisor'

// The dashboard of a session at `now`: a row per model that ran a step or an agent, the
// costliest first. Cost is estimated from the model's tokens, priced at each step where the
// snapshot has it; the total is the engine's.
export const dashboard = (snap: Snapshot, entries: Registry, now: number): Dashboard => {
  const rows = new Map<string, ModelRow>()
  const row = (model: string): ModelRow => {
    const cur = rows.get(model)
    if (cur !== undefined) return cur
    const totals = snap.byModel[model]
    const estimate = totals === undefined ? 0 : costOf(model, totals)
    const next: ModelRow = {
      model: shortModel(model),
      costUsd: estimate === null ? null : (snap.costByModel[model] ?? estimate),
      workMs: 0,
      runs: 0,
    }
    rows.set(model, next)
    return next
  }
  for (const model of Object.keys(snap.byModel)) row(model)
  if (snap.mainModel !== undefined) {
    const main = row(snap.mainModel)
    main.workMs += snap.workMs
    main.main = true
  }
  for (const a of Object.values(entries)) {
    if (a.model === undefined) continue
    const r = row(a.model)
    r.workMs += workedMs(a, now)
    r.runs += a.runs
  }
  const sorted = [...rows.values()].sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1))
  const rest = sorted.every((r) => r.costUsd !== null)
    ? snap.costUsd - sorted.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
    : 0
  const { calls, ms, usd, model } = snap.advisor
  const side = rest - usd
  return {
    costUsd: snap.costUsd,
    rows: [
      ...sorted,
      ...(calls === 0
        ? []
        : [
            {
              model: model === undefined ? ADVISOR : `${ADVISOR}·${shortModel(model)}`,
              costUsd: usd > 0 ? usd : null,
              workMs: ms,
              runs: calls,
            },
          ]),
      ...(side < 0.005 ? [] : [{ model: SIDE, costUsd: side, workMs: 0, runs: 0 }]),
    ],
  }
}

// The name of a row's cost among the costs the pane animates.
export const rowKey = (model: string): string => `row:${model}`

// The costs of a dashboard that run to a new value when they change, by name.
export const usdTargets = (d: Dashboard): Record<string, number> => ({
  total: d.costUsd,
  ...Object.fromEntries(
    d.rows.flatMap((r) => (r.costUsd === null ? [] : [[rowKey(r.model), r.costUsd]])),
  ),
})

// The runs cell of a row. The main loop is not a run of an agent: its row says `main`, with
// the runs of the agents on the same model after it.
export const runsText = (r: ModelRow): string =>
  r.main !== true ? String(r.runs) : r.runs === 0 ? 'main' : `main+${r.runs}`

// The share of a cost in the session's total, a whole percent. Null with no cost or no total.
export const sharePct = (costUsd: number | null, total: number): number | null =>
  costUsd === null || total <= 0 ? null : Math.round((costUsd / total) * 100)

// The color of a share: warmer for a larger one, so the costly rows stand out.
export const shareColor = (pct: number): string =>
  pct >= 50 ? PALETTE.red : pct >= 25 ? PALETTE.orange : pct >= 10 ? PALETTE.yellow : PALETTE.dim
