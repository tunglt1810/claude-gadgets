import type { Cell } from '../types'
import { formatDuration, formatUsd } from './format'
import { spinnerFrame } from './spinner'
import { contextText } from './window'

export const cellText = (
  c: Cell,
  tick: number,
  now: number,
  value = c.usd ?? c.ctx?.tokens,
): string => {
  const base = c.spin
    ? spinnerFrame(tick)
    : c.ctx !== undefined
      ? contextText(
          { tokens: Math.round(value ?? c.ctx.tokens), window: c.ctx.window },
          c.ctx.isFull,
        )
      : value !== undefined
        ? `${c.text}${formatUsd(value)}`
        : c.since === undefined
          ? c.text
          : `${c.text}${formatDuration(now - c.since)}`
  return c.align === 'right' && c.width !== undefined ? base.padStart(c.width) : base
}

export const dotted = (parts: Cell[]): Cell[] =>
  parts.flatMap((p, i) => (i === 0 ? [p] : [{ text: '·', dim: true }, p]))

export const rowWidth = (cells: Cell[]): number =>
  cells.reduce((n, c) => n + cellText(c, 0, 0).length, 0) + Math.max(0, cells.length - 1)
