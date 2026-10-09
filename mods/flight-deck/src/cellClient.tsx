import type { ClientModule } from 'claude-code'
import type { Cell } from '../types'
import { cellText } from './cell'
import { SPIN_MS } from './spinner'
import { retarget, type Tween, valueAt } from './tween'

// `value` is the tween of a cell that counts: a cost, or the tokens of a context length.
// `hasTick` and `hasFrame` name the timers that run; `isLive` is true while the cell turns or
// counts a time.
type State = {
  tick: number
  now: number
  value?: Tween
  hasTick?: true
  hasFrame?: true
  isLive?: boolean
}

const FRAME_MS = 60

// Every cell of a pane row on a desktop that is not a button. One way to draw them keeps them
// on one line with the buttons beside them. A turning or counting cell draws itself again on
// its own timer: only its region is drawn, never the pane, so a click on a button is not lost.
//
// A desktop unmounts every cell of the mod when they send more than 400 messages in one
// second, and each `setState` sends two. Thus a cell that does not change sets no state, a
// drawing sets it one time at most, and a timer sets it only while its cell changes.
const CellClient: ClientModule<Cell, State> = (c, surface) => {
  const { Box, Text } = surface.elements
  const target = c.usd ?? c.ctx?.tokens
  const isLive = c.spin === true || c.since !== undefined
  const held = surface.state ?? { tick: 0, now: Date.now() }
  let s = held
  if (isLive && s.hasTick !== true) {
    // The agent of a cell can end and run again: the timer stays, and draws only a live cell.
    surface.every(c.spin === true ? SPIN_MS : 1000, () => {
      const cur = surface.state
      if (cur?.isLive !== true) return
      surface.setState({ ...cur, tick: (cur.tick + 1) % 1000, now: Date.now() })
    })
    s = { ...s, hasTick: true }
  }
  if (target !== undefined && s.hasFrame !== true) {
    // A counting cell draws each frame while its number runs, and nothing when it is there.
    surface.every(FRAME_MS, () => {
      const cur = surface.state
      if (cur?.value === undefined || valueAt(cur.value, cur.now) === cur.value.to) return
      surface.setState({ ...cur, now: Date.now() })
    })
    // The first number is shown at once: no count-up when the pane opens.
    s = { ...s, hasFrame: true, value: { from: target, to: target, startedAt: 0 } }
  }
  if (isLive !== (s.isLive === true)) s = { ...s, isLive }
  // A new number in the props: run to it from the number on screen.
  if (target !== undefined && s.value !== undefined && s.value.to !== target) {
    const at = Date.now()
    s = { ...s, now: at, value: retarget(s.value, target, at) }
  }
  if (s !== held) surface.setState(s)
  // A desktop's font is not fixed-width: a space is narrower than a digit, so padding with
  // spaces does not align. The text goes unpadded, and the layout puts it at the right edge.
  const { align, ...unpadded } = c
  const text = (
    <Text
      wrap="truncate"
      {...(c.color === undefined ? {} : { color: c.color })}
      {...(c.dim === true ? { dimColor: true } : {})}
      {...(c.bold === true ? { bold: true } : {})}
    >
      {cellText(unpadded, s.tick, s.now, s.value === undefined ? target : valueAt(s.value, s.now))}
    </Text>
  )
  if (align !== 'right' || c.width === undefined) return text
  return (
    <Box width={c.width} justifyContent="flex-end">
      {text}
    </Box>
  )
}

export default CellClient
