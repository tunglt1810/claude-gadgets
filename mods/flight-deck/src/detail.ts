import type { AgentEntry, Cell } from '../types'
import { dotted, rowWidth as width } from './cell'
import { cut } from './clip'
import { shortModel } from './dashboard'
import { contextColor } from './window'

// The cells of the row below an agent's row: the model, the effort and the context length,
// a dot between them. The pane draws them with one cell between cells, so the row is as
// wide as the texts joined by a space. A row wider than `room` drops the counts of the
// context first. Then the model is cut, then dropped, then the effort is dropped.
export const detailCells = (a: AgentEntry, room: number): Cell[] => {
  const ctx = a.context
  if (a.model === undefined && ctx === undefined) return [{ text: 'no step yet', dim: true }]
  const build = (model: string | undefined, hasEffort: boolean, isFull: boolean): Cell[] => {
    const parts: Cell[] = [
      ...(model === undefined ? [] : [{ text: model, dim: true }]),
      ...(a.effort === undefined || !hasEffort ? [] : [{ text: a.effort, dim: true }]),
      // A cell of its own kind: its tokens run to a new count when they change.
      ...(ctx === undefined
        ? []
        : [{ text: '', ctx: { ...ctx, isFull }, color: contextColor(ctx) }]),
    ]
    return dotted(parts)
  }
  const model = a.model === undefined ? undefined : shortModel(a.model)
  const wide = build(model, true, true)
  if (width(wide) <= room) return wide
  const short = build(model, true, false)
  if (width(short) <= room) return short
  // The model gives the room the row is short of, while two of its characters stay.
  const kept = model === undefined ? 0 : model.length - (width(short) - room)
  if (model !== undefined && kept >= 2) return build(cut(model, kept), true, false)
  const rest = [build(undefined, true, false), build(undefined, false, false)].filter(
    (cells) => cells.length > 0,
  )
  const fit = rest.find((cells) => width(cells) <= room)
  if (fit !== undefined) return fit
  // The percentage alone is the least a row with a context draws. With no context, the
  // model is: it is cut to the room.
  return ctx === undefined
    ? [{ text: cut(model ?? '', Math.max(1, room)), dim: true }]
    : build(undefined, false, false)
}
