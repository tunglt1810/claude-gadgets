import type { Elements } from 'claude-code'
import { bandSegments } from './layout'
import type { Snapshot } from './snapshot'
import type { Counts } from './tween'

type Props = {
  ui: Elements[keyof Elements]
  snap: Snapshot
  shown?: Counts
  busySince: number | null
  now: number
  ttl: '5m' | '1h'
  columns: number
  isAgentView?: boolean
}

// One Text with nested Texts: a single inline row, no flex container that could grow an
// extra row. `bandSegments` already fits the text to `columns`.
export const Band = ({ ui, snap, shown, busySince, now, ttl, columns, isAgentView }: Props) => {
  const { Text } = ui
  const segments = bandSegments({ snap, shown, busySince, now, ttl, columns, isAgentView })
  return (
    <Text wrap="truncate">
      {segments.map((s, i) => (
        <Text
          key={String(i)}
          color={s.color}
          bold={s.bold}
          inverse={s.inverse}
          strikethrough={s.strike}
        >
          {s.text}
        </Text>
      ))}
    </Text>
  )
}
