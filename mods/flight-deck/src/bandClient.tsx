import type { ClientModule } from 'claude-code'
import { remainingMs, ttlMs } from './countdown'
import { type BandInput, bandSegments } from './layout'

// What the band draws, without the time and without the counts of a tween.
export type BandProps = Omit<BandInput, 'now' | 'shown'>

// `hasTick` names the timer that runs; `isLive` is true while a time in the band changes.
type State = { tick: number; hasTick?: true; isLive?: boolean }

// The text of the band on a desktop. The engine holds the handle of a button for one drawing
// only, so a band that is drawn again each second drops a click on the agents button. This
// cell draws the times on a timer of its own, and the hook draws the band only when its data
// changes. As in `cellClient.tsx`, a band at rest sets no state and a drawing sets it one time
// at most.
const BandClient: ClientModule<BandProps, State> = (p, surface) => {
  const { Text } = surface.elements
  const now = Date.now()
  const rem = remainingMs(p.snap.lastStepAt, now, ttlMs(p.ttl))
  // The countdown of the cache runs, or a turn works.
  const isLive = p.busySince !== null || (rem !== null && rem > 0)
  const held = surface.state ?? { tick: 0 }
  let s = held
  if (isLive && s.hasTick !== true) {
    surface.every(1000, () => {
      const cur = surface.state
      if (cur?.isLive !== true) return
      surface.setState({ ...cur, tick: (cur.tick + 1) % 1000 })
    })
    s = { ...s, hasTick: true }
  }
  if (isLive !== (s.isLive === true)) s = { ...s, isLive }
  if (s !== held) surface.setState(s)
  // The agents button is the page's: a button here has no handle of the engine.
  const segments = bandSegments({ ...p, now }).filter((seg) => seg.isButton !== true)
  return (
    <Text wrap="truncate">
      {segments.map((seg, i) => (
        <Text key={String(i)} color={seg.color} bold={seg.bold} inverse={seg.inverse}>
          {seg.text}
        </Text>
      ))}
    </Text>
  )
}

export default BandClient
