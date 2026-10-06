import type { Elements } from 'claude-code'
import type { AgentEntry, PaneView, Registry, TranscriptItem } from '../types'
import { clipLines, cut } from './clip'
import { PALETTE } from './palette'
import { spinnerFrame } from './spinner'
import { inputCode, toolSummary } from './summary'
import { lastItems } from './transcript'
import { treeRows } from './tree'

type Props = {
  ui: Elements[keyof Elements]
  entries: Registry
  view: PaneView
  // The spinner's tick count: a running agent's mark turns with it.
  spin: number
  columns: number
  onOpen: (agentId: string) => void
  onBack: () => void
  onWrap: () => void
  onTool: (toolUseId: string) => void
}

// The most lines of a tool call's input, and of its result, that the pane draws.
const MAX_LINES = 40
// The mark of an idle agent; a running one is drawn with the spinner's frame.
const IDLE = '○'
// The color of an agent's mark by its status.
const TONE = { running: PALETTE.green, idle: PALETTE.dim } as const
const OPEN_CHILD = ' [open]'
// A tool call by its outcome: its mark and the color of the mark. A finished call is dim at
// rest, so the failed and the running ones stand out.
const TOOL_MARK = { done: '✓', failed: '✗' } as const
const TOOL_TONE = { done: PALETTE.green, failed: PALETTE.red, running: PALETTE.yellow } as const

const runs = (n: number): string => `${n} run${n === 1 ? '' : 's'}`

const title = (a: AgentEntry): string =>
  [a.type ?? 'agent', a.description ?? a.name ?? a.id, runs(a.runs)].join(' · ')

// The agents pane: the tree of the session's agents, or one agent's transcript. The engine
// owns the scroll, so the whole tree is drawn; every row is cut to `columns`.
export const AgentPane = ({
  ui,
  entries,
  view,
  spin,
  columns,
  onOpen,
  onBack,
  onWrap,
  onTool,
}: Props) => {
  const { Box, Text, Button, Code, Markdown } = ui
  const viewed = view.agentId
  // State of an older shape (a hot reload) has no flag: the rows are cut then.
  const isWrapped = view.isWrapped === true
  const codeWrap = isWrapped ? 'wrap' : 'truncate-end'
  const busy = spinnerFrame(spin)
  const markOf = (a: AgentEntry): string => (a.status === 'running' ? busy : IDLE)

  if (viewed === null) {
    const rows = treeRows(entries)
    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>No agents yet.</Text>}
        {rows.map(({ agent, depth }) => (
          // A Button takes no color: the status is the colored mark before it, and an idle
          // agent's row is dim at rest.
          <Box key={`row:${agent.id}`} flexDirection="row">
            <Text key={`mark:${agent.id}`} color={TONE[agent.status]}>
              {`${'  '.repeat(depth)}${markOf(agent)} `}
            </Text>
            <Button
              key={`agent:${agent.id}`}
              plain
              {...(agent.status === 'idle' ? { dimColor: true } : {})}
              label={cut(title(agent), columns - depth * 2 - 2)}
              onPress={() => onOpen(agent.id)}
            />
          </Box>
        ))}
      </Box>
    )
  }

  const item = (it: TranscriptItem, i: number) => {
    if (it.kind === 'prompt')
      return (
        <Text key={String(i)} color={PALETTE.cyan} wrap={isWrapped ? 'wrap' : 'truncate'}>
          {isWrapped ? `> ${it.text}` : cut(`> ${it.text}`, columns)}
        </Text>
      )
    if (it.kind === 'text') return <Markdown key={String(i)} text={it.text} />
    if (it.kind === 'answer')
      return (
        <Box key={String(i)} flexDirection="column">
          <Text dimColor>answer:</Text>
          <Markdown text={it.text} />
        </Box>
      )
    const isOpen = view.expanded.includes(it.id)
    const state = it.result === undefined ? 'running' : it.isError ? 'failed' : 'done'
    const child = it.agentId
    const room = columns - 2 - (child === undefined ? 0 : OPEN_CHILD.length)
    return (
      <Box key={String(i)} flexDirection="column">
        <Box flexDirection="row">
          <Text
            color={TOOL_TONE[state]}
          >{`${state === 'running' ? busy : TOOL_MARK[state]} `}</Text>
          <Button
            key={`tool:${it.id}`}
            plain
            {...(state === 'done' ? { dimColor: true } : {})}
            label={cut(`${isOpen ? '▾' : '▸'} ${toolSummary(it.tool, it.input)}`, room)}
            onPress={() => onTool(it.id)}
          />
          {child !== undefined && (
            <Button key={`child:${it.id}`} plain label={OPEN_CHILD} onPress={() => onOpen(child)} />
          )}
        </Box>
        {isOpen && <Code {...inputCode(it.tool, it.input, MAX_LINES)} wrap={codeWrap} />}
        {isOpen && it.result !== undefined && (
          <Code source={clipLines(it.result, MAX_LINES)} wrap={codeWrap} />
        )}
      </Box>
    )
  }

  // A transcript read for another agent is never drawn.
  const shown = view.transcript?.agentId === viewed ? view.transcript : null
  const body = () => {
    if (shown === null) return <Text dimColor>Loading...</Text>
    if ('deny' in shown) return <Text color={PALETTE.red}>{shown.deny}</Text>
    if (shown.items.length === 0) return <Text dimColor>No messages yet.</Text>
    const { items, hidden } = lastItems(shown.items)
    return (
      <Box flexDirection="column">
        {hidden > 0 && <Text dimColor>{`... ${hidden} older items hidden`}</Text>}
        {items.map(item)}
      </Box>
    )
  }

  const agent = entries[viewed]
  return (
    <Box flexDirection="column">
      {/* The toolbar: real buttons (`[ label ]` on the terminal, native ones on desktop), so
          they read as controls beside the transcript's plain rows. */}
      <Box flexDirection="row" gap={1}>
        <Button key="back" label="← agents" onPress={onBack} />
        <Button
          key="wrap"
          {...(isWrapped ? { variant: 'primary' as const } : {})}
          label={`wrap ${isWrapped ? 'on' : 'off'}`}
          onPress={onWrap}
        />
      </Box>
      <Text
        key="title"
        bold
        color={agent?.status === 'running' ? TONE.running : PALETTE.fg}
        wrap="truncate"
      >
        {cut(agent === undefined ? viewed : `${markOf(agent)} ${title(agent)}`, columns)}
      </Text>
      {/* Parts the header (toolbar and title) from the transcript below it. */}
      <Text key="rule" dimColor wrap="truncate">
        {'─'.repeat(Math.max(0, columns))}
      </Text>
      {body()}
    </Box>
  )
}
