import type { Elements } from 'claude-code'
import type { BandProps } from './bandClient'
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
  // A desktop: the text is a `Client`.
  isDesktop: boolean
  // The engine draws a Text in the monospaced face (2.1.299 and later).
  isMono: boolean
  onToggle: () => void
}

// The cells of the monospaced face that one character of a desktop's proportional face takes:
// the band measured 0.64 for most letters, and 0.75 for a band with more digits.
const PROPORTIONAL_CELL = 0.75

// A single inline row. With the Flight Deck button the row is a Box of three parts: the text, a
// part that takes the free room, and the button at the right end. Without the button it is
// one Text with nested Texts, which cannot grow an extra row.
// `bandSegments` already fits the text to `columns`. The Flight Deck button is a primary Button, so it reads as a
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
  isDesktop,
  isMono,
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
  if (isDesktop && 'Client' in ui) {
    // A desktop holds the handle of a button for one drawing: the text, whose times change
    // each second, is a `Client` with a timer of its own, and this tree changes only with its
    // data. The parts of the snapshot that the band does not draw are left out.
    // `columns` counts cells of the monospaced face. An engine before 2.1.299 draws the text
    // in the proportional face, which is narrower: the band fits it to more cells.
    const props: BandProps = {
      snap: { ...snap, byAgent: {}, byModel: {}, costByModel: {}, mcpCalls: [], byTool: {} },
      busySince,
      ttl,
      columns: isMono ? columns : Math.floor(columns / PROPORTIONAL_CELL),
      isPaneOpen,
      ...(isMono ? { mono: true as const } : {}),
      ...(isAgentView === undefined ? {} : { isAgentView }),
      ...(model === undefined ? {} : { model }),
      ...(name === undefined ? {} : { name }),
      ...(context === undefined ? {} : { context }),
    }
    return (
      // A resize draws the last tree at the new width before the hook answers, and a Client
      // is laid out at the size of the viewport until its region is: no width comes from
      // `columns`. The text shrinks and cuts, the button keeps its size, the row never wraps.
      <Box key="bandrow" flexDirection="row" flexWrap="nowrap">
        <Box key="bandtext" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" height={1}>
          <ui.Client key="band" module="./bandClient.tsx" props={props} flexGrow={1} height={1} />
        </Box>
        {button !== undefined && (
          <Box key="bandbutton" flexShrink={0}>
            <Button key="agents" variant="primary" label={button.text} onPress={onToggle} />
          </Box>
        )}
      </Box>
    )
  }
  if (button === undefined) return run(segments, 'all')
  return (
    <Box flexDirection="row">
      {run(segments.slice(0, at), 'before')}
      <Box key="room" flexGrow={1} />
      <Button key="agents" variant="primary" label={button.text} onPress={onToggle} />
    </Box>
  )
}
