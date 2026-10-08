import type { ContextView, PaneData, Registry, Snapshot } from '../types'
import { agentView } from './agents'
import { breaksView } from './breaks'
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
  context: ContextView | null,
): PaneData => {
  if (viewed === null)
    return {
      sessionId,
      entries,
      stats: null,
      dashboard: dashboard(snap, entries, now),
      context,
      breaks: breaksView(snap),
    }
  const agent = entries[viewed]
  return {
    sessionId,
    entries: agent === undefined ? {} : { [viewed]: agent },
    stats: agentView(snap, viewed),
    dashboard: null,
    context: null,
    breaks: null,
  }
}
