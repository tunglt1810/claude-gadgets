import type { Cell } from '../types'
import { formatDuration } from './format'
import { spinnerFrame } from './spinner'

// The text of a cell at a spinner tick and a time: the terminal draws it as a Text, a desktop
// in its own `Client` (./cellClient.tsx), so both surfaces show the same characters.
export const cellText = (c: Cell, tick: number, now: number): string => {
  const base = c.spin
    ? spinnerFrame(tick)
    : c.since === undefined
      ? c.text
      : `${c.text}${formatDuration(now - c.since)}`
  return c.align === 'right' && c.width !== undefined ? base.padStart(c.width) : base
}
