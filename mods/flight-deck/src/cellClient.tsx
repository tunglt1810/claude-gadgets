import type { ClientModule } from 'claude-code'
import type { Cell } from '../types'
import { cellText } from './cell'
import { SPIN_MS } from './spinner'

type State = { tick: number; now: number }

// Every cell of a pane row on a desktop that is not a button. One way to draw them keeps them
// on one line with the buttons beside them. A turning or counting cell draws itself again on
// its own timer: only its region is drawn, never the pane, so a click on a button is not lost.
const CellClient: ClientModule<Cell, State> = (c, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    if (c.spin === true || c.since !== undefined)
      surface.every(c.spin === true ? SPIN_MS : 1000, () =>
        surface.setState({ tick: ((surface.state?.tick ?? 0) + 1) % 1000, now: Date.now() }),
      )
    surface.setState({ tick: 0, now: Date.now() })
  }
  const s = surface.state ?? { tick: 0, now: Date.now() }
  return (
    <Text
      wrap="truncate"
      {...(c.color === undefined ? {} : { color: c.color })}
      {...(c.dim === true ? { dimColor: true } : {})}
      {...(c.bold === true ? { bold: true } : {})}
    >
      {cellText(c, s.tick, s.now)}
    </Text>
  )
}

export default CellClient
