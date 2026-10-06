import type { Elements } from 'claude-code'
import type {
  AgentEntry,
  Cell,
  Dashboard,
  PaneView,
  Registry,
  Snapshot,
  TranscriptItem,
} from '../types'
import { cellText } from './cell'
import { clipLines, cut } from './clip'
import { formatDuration, formatUsd } from './format'
import { statSegments } from './layout'
import { PALETTE } from './palette'
import { modelLabel, workedMs } from './registry'
import { inputCode, toolSummary } from './summary'
import { agentTable, runsLabel } from './table'
import { lastItems } from './transcript'
import { treeRows } from './tree'

type Props = {
  ui: Elements[keyof Elements]
  entries: Registry
  view: PaneView
  // The numbers of the agent on the transcript screen, with the agents below it.
  stats: Snapshot | null
  // The session's cost and a row per model, above the agents table.
  dashboard: Dashboard | null
  // The spinner's tick count: a running mark turns with it. Null where the pane must not be
  // drawn again on each frame (a desktop): each cell is a `Client` with its own timer then.
  spin: number | null
  // The time the working times are read at.
  now: number
  columns: number
  onOpen: (agentId: string) => void
  onBack: () => void
  onWrap: () => void
  onTool: (toolUseId: string) => void
}

// The most lines of a tool call's input, and of its result, that the pane draws.
const MAX_LINES = 40
// The mark of an ended agent; a running one turns. Every agent mark is an eight-dot braille
// glyph, as the spinner's frames are: one font draws them all at one size.
const END_MARK = { idle: '⣿', stopped: '⣿' } as const
// The width of every mark: a glyph a desktop draws wider than one cell is not cut.
const MARK_WIDTH = 2
// The color of an agent's mark by its status.
const TONE = { running: PALETTE.green, idle: PALETTE.dim, stopped: PALETTE.red } as const
const OPEN_CHILD = ' [open]'
// A tool call by its outcome: its mark and the color of the mark. A finished call is dim at
// rest, so the failed and the running ones stand out.
const TOOL_MARK = { done: '✓', failed: '✗' } as const
const TOOL_TONE = { done: PALETTE.green, failed: PALETTE.red, running: PALETTE.yellow } as const
// The icon of a working time, as the band's work clock.
const CLOCK = '◷ '
const TIME_WIDTH = 9
// The dashboard's columns: a model name stops at MAX_MODEL cells, a cost fits `≈$1234.56`.
const MAX_MODEL = 16
const USD_WIDTH = 9
const RUNS_WIDTH = 4

const name = (a: AgentEntry): string =>
  [a.type ?? 'agent', a.description ?? a.name ?? a.id].join(' · ')

const agentMark = (a: AgentEntry): Cell =>
  a.status === 'running'
    ? { text: '', spin: true, color: TONE.running, width: MARK_WIDTH }
    : { text: END_MARK[a.status], color: TONE[a.status], width: MARK_WIDTH }

// How long an agent worked: a running agent's time counts up from its start. The cell keeps
// room for `h:mm:ss`, so a running time never outgrows it.
const timeCell = (a: AgentEntry, now: number, align?: 'right'): Cell => ({
  ...(a.status === 'running'
    ? { text: CLOCK, since: a.startedAt }
    : { text: `${CLOCK}${formatDuration(workedMs(a, now))}` }),
  dim: true,
  width: TIME_WIDTH,
  ...(align === undefined ? {} : { align }),
})

