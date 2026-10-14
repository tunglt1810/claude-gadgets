import type { Cell, Snapshot, ToolsView } from '../types'
import { PALETTE } from './palette'

// What the tools screen draws of a snapshot: a row per tool, the most calls first, then by name.
export const toolsView = (s: Pick<Snapshot, 'tools' | 'byTool'>): ToolsView => {
  const rows = Object.entries(s.byTool)
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const listed = rows.reduce((n, r) => n + r.calls, 0)
  return { total: s.tools, hidden: Math.max(0, s.tools - listed), rows }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

// The cell after the tools button, and the headline of the tools screen.
export const toolsHead = (v: ToolsView): Cell =>
  v.total === 0
    ? { text: 'no call', dim: true }
    : {
        text:
          v.rows.length === 0
            ? plural(v.total, 'call')
            : `${plural(v.total, 'call')} · ${plural(v.rows.length, 'tool')}`,
        color: PALETTE.orange,
      }
