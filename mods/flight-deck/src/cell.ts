import type { Cell } from '../types'
import { formatDuration, formatUsd } from './format'
import { spinnerFrame } from './spinner'
import { contextText } from './window'

// The text of a cell at a spinner tick and a time: the terminal draws it as a Text, a desktop
// in its own `Client` (./cellClient.tsx), so both surfaces show the same characters. `usd` is
// the cost on screen while it runs to the cell's own. `value` is that number for a cost cell,
// and the tokens on screen for a context cell.
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