// The agents pane: the table of the session's agents, or one agent's transcript. The engine
// owns the scroll, so the whole table is drawn; every row is cut to `columns`.
//
// A row is buttons and cells. Every cell is drawn one way per surface: a Text on the terminal,
// a `Client` on a desktop, where a Text does not sit on one line with a button beside it.
export const AgentPane = ({
  ui,
  entries,
  view,
  stats,
  dashboard,
  spin,
  now,
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
  const isClient = spin === null && 'Client' in ui
  const cell = (key: string, c: Cell) =>
    isClient ? (
      <ui.Client
        key={key}
        module="./cellClient.tsx"
        props={c}
        width={c.width ?? cellText(c, 0, now).length}
        height={1}
      />
    ) : (
      <Box key={key} flexShrink={0} {...(c.width === undefined ? {} : { width: c.width })}>
        <Text
          wrap="truncate"
          {...(c.color === undefined ? {} : { color: c.color })}
          {...(c.dim === true ? { dimColor: true } : {})}
          {...(c.bold === true ? { bold: true } : {})}
        >
          {cellText(c, spin ?? 0, now)}
        </Text>
      </Box>
    )

  if (viewed === null) {
    const head = (key: string, text: string, width: number, align?: 'right') =>
      cell(key, { text, dim: true, width, ...(align === undefined ? {} : { align }) })
    const rule = (key: string) => (
      <Text key={key} dimColor wrap="truncate">
        {'─'.repeat(Math.max(0, columns))}
      </Text>
    )
    // The dashboard: the session's cost, then per model an estimated cost (≈), the working
    // time and the runs of its agents.
    const board = () => {
      if (dashboard === null) return null
      const MODEL = Math.min(MAX_MODEL, Math.max(5, ...dashboard.rows.map((r) => r.model.length)))
      return (
        <Box key="dashboard" flexDirection="column">
          {cell('cost', { text: `total $${formatUsd(dashboard.costUsd)}`, bold: true })}
          {dashboard.rows.length > 0 && (
            <Box key="dash:head" flexDirection="row" gap={1}>
              {head('dash:head:model', 'model', MODEL)}
              {head('dash:head:cost', 'cost', USD_WIDTH, 'right')}
              {head('dash:head:time', 'time', TIME_WIDTH, 'right')}
              {head('dash:head:runs', 'runs', RUNS_WIDTH, 'right')}
            </Box>
          )}
          {dashboard.rows.map((r) => (
            <Box key={`dash:${r.model}`} flexDirection="row" gap={1}>
              {cell(`dash:model:${r.model}`, { text: cut(r.model, MODEL), width: MODEL })}
              {cell(`dash:cost:${r.model}`, {
                text: r.costUsd === null ? '—' : `≈$${formatUsd(r.costUsd)}`,
                width: USD_WIDTH,
                align: 'right',
              })}
              {cell(`dash:time:${r.model}`, {
                text: `${CLOCK}${formatDuration(r.workMs)}`,
                dim: true,
                width: TIME_WIDTH,
                align: 'right',
              })}
              {cell(`dash:runs:${r.model}`, {
                text: String(r.runs),
                dim: true,
                width: RUNS_WIDTH,
                align: 'right',
              })}
            </Box>
          ))}
          {rule('dash:rule')}
        </Box>
      )
    }

    const rows = treeRows(entries)
    if (rows.length === 0)
      return (
        <Box flexDirection="column">
          {board()}
          <Text dimColor>No agents yet.</Text>
        </Box>
      )
    const t = agentTable(
      rows.map((r) => r.agent),
      columns,
    )
    return (
      <Box flexDirection="column">
        {board()}
        <Box key="head" flexDirection="row" gap={1}>
          {head('head:name', 'agent', MARK_WIDTH + t.name)}
          {head('head:runs', 'runs', t.runs, 'right')}
          {head('head:time', 'time', t.time, 'right')}
        </Box>
        {rows.map(({ agent, depth }) => (
          // A Button takes no color: the status is the colored mark before it, and an ended
          // agent's row is dim at rest.
          <Box key={`row:${agent.id}`} flexDirection="row" alignItems="center" gap={1}>
            {depth > 0 && <Box key={`indent:${agent.id}`} width={depth * 2 - 1} flexShrink={0} />}
            {cell(`mark:${agent.id}`, agentMark(agent))}
            <Box key={`name:${agent.id}`} width={t.name - depth * 2} flexShrink={0}>
              <Button
                key={`agent:${agent.id}`}
                plain
                {...(agent.status === 'running' ? {} : { dimColor: true })}
                label={cut(name(agent), t.name - depth * 2)}
                onPress={() => onOpen(agent.id)}
              />
            </Box>
            {cell(`runs:${agent.id}`, {
              text: String(agent.runs),
              dim: true,
              width: t.runs,
              align: 'right',
            })}
            {cell(`time:${agent.id}`, timeCell(agent, now, 'right'))}
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
    const room = columns - MARK_WIDTH - 1 - (child === undefined ? 0 : OPEN_CHILD.length)
    return (
      <Box key={String(i)} flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          {cell(
            `mark:${it.id}`,
            state === 'running'
              ? { text: '', spin: true, color: TOOL_TONE.running, width: MARK_WIDTH }
              : { text: TOOL_MARK[state], color: TOOL_TONE[state], width: MARK_WIDTH },
          )}
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
  const titleWidth = columns - MARK_WIDTH - 1
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
      <Box key="title" flexDirection="row" alignItems="center" gap={1}>
        {agent !== undefined && cell('mark', agentMark(agent))}
        {cell('title', {
          text: cut(agent === undefined ? viewed : name(agent), titleWidth),
          bold: true,
          color: agent?.status === 'running' ? TONE.running : PALETTE.fg,
          width: titleWidth,
        })}
      </Box>
      {/* Below the title: the model, the runs and the working time, under the title's text. */}
      {agent !== undefined && (
        <Box
          key="meta"
          flexDirection="row"
          alignItems="center"
          gap={1}
          paddingLeft={MARK_WIDTH + 1}
        >
          {agent.model !== undefined &&
            cell('meta:model', { text: modelLabel(agent) ?? '', dim: true })}
          {cell('meta:runs', { text: runsLabel(agent.runs), dim: true })}
          {cell('meta:time', timeCell(agent, now))}
        </Box>
      )}
      {stats !== null && (
        <Text key="stats" wrap="truncate">
          {statSegments(stats).map((s, i) => (
            <Text key={String(i)} color={s.color}>
              {s.text}
            </Text>
          ))}
        </Text>
      )}
      {/* Parts the header (toolbar and title) from the transcript below it. */}
      <Text key="rule" dimColor wrap="truncate">
        {'─'.repeat(Math.max(0, columns))}
      </Text>
      {body()}
    </Box>
  )
}
