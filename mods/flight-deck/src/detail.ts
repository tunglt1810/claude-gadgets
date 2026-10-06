import type { AgentEntry, Cell } from '../types'
import { cut } from './clip'
import { shortModel } from './dashboard'
import { contextColor, contextText } from './window'

const SEP = '·'

// The cells of the row below an agent's row: the model, the effort and the context length,
// a dot between them. The pane draws them with one cell between cells, so the row is as
// wide as the texts joined by a space. A row wider than `room` drops the counts of the
// context first; then the model is cut.
export const detailCells = (a: AgentEntry, room: number): Cell[] => {
  const ctx = a.context
  if (a.model === undefined && ctx === undefined) return [{ text: 'no step yet', dim: true }]
  const build = (model: string | undefined, isFull: boolean): Cell[] => {
    const parts: Cell[] = [
      ...(model === undefined ? [] : [{ text: model, dim: true }]),
      ...(a.effort === undefined ? [] : [{ text: a.effort, dim: true }]),
      ...(ctx === undefined ? [] : [{ text: contextText(ctx, isFull), color: contextColor(ctx) }]),
    ]
    return parts.flatMap((p, i) => (i === 0 ? [p] : [{ text: SEP, dim: true }, p]))
  }
  const width = (cells: Cell[]) => cells.reduce((n, c) => n + c.text.length, 0) + cells.length - 1
  const model = a.model === undefined ? undefined : shortModel(a.model)
  const wide = build(model, true)
  if (width(wide) <= room) return wide
  const short = build(model, false)
  if (model === undefined || width(short) <= room) return short
  // The model gives the room the row is short of, and keeps one character at least.
  return build(cut(model, Math.max(1, model.length - (width(short) - room))), false)
}
