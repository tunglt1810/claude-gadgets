import type { ClientModule } from 'claude-code'
import type { Cell } from '../types'
import { cellText } from './cell'
import { SPIN_MS } from './spinner'
import { retarget, type Tween, valueAt } from './tween'

// `usd` is the tween of a cost cell.
type State = { tick: number; now: number; usd?: Tween }

const FRAME_MS = 60

// Every cell of a pane row on a desktop that is not a button. One way to draw them keeps them
// on one line with the buttons beside them. A turning or counting cell draws itself again on
// its own timer: only its region is drawn, never the pane, so a click on a button is not lost.
const CellClient: ClientModule<Cell, State> = (c, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    if (c.spin === true || c.since !== undefined)
      surface.every(c.spin === true ? SPIN_MS : 1000, () =>
        surface.setState({ tick: ((surface.state?.tick ?? 0) + 1) % 1000, now: Date.now() }),
      )
    // A cost cell draws each frame while its cost runs, and nothing when the cost is there.
    if (c.usd !== undefined)
      surface.every(FRAME_MS, () => {
        const cur = surface.state
        if (cur?.usd === undefined || valueAt(cur.usd, cur.now) === cur.usd.to) return
        surface.setState({ ...cur, now: Date.now() })
      })
    surface.setState({
      tick: 0,
      now: Date.now(),
      // The first cost is shown at once: no count-up when the pane opens.
      ...(c.usd === undefined ? {} : { usd: { from: c.usd, to: c.usd, startedAt: 0 } }),
    })
  }
  const s = surface.state ?? { tick: 0, now: Date.now() }
  // A new cost in the props: run to it from the cost on screen.
  if (c.usd !== undefined && s.usd !== undefined && s.usd.to !== c.usd) {
    const at = Date.now()
    surface.setState({ ...s, now: at, usd: retarget(s.usd, c.usd, at) })
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
      {cellText(unpadded, s.tick, s.now, s.usd === undefined ? c.usd : valueAt(s.usd, s.now))}
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
