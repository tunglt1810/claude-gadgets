import type { PaneData, Registry, Snapshot } from '../types'
import { agentView } from './agents'
import { dashboard } from './dashboard'

// What the pane draws, and nothing more: the pane is drawn again on each change of it, and a
// desktop drops a click on a native button that a redraw replaced. The transcript screen
// takes only the viewed agent, so the other agents and the main loop do not redraw it. The
// tree screen's dashboard is drawn again when a step or the cost changes it.
export const paneData = (
  sessionId: string,
  entries: Registry,
  viewed: string | null,
  snap: Snapshot,
  now: number,
): PaneData => {
  if (viewed === null)
    return { sessionId, entries, stats: null, dashboard: dashboard(snap, entries, now) }
  const agent = entries[viewed]
  return {
    sessionId,
    entries: agent === undefined ? {} : { [viewed]: agent },
    stats: agentView(snap, viewed),
    dashboard: null,
  }
}
