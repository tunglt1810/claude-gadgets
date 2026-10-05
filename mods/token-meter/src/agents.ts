import type { AgentUsage, Snapshot } from '../types'
import { emptySnapshot } from './snapshot'
import { emptyTotals } from './usage'

export type { AgentUsage }

export const emptyAgent = (): AgentUsage => ({
  totals: emptyTotals(),
  tools: 0,
  added: 0,
  removed: 0,
  lastStepAt: null,
})

// The per-agent table with one agent changed; an agent not seen before starts empty.
// The main loop (no id) has no entry: its numbers are the session's.
export const bumpAgent = (
  byAgent: Record<string, AgentUsage>,
  id: string | undefined,
  fn: (a: AgentUsage) => AgentUsage,
): Record<string, AgentUsage> =>
  id === undefined ? byAgent : { ...byAgent, [id]: fn(byAgent[id] ?? emptyAgent()) }

// What the band draws while one agent's transcript is on screen: that agent plus every
// agent spawned below it. Cost and work time exist per session only and stay zero.
export const agentView = (snap: Snapshot, id: string): Snapshot => {
  const ids = new Set([id])
  const all = Object.entries(snap.byAgent)
  for (let size = 0; size !== ids.size; ) {
    size = ids.size
    for (const [k, a] of all) if (a.parentId !== undefined && ids.has(a.parentId)) ids.add(k)
  }
  const view = { ...emptySnapshot(), lastStepAt: snap.byAgent[id]?.lastStepAt ?? null }
  for (const [k, a] of all) {
    if (!ids.has(k)) continue
    view.totals.input += a.totals.input
    view.totals.output += a.totals.output
    view.totals.cacheRead += a.totals.cacheRead
    view.totals.cacheWrite += a.totals.cacheWrite
    view.tools += a.tools
    view.added += a.added
    view.removed += a.removed
  }
  return view
}
