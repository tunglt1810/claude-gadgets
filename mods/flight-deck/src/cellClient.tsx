import type { ClientModule } from 'claude-code'
import type { Cell } from '../types'
import { cellText } from './cell'
import { SPIN_MS } from './spinner'
import { retarget, type Tween, valueAt } from './tween'

// `value` is the tween of a cell that counts: a cost, or the tokens of a context length.
type State = { tick: number; now: number; value?: Tween }

const FRAME_MS = 60

// Every cell of a pane row on a desktop that is not a button. One way to draw them keeps them
// on one line with the buttons beside them. A turning or counting cell draws itself again on
// its own timer: only its region is drawn, never the pane, so a click on a button is not lost.
const CellClient: ClientModule<Cell, State> = (c, surface) => {
  const { Box, Text } = surface.elements
  const target = c.usd ?? c.ctx?.tokens
  if (surface.state === undefined) {
    if (c.spin === true || c.since !== undefined)
      surface.every(c.spin === true ? SPIN_MS : 1000, () =>
        surface.setState({ tick: ((surface.state?.tick ?? 0) + 1) % 1000, now: Date.now() }),
      )
    // A counting cell draws each frame while its number runs, and nothing when it is there.
    if (target !== undefined)
      surface.every(FRAME_MS, () => {
        const cur = surface.state
        if (cur?.value === undefined || valueAt(cur.value, cur.now) === cur.value.to) return
        surface.setState({ ...cur, now: Date.now() })
      })
    surface.setState({
      tick: 0,
      now: Date.now(),
      // The first number is shown at once: no count-up when the pane opens.
      ...(target === undefined ? {} : { value: { from: target, to: target, startedAt: 0 } }),
    })
  }
  const s = surface.state ?? { tick: 0, now: Date.now() }
  // A new number in the props: run to it from the number on screen.
  if (target !== undefined && s.value !== undefined && s.value.to !== target) {
    const at = Date.now()
    surface.setState({ ...s, now: at, value: retarget(s.value, target, at) })
  }
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
