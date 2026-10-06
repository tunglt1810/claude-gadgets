import type { Elements } from 'claude-code'
import { bandSegments, type Segment } from './layout'
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
  // In an agent view: the agent's model id and effort, its name and its context length.
  model?: string
  name?: string
  context?: { tokens: number; window: number }
  isPaneOpen: boolean
  onToggle: () => void
}

// A single inline row. With the agents button the row is a Box of three parts: the text, a
// part that takes the free room, and the button at the right end. Without the button it is
// one Text with nested Texts, which cannot grow an extra row.
// `bandSegments` already fits the text to `columns`. The agents button is a primary Button, so it reads as a
// control: `[ label ]` in the accent color on the terminal, a native button on desktop.
// `bandSegments` puts the open or closed mark in its label.
export const Band = ({
  ui,
  snap,
  shown,
  busySince,
  now,
  ttl,
  columns,
  isAgentView,
  model,
  name,
  context,
  isPaneOpen,
  onToggle,
}: Props) => {
  const { Box, Text, Button } = ui
  const segments = bandSegments({
    snap,
    shown,
    busySince,
    now,
    ttl,
    columns,
    isAgentView,
    isPaneOpen,
    ...(model === undefined ? {} : { model }),
    ...(name === undefined ? {} : { name }),
    ...(context === undefined ? {} : { context }),
  })
  const run = (segs: Segment[], key: string) => (
    <Text key={key} wrap="truncate">
      {segs.map((s, i) => (
        <Text key={String(i)} color={s.color} bold={s.bold} inverse={s.inverse}>
          {s.text}
        </Text>
      ))}
    </Text>
  )
  const at = segments.findIndex((s) => s.isButton)
  const button = segments[at]
  if (button === undefined) return run(segments, 'all')
  return (
    <Box flexDirection="row">
      {run(segments.slice(0, at), 'before')}
      <Box key="room" flexGrow={1} />
      <Button key="agents" variant="primary" label={button.text} onPress={onToggle} />
    </Box>
  )
}
