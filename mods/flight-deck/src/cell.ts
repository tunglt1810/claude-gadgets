import type { Cell } from '../types'
import { formatDuration, formatUsd } from './format'
import { spinnerFrame } from './spinner'

// The text of a cell at a spinner tick and a time: the terminal draws it as a Text, a desktop
// in its own `Client` (./cellClient.tsx), so both surfaces show the same characters. `usd` is
// the cost on screen while it runs to the cell's own.
export const cellText = (c: Cell, tick: number, now: number, usd = c.usd): string => {
  const base = c.spin
    ? spinnerFrame(tick)
    : usd !== undefined
      ? `${c.text}${formatUsd(usd)}`
      : c.since === undefined
        ? c.text
        : `${c.text}${formatDuration(now - c.since)}`
  return c.align === 'right' && c.width !== undefined ? base.padStart(c.width) : base
}
