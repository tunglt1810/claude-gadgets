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
