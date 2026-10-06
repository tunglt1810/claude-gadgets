// Model working time: the union of turn intervals. `active` counts open turns so
// overlapping turns (subagents) are not double counted.
export type Work = { workMs: number; active: number; busySince: number | null }

export const emptyWork = (): Work => ({ workMs: 0, active: 0, busySince: null })

export const startTurn = (w: Work, at: number): Work => ({
  ...w,
  active: w.active + 1,
  busySince: w.active === 0 ? at : w.busySince,
})

export const endTurn = (w: Work, at: number): Work => {
  if (w.active === 0) return w
  const active = w.active - 1
  return active > 0
    ? { ...w, active }
    : { workMs: w.workMs + Math.max(0, at - (w.busySince ?? at)), active: 0, busySince: null }
}

// Total including the interval that is still open.
export const workElapsed = (w: Work, now: number): number =>
  w.workMs + (w.busySince === null ? 0 : Math.max(0, now - w.busySince))

// The work of a session with the agents whose run holds an interval. A run of an agent has no
// start event: its first step opens the interval, its end closes it. Inside a turn of the main
// loop the intervals overlap and count once.
export type Runs = Work & { working: string[] }

export const startRun = (w: Runs, id: string, at: number): Runs => {
  // State of an older shape (a hot reload) has no list.
  const working = w.working ?? []
  return working.includes(id)
    ? { ...w, working }
    : { ...w, ...startTurn(w, at), working: [...working, id] }
}

export const endRun = (w: Runs, id: string, at: number): Runs =>
  (w.working ?? []).includes(id)
    ? { ...w, ...endTurn(w, at), working: w.working.filter((x) => x !== id) }
    : w
