import type { AgentEntry, Cell } from '../types'
import { dotted, rowWidth as width } from './cell'
import { cut } from './clip'
import { shortModel } from './dashboard'
import { contextColor } from './window'

export const detailCells = (a: AgentEntry, room: number): Cell[] => {
  const ctx = a.context
  if (a.model === undefined && ctx === undefined) return [{ text: 'no step yet', dim: true }]
  const build = (model: string | undefined, hasEffort: boolean, isFull: boolean): Cell[] => {
    const parts: Cell[] = [
      ...(model === undefined ? [] : [{ text: model, dim: true }]),
      ...(a.effort === undefined || !hasEffort ? [] : [{ text: a.effort, dim: true }]),
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
  const kept = model === undefined ? 0 : model.length - (width(short) - room)
  if (model !== undefined && kept >= 2) return build(cut(model, kept), true, false)
  const rest = [build(undefined, true, false), build(undefined, false, false)].filter(
    (cells) => cells.length > 0,
  )
  const fit = rest.find((cells) => width(cells) <= room)
  if (fit !== undefined) return fit
  return ctx === undefined
    ? [{ text: cut(model ?? '', Math.max(1, room)), dim: true }]
    : build(undefined, false, false)
}
