import type { AgentEntry, Registry } from '../types'

export type TreeRow = { agent: AgentEntry; depth: number }

// The registry as the pane lists it: roots first, each child below its parent, the newest
// first at each depth. An agent whose parent is not known (or is part of a cycle) is a root.
export const treeRows = (r: Registry): TreeRow[] => {
  const all = Object.values(r).sort((a, b) => b.startedAt - a.startedAt)
  const rows: TreeRow[] = []
  const done = new Set<string>()
  const walk = (a: AgentEntry, depth: number): void => {
    if (done.has(a.id)) return
    done.add(a.id)
    rows.push({ agent: a, depth })
    for (const c of all) if (c.parentId === a.id) walk(c, depth + 1)
  }
  for (const a of all) if (a.parentId === undefined || r[a.parentId] === undefined) walk(a, 0)
  // What is left is in a parent cycle: draw it as roots.
  for (const a of all) walk(a, 0)
  return rows
}
