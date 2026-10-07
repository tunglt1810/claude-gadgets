import type { Elements } from 'claude-code'
import type {
  AgentEntry,
  Cell,
  ContextView,
  Dashboard,
  PaneView,
  Registry,
  Snapshot,
  TranscriptItem,
} from '../types'
import { cellText } from './cell'
import { clipLines, cut } from './clip'
import { barSegments, contextHead, contextSummary, overheadHead } from './context'
import { controlLabels } from './control'
import { rowKey, runsText, SIDE, shareColor, sharePct } from './dashboard'
import { detailCells } from './detail'
import { formatDuration, formatTokens, formatUsd } from './format'
import { statSegments } from './layout'
import { PALETTE } from './palette'
import { agentTitle, modelLabel, workedMs } from './registry'
import { inputCode, toolSummary } from './summary'
import { agentTable, recency, runsLabel } from './table'
import { lastItems } from './transcript'
import { treeRows } from './tree'
import { contextColor, contextFit, contextText, ctxKey } from './window'

type Props = {
  ui: Elements[keyof Elements]
  entries: Registry
  view: PaneView
  // The numbers of the agent on the transcript screen, with the agents below it.
  stats: Snapshot | null
  // The session's cost and a row per model, above the agents table.
  dashboard: Dashboard | null
  // The context of the main loop, below the dashboard; null with no sample.
  context: ContextView | null
  // The dashboard's costs and the tokens of each context as they are on screen, by name, where
  // the pane is drawn on each frame (the terminal). Absent on a desktop: a cell runs to its
  // new number by itself.
  shownUsd?: Record<string, number>
  // The spinner's tick count: a running mark turns with it. Null where the pane must not be
  // drawn again on each frame (a desktop): each cell is a `Client` with its own timer then.
  spin: number | null
  // The time the working times are read at.
  now: number
  columns: number
  // The rows of this tree that the pane's window has scrolled past: 0 at the top.
  scrollTop: number
  // While a scroll is on its way: the row that the window still shows. `scrollTop` is then
  // the row it goes to.
  scrollFrom?: number
  onOpen: (agentId: string) => void
  onExpand: (agentId: string) => void
  onBack: () => void
  onWrap: () => void
  onTool: (toolUseId: string) => void
  onContext: () => void
  onRecount: () => void
  onCategory: (name: string) => void
  // The text of each message field as the person typed it, by agent.
  drafts: Record<string, string>
  onCompose: (agentId: string) => void
  onStop: (agentId: string) => void
  onDraft: (agentId: string, text: string) => void
  onSend: (agentId: string, text: string) => void
}

// The most lines of a tool call's input, and of its result, that the pane draws.
const MAX_LINES = 40
// The mark of an ended agent; a running one turns. Every agent mark is an eight-dot braille
// glyph, as the spinner's frames are: one font draws them all at one size.
const END_MARK = { idle: '⣿', stopped: '⣿' } as const
// The width of every mark: a glyph a desktop draws wider than one cell is not cut.
const MARK_WIDTH = 2
// The width of the expand button of an agent's row, as a mark's.
const EXPAND_WIDTH = 2
// The color of an agent's mark by its status.
const TONE = { running: PALETTE.green, idle: PALETTE.dim, stopped: PALETTE.red } as const
const OPEN_CHILD = ' [open]'
const BACK = '← agents'
// The terminal draws a button as `[ label ]`.
const BUTTON_CHROME = 4
// The least room that the bar of a scrolled transcript keeps for the agent's name.
const MIN_STICKY_NAME = 8
// The columns that the toolbar of a transcript keeps for its back and wrap buttons.
const TOOLBAR_USED = 27
// A tool call by its outcome: its mark and the color of the mark. A finished call is dim at
// rest, so the failed and the running ones stand out.
const TOOL_MARK = { done: '✓', failed: '✗' } as const
const TOOL_TONE = { done: PALETTE.green, failed: PALETTE.red, running: PALETTE.yellow } as const
// The icon of a working time, as the band's work clock. A table's time column has no icon.
const CLOCK = '◷ '
const TIME_WIDTH = 9
// Parts the model, the runs and the time below an agent's title.
const SEP = '·'
// The dashboard's columns: a cost fits `≈1234.56`, a share its header `cost(%)`. The model
// takes the rest of the pane, five cells at least.
const MIN_MODEL = 5
const USD_WIDTH = 9
const PCT_WIDTH = 7
// The color of an agent's runs and time by how recent its activity is.
const RECENCY_TONE = { active: PALETTE.green, recent: PALETTE.yellow } as const
const RUNS_WIDTH = 7
// The characters of a terminal's rule: more than the columns of a pane.
const RULE_LENGTH = 600
// The characters of the rule between two turns of a transcript: shorter than a table's rule,
// so it does not read as the end of the header.
const TURN_RULE_LENGTH = 12
// The button of the context screen, and the button that reads its breakdown again.
const CONTEXT = 'context'
const RECOUNT = 'recount'
// The columns of the context screen: a count of tokens fits `123.4k`, a share its header
// `share(%)`, a carry cost its header `carry($)`, a count of tools its header.
const TOKENS_WIDTH = 7
const SHARE_WIDTH = 8
const CARRY_WIDTH = 8
const TOOLS_WIDTH = 7

// The tone of a cell: dim, or a color.
type Tone = Pick<Cell, 'dim' | 'color'>

const name = agentTitle

const agentMark = (a: AgentEntry): Cell =>
  a.status === 'running'
    ? { text: '', spin: true, color: TONE.running, width: MARK_WIDTH }
    : { text: END_MARK[a.status], color: TONE[a.status], width: MARK_WIDTH }

// How long an agent worked: a running agent's time counts up from its start. The cell keeps
// room for `h:mm:ss`, so a running time never outgrows it.
const timeCell = (
  a: AgentEntry,
  now: number,
  align?: 'right',
  tone: Tone = { dim: true },
  icon = CLOCK,
): Cell => ({
  ...(a.status === 'running'
    ? { text: icon, since: a.startedAt }
    : { text: `${icon}${formatDuration(workedMs(a, now))}` }),
  ...tone,
  width: TIME_WIDTH,
  ...(align === undefined ? {} : { align }),
})

// The agents pane: the table of the session's agents, or one agent's transcript. The engine
// owns the scroll, so the whole table is drawn; every row is cut to `columns`.
//
// A row is buttons and cells. Every cell is drawn one way per surface: a Text on the terminal,
// a `Client` on a desktop, where a Text does not sit on one line with a button beside it.
//
// The terminal draws a dragged pane at its new width before the hook answers: it lays the last
// tree out again. So no box of the terminal's tree takes its width from `columns`. The part
// that takes the rest of a row grows and shrinks, and the layout cuts its text. A desktop's
// font is not fixed-width, so a part there has a width in cells.
export const AgentPane = ({
  ui,
  entries,
  view,
  stats,
  dashboard,
  context,
  shownUsd,
  spin,
  now,
  columns,
  scrollTop,
  scrollFrom,
  onOpen,
  onExpand,
  onBack,
  onWrap,
  onTool,
  onContext,
  onRecount,
  onCategory,
  drafts,
  onCompose,
  onStop,
  onDraft,
  onSend,
}: Props) => {
  const { Box, Text, Button, Code, Markdown } = ui
  const viewed = view.agentId
  // State of an older shape (a hot reload) has no flag: the rows are cut then.
  const isWrapped = view.isWrapped === true
  const codeWrap = isWrapped ? 'wrap' : 'truncate-end'
  const isClient = spin === null && 'Client' in ui
  const cell = (key: string, c: Cell, isRest = false) =>
    isClient ? (
      <ui.Client
        key={key}
        module="./cellClient.tsx"
        props={c}
        width={c.width ?? cellText(c, 0, now).length}
        height={1}
      />
    ) : (
      <Box
        key={key}
        {...(isRest
          ? { flexGrow: 1, flexShrink: 1 }
          : { flexShrink: 0, ...(c.width === undefined ? {} : { width: c.width }) })}
      >
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

  // The cell that takes the rest of its row: `width` cells on a desktop, with its text cut to
  // them. The terminal's layout gives the cell its width and cuts the text.
  const rest = (key: string, text: string, width: number, tone: Omit<Cell, 'text'> = {}) =>
    cell(
      key,
      isClient
        ? { ...tone, text: cut(text, width), width }
        : { ...tone, text: cut(text, Infinity) },
      true,
    )
  // A button of the terminal in a box that the layout can make narrower than the label. The
  // layout wraps a label to the width that it has. So the inner box is as wide as the label,
  // which keeps the label on one row, and the outer box cuts it.
  const oneRow = (key: string, label: string, button: ReturnType<typeof cell>, isRest = false) => (
    <Box key={key} flexGrow={isRest ? 1 : 0} flexShrink={1} overflow="hidden">
      <Box width={label.length} flexShrink={0}>
        {button}
      </Box>
    </Box>
  )
  // The box that takes the rest of its row, around a button with `label`: `width` cells on a
  // desktop.
  const restBox = (key: string, width: number, label: string, button: ReturnType<typeof cell>) =>
    isClient ? (
      <Box key={key} width={width} flexShrink={0}>
        {button}
      </Box>
    ) : (
      oneRow(key, label, button, true)
    )
  // A line across the terminal's pane: it is longer than a pane, and its box shows one row of it.
  const line = (key: string) => (
    <Box key={key} height={1} overflow="hidden">
      <Text dimColor>{'─'.repeat(RULE_LENGTH)}</Text>
    </Box>
  )

  // The reason of a message or a stop that the engine refused, below the controls of the agent.
  const controlError = (key: string, id: string) =>
    view.controlError?.agentId === id ? (
      <Text key={key} color={PALETTE.red} wrap="truncate">
        {view.controlError.reason}
      </Text>
    ) : null
  // The message field of an agent. It has no placeholder: text that an input method composes
  // (Vietnamese on macOS) is not in the field yet, so the engine draws the placeholder below it.
  // Enter sends the text. Only the terminal and a desktop draw a field.
  // The field takes its whole row: `width` cells on a desktop, where no box grows.
  const say = (id: string, width: number, isFocused: boolean) =>
    'Input' in ui ? (
      <Box
        key={`saybox:${id}`}
        flexDirection="column"
        {...(isClient ? { width, flexShrink: 0 } : { flexGrow: 1, flexShrink: 1 })}
      >
        <ui.Input
          key={`say:${id}`}
          label="›"
          value={drafts[id] ?? ''}
          submitLabel="send"
          {...(isFocused ? { autoFocus: true as const } : {})}
          onInput={(text) => onDraft(id, text)}
          onSubmit={(text) => onSend(id, text)}
        />
      </Box>
    ) : null

  // A context cell with the tokens that are on screen, where the pane draws each frame.
  const shownCtx = (agentId: string, c: Cell): Cell => {
    const tokens = shownUsd?.[ctxKey(agentId)]
    return c.ctx === undefined || tokens === undefined ? c : { ...c, ctx: { ...c.ctx, tokens } }
  }

  if (viewed === null) {
    const head = (key: string, text: string, width: number, align?: 'right') =>
      cell(key, { text, dim: true, width, ...(align === undefined ? {} : { align }) })
    // A desktop's font is not fixed-width: a count of `─` does not give a width there. The
    // line is longer than the pane, and the layout cuts it at the pane's width.
    const rule = (key: string) =>
      isClient ? (
        <Box key={key} width={columns} height={1} overflow="hidden">
          <Text dimColor>{'─'.repeat(Math.max(0, columns) * 3)}</Text>
        </Box>
      ) : (
        line(key)
      )
    // The dashboard: the session's cost, then per model an estimated cost (≈), its share of
    // the total (colored by its size), the working time and the runs of its agents.
    const board = () => {
      if (dashboard === null) return null
      // As wide as the pane, with the runs and the time last, as in the agents table: the two
      // tables end at one edge, and their runs and times line up.
      const MODEL = Math.max(
        MIN_MODEL,
        columns - (USD_WIDTH + 1) - (PCT_WIDTH + 1) - (RUNS_WIDTH + 1) - (TIME_WIDTH + 1),
      )
      return (
        <Box key="dashboard" flexDirection="column">
          {cell('cost', {
            text: 'total ≈$',
            usd: shownUsd?.total ?? dashboard.costUsd,
            bold: true,
          })}
          {dashboard.rows.length > 0 && (
            <Box key="dash:head" flexDirection="row" gap={1}>
              {rest('dash:head:model', 'model', MODEL, { dim: true })}
              {head('dash:head:cost', 'cost($)', USD_WIDTH, 'right')}
              {head('dash:head:pct', 'cost(%)', PCT_WIDTH, 'right')}
              {head('dash:head:runs', 'runs', RUNS_WIDTH, 'right')}
              {head('dash:head:time', 'time', TIME_WIDTH, 'right')}
            </Box>
          )}
          {dashboard.rows.map((r) => {
            const pct = sharePct(r.costUsd, dashboard.costUsd)
            return (
              <Box key={`dash:${r.model}`} flexDirection="row" gap={1}>
                {rest(`dash:model:${r.model}`, r.model, MODEL)}
                {cell(`dash:cost:${r.model}`, {
                  ...(r.costUsd === null
                    ? { text: '—' }
                    : { text: '≈', usd: shownUsd?.[rowKey(r.model)] ?? r.costUsd }),
                  width: USD_WIDTH,
                  align: 'right',
                })}
                {cell(`dash:pct:${r.model}`, {
                  text: pct === null ? '' : `${pct}%`,
                  ...(pct === null ? {} : { color: shareColor(pct) }),
                  width: PCT_WIDTH,
                  align: 'right',
                })}
                {cell(`dash:runs:${r.model}`, {
                  text: r.model === SIDE ? '' : runsText(r),
                  dim: true,
                  width: RUNS_WIDTH,
                  align: 'right',
                })}
                {cell(`dash:time:${r.model}`, {
                  text: r.model === SIDE ? '' : formatDuration(r.workMs),
                  dim: true,
                  width: TIME_WIDTH,
                  align: 'right',
                })}
              </Box>
            )
          })}
          {rule('dash:rule')}
        </Box>
      )
    }

    // The bar of a context: one text, in a box of one row that cuts it. Its length is a
    // fixed count of cells, so no box here takes a width from `columns`.
    const bar = (key: string, c: ContextView) => (
      <Box key={key} height={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate">
          {barSegments(c).map((s, i) => (
            <Text key={String(i)} color={s.color}>
              {s.text}
            </Text>
          ))}
        </Text>
      </Box>
    )
    // A row of cells with one cell between them.
    const cells = (key: string, row: Cell[]) => (
      <Box key={key} flexDirection="row" alignItems="center" gap={1} overflow="hidden">
        {row.map((c, i) => cell(`${key}:${i}`, c))}
      </Box>
    )
    // The context of the main loop: its length, the bar of the window and the totals. A
    // Button takes no color, so the context length is a cell after the button.
    const contextBlock = () =>
      context === null ? null : (
        <Box key="ctxblock" flexDirection="column">
          <Box key="ctx:row" flexDirection="row" alignItems="center" gap={1} overflow="hidden">
            <Button key="context" label={CONTEXT} onPress={onContext} />
            {contextHead(context, columns - CONTEXT.length - BUTTON_CHROME - 1).map((c, i) =>
              cell(`ctx:head:${i}`, c),
            )}
          </Box>
          {bar('ctx:bar', context)}
          {cells('ctx:sum', contextSummary(context))}
          {rule('ctx:rule')}
        </Box>
      )

    // The first cell of a row that is not pressed. On a desktop it is a button that does
    // nothing: a desktop draws a button's label after a margin of its own, so only a button
    // starts where the category buttons start.
    const quiet = (key: string, text: string, width: number) =>
      restBox(
        `${key}:box`,
        width,
        text,
        isClient ? (
          <Button key={key} plain dimColor label={text} onPress={() => {}} />
        ) : (
          rest(key, text, width, { dim: true })
        ),
      )
    const num = (key: string, text: string, width: number, tone: Tone = {}) =>
      cell(key, { text, ...tone, width, align: 'right' })

    // The context screen: the overhead by category, what it costs to carry, and the MCP
    // servers that the session did not call.
    const contextScreen = () => {
      const nameWidth = Math.max(
        MIN_MODEL,
        columns - (TOKENS_WIDTH + 1) - (SHARE_WIDTH + 1) - (CARRY_WIDTH + 1),
      )
      const serverWidth = Math.max(MIN_MODEL, columns - (TOOLS_WIDTH + 1) - (TOKENS_WIDTH + 1))
      const titleWidth = Math.max(
        1,
        columns -
          (BACK.length + BUTTON_CHROME + 1) -
          ('summary'.length + 1) -
          (RECOUNT.length + BUTTON_CHROME + 1),
      )
      // State of an older shape (a hot reload) has no list.
      const open = view.openCategories ?? []
      return (
        <Box flexDirection="column">
          <Box key="ctx:toolbar" flexDirection="row" alignItems="center" gap={1}>
            <Button key="back" label={BACK} onPress={onBack} />
            {rest('ctx:title', CONTEXT, titleWidth, { bold: true })}
            {context !== null && cell('ctx:detail', { text: context.detail, dim: true })}
            <Button key="recount" label={RECOUNT} onPress={onRecount} />
          </Box>
          {context === null ? (
            <Text key="ctx:none" dimColor>
              No context yet.
            </Text>
          ) : (
            <Box key="ctx:body" flexDirection="column">
              {cells('ctx:head', contextHead(context, columns))}
              {bar('ctx:bar', context)}
              {rule('ctx:rule')}
              {cells('ovh:head', overheadHead(context))}
              <Box key="ovh:cols" flexDirection="row" alignItems="center" gap={1}>
                {quiet('head:cat', '  category', nameWidth)}
                {head('head:tokens', 'tokens', TOKENS_WIDTH, 'right')}
                {head('head:share', 'share(%)', SHARE_WIDTH, 'right')}
                {head('head:carry', 'carry($)', CARRY_WIDTH, 'right')}
              </Box>
              {context.categories.map((r) => {
                const isOpen = open.includes(r.name)
                // A category with no items has no mark, and its press does nothing.
                const mark = r.items.length === 0 ? ' ' : isOpen ? '▾' : '▸'
                const label = cut(`${mark} ${r.name}`, nameWidth)
                const pct =
                  context.overhead > 0 ? Math.round((r.tokens / context.overhead) * 100) : 0
                return (
                  <Box key={`catrow:${r.name}`} flexDirection="column">
                    <Box flexDirection="row" alignItems="center" gap={1}>
                      {restBox(
                        `catbox:${r.name}`,
                        nameWidth,
                        label,
                        <Button
                          key={`cat:${r.name}`}
                          plain
                          label={label}
                          onPress={r.items.length === 0 ? () => {} : () => onCategory(r.name)}
                        />,
                      )}
                      {num(`catnum:tokens:${r.name}`, formatTokens(r.tokens), TOKENS_WIDTH)}
                      {num(`catnum:share:${r.name}`, `${pct}%`, SHARE_WIDTH, {
                        color: shareColor(pct),
                      })}
                      {num(
                        `catnum:carry:${r.name}`,
                        r.carryUsd === null ? '—' : `≈${formatUsd(r.carryUsd)}`,
                        CARRY_WIDTH,
                      )}
                    </Box>
                    {isOpen &&
                      r.items.map((it, i) => (
                        <Box
                          key={`itemrow:${r.name}:${String(i)}`}
                          flexDirection="row"
                          alignItems="center"
                          gap={1}
                        >
                          {quiet(
                            `item:${r.name}:${String(i)}`,
                            cut(
                              `    ${it.name}${it.count === undefined ? '' : ` · ${it.count} tools`}`,
                              nameWidth,
                            ),
                            nameWidth,
                          )}
                          {num(
                            `itemnum:${r.name}:${String(i)}`,
                            formatTokens(it.tokens),
                            TOKENS_WIDTH,
                            { dim: true },
                          )}
                        </Box>
                      ))}
                  </Box>
                )
              })}
              {context.unused.length > 0 && (
                <Box key="dead" flexDirection="column">
                  {rule('dead:rule')}
                  {cell('dead:head', {
                    text: `dead weight ${formatTokens(context.deadWeight)}`,
                    bold: true,
                  })}
                  <Box key="dead:cols" flexDirection="row" gap={1}>
                    {rest('dead:head:server', 'server', serverWidth, { dim: true })}
                    {head('dead:head:tools', 'tools', TOOLS_WIDTH, 'right')}
                    {head('dead:head:tokens', 'tokens', TOKENS_WIDTH, 'right')}
                  </Box>
                  {context.unused.map((s) => (
                    <Box key={`dead:${s.name}`} flexDirection="row" gap={1}>
                      {rest(`dead:name:${s.name}`, s.name, serverWidth)}
                      {num(`dead:tools:${s.name}`, String(s.count ?? 0), TOOLS_WIDTH, {
                        dim: true,
                      })}
                      {num(`dead:tokens:${s.name}`, formatTokens(s.tokens), TOKENS_WIDTH)}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }
    // State of an older shape (a hot reload) has no flag.
    if (view.isContext === true) return contextScreen()

    const labels = (id: string, room: number) => controlLabels(room, view.stopAsk === id)
    // A plain button of a control row, on one row of the terminal.
    const control = (key: string, label: string, onPress: () => void) => {
      const button = <Button key={key} plain label={label} onPress={onPress} />
      return isClient ? button : oneRow(`${key}:box`, label, button)
    }
    const rows = treeRows(entries)
    if (rows.length === 0)
      return (
        <Box flexDirection="column">
          {board()}
          {contextBlock()}
          <Text dimColor>No agents yet.</Text>
        </Box>
      )
    const t = agentTable(
      rows.map((r) => r.agent),
      columns,
    )
    // The name column without the expand button and its gap, as a root agent's name is.
    const headName = Math.max(1, t.name - EXPAND_WIDTH - 1)
    return (
      <Box flexDirection="column">
        {board()}
        {contextBlock()}
        <Box key="head" flexDirection="row" gap={1}>
          {/* Built as a row is, a mark and a box of the name's width: a desktop sizes a box
              and a cell in different units, so only the same parts line up. */}
          {head('head:mark', '', MARK_WIDTH)}
          <Box key="head:expand" width={EXPAND_WIDTH} flexShrink={0} />
          {/* A desktop draws a button's label after a margin of its own: the header is a
              button there too (it does nothing), so it starts where the names start. */}
          {restBox(
            'head:namebox',
            headName,
            'agents',
            isClient ? (
              <Button key="head:name" plain dimColor label="agents" onPress={() => {}} />
            ) : (
              rest('head:name', 'agents', headName, { dim: true })
            ),
          )}
          {head('head:runs', 'runs', t.runs, 'right')}
          {head('head:time', 'time', t.time, 'right')}
        </Box>
        {rows.map(({ agent, depth }) => {
          const recent = recency(agent, now)
          const tone: Tone = recent === 'old' ? { dim: true } : { color: RECENCY_TONE[recent] }
          // A detail row is open until its button closes it. State of an older shape (a hot
          // reload) has no list: each row is open then.
          const isOpen = !(view.collapsedAgents ?? []).includes(agent.id)
          // The name gives its first cells to the expand button and a gap.
          const nameWidth = Math.max(1, t.name - depth * 2 - EXPAND_WIDTH - 1)
          // The detail row starts below the name's first character: the cells before it.
          const inset = depth * 2 + MARK_WIDTH + 1 + EXPAND_WIDTH + 1
          const detail = isOpen ? detailCells(agent, columns - inset) : []
          const label = cut(name(agent), nameWidth)
          const ctx = detail.find((c) => c.ctx !== undefined)
          // The cells before the context as one text; its last dot parts it from the context.
          const lead = detail
            .filter((c) => c.ctx === undefined)
            .map((c) => c.text)
            .join(' ')
          return (
            <Box key={`agentrow:${agent.id}`} flexDirection="column">
              {/* A Button takes no color: the status is the colored mark before it, and an
                  ended agent's row is dim at rest. The runs and the time take the color of
                  the recency. */}
              <Box key={`row:${agent.id}`} flexDirection="row" alignItems="center" gap={1}>
                {depth > 0 && (
                  <Box key={`indent:${agent.id}`} width={depth * 2 - 1} flexShrink={0} />
                )}
                {cell(`mark:${agent.id}`, agentMark(agent))}
                <Box key={`expandbox:${agent.id}`} width={EXPAND_WIDTH} flexShrink={0}>
                  <Button
                    key={`expand:${agent.id}`}
                    plain
                    dimColor
                    label={isOpen ? '▾' : '▸'}
                    onPress={() => onExpand(agent.id)}
                  />
                </Box>
                {restBox(
                  `name:${agent.id}`,
                  nameWidth,
                  label,
                  <Button
                    key={`agent:${agent.id}`}
                    plain
                    {...(agent.status === 'running' ? {} : { dimColor: true })}
                    label={label}
                    onPress={() => onOpen(agent.id)}
                  />,
                )}
                {cell(`runs:${agent.id}`, {
                  text: String(agent.runs),
                  ...tone,
                  width: t.runs,
                  align: 'right',
                })}
                {cell(`time:${agent.id}`, timeCell(agent, now, 'right', tone, ''))}
              </Box>
              {isOpen && (
                // Built as the agent's row is, an indent, a mark and an expand box: a desktop
                // sizes a box and a padding in different units, so only the same parts line up.
                <Box key={`detailrow:${agent.id}`} flexDirection="row" alignItems="center" gap={1}>
                  {depth > 0 && (
                    <Box key={`detail:indent:${agent.id}`} width={depth * 2 - 1} flexShrink={0} />
                  )}
                  {cell(`detail:mark:${agent.id}`, { text: '', width: MARK_WIDTH })}
                  <Box key={`detail:expand:${agent.id}`} width={EXPAND_WIDTH} flexShrink={0} />
                  {/* The model and the effort are one button, as the name above them is: a
                      desktop draws a button's label after a margin of its own, and its font is
                      not fixed-width, so separate cells start at another place and stand
                      apart. It has no box of a fixed width: the context comes right after it. */}
                  {lead !== '' && (
                    <Button
                      key={`detail:${agent.id}`}
                      plain
                      dimColor
                      label={lead}
                      onPress={() => onOpen(agent.id)}
                    />
                  )}
                  {/* A Button takes no color: the context stays a cell. */}
                  {ctx !== undefined && cell(`detail:ctx:${agent.id}`, shownCtx(agent.id, ctx))}
                </Box>
              )}
              {isOpen && (
                // The controls of the agent, built as the detail row is: a message to it, and
                // a stop while it runs.
                <Box key={`controlrow:${agent.id}`} flexDirection="row" alignItems="center" gap={1}>
                  {depth > 0 && (
                    <Box key={`control:indent:${agent.id}`} width={depth * 2 - 1} flexShrink={0} />
                  )}
                  {cell(`control:mark:${agent.id}`, { text: '', width: MARK_WIDTH })}
                  <Box key={`control:expand:${agent.id}`} width={EXPAND_WIDTH} flexShrink={0} />
                  {control(`msg:${agent.id}`, labels(agent.id, columns - inset).message, () =>
                    onCompose(agent.id),
                  )}
                  {agent.status === 'running' &&
                    control(`stop:${agent.id}`, labels(agent.id, columns - inset).stop, () =>
                      onStop(agent.id),
                    )}
                </Box>
              )}
              {isOpen && view.compose === agent.id && (
                <Box key={`sayrow:${agent.id}`} flexDirection="row" paddingLeft={inset}>
                  {say(agent.id, Math.max(1, columns - inset), true)}
                </Box>
              )}
              {isOpen && (
                <Box key={`errrow:${agent.id}`} paddingLeft={inset}>
                  {controlError(`err:${agent.id}`, agent.id)}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  const item = (it: TranscriptItem, i: number) => {
    if (it.kind === 'prompt') {
      const prompt = (
        <Text key={String(i)} color={PALETTE.cyan} wrap={isWrapped ? 'wrap' : 'truncate'}>
          {isWrapped ? `> ${it.text}` : cut(`> ${it.text}`, isClient ? columns : Infinity)}
        </Text>
      )
      // A short rule parts a new prompt from the turn before it.
      return i === 0 ? (
        prompt
      ) : (
        <Box key={String(i)} flexDirection="column">
          <Box key={`turn:${i}`} height={1} overflow="hidden">
            <Text dimColor>{'─'.repeat(TURN_RULE_LENGTH)}</Text>
          </Box>
          {prompt}
        </Box>
      )
    }
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
    const label = cut(`${isOpen ? '▾' : '▸'} ${toolSummary(it.tool, it.input)}`, room)
    const tool = (
      <Button
        key={`tool:${it.id}`}
        plain
        {...(state === 'done' ? { dimColor: true } : {})}
        label={label}
        onPress={() => onTool(it.id)}
      />
    )
    return (
      <Box key={String(i)} flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          {cell(
            `mark:${it.id}`,
            state === 'running'
              ? { text: '', spin: true, color: TOOL_TONE.running, width: MARK_WIDTH }
              : { text: TOOL_MARK[state], color: TOOL_TONE[state], width: MARK_WIDTH },
          )}
          {isClient ? tool : oneRow(`toolbox:${it.id}`, label, tool)}
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

  // The characters that an item draws: its text, or the summary of a tool call with the input
  // and the result of an open one.
  const drawnChars = (it: TranscriptItem): number => {
    if (it.kind !== 'tool') return it.text.length
    const open = view.expanded.includes(it.id)
      ? inputCode(it.tool, it.input, MAX_LINES).source.length +
        clipLines(it.result ?? '', MAX_LINES).length
      : 0
    return toolSummary(it.tool, it.input).length + open
  }

  // A transcript read for another agent is never drawn.
  const shown = view.transcript?.agentId === viewed ? view.transcript : null
  const body = () => {
    if (shown === null) return <Text dimColor>Loading...</Text>
    if ('deny' in shown) return <Text color={PALETTE.red}>{shown.deny}</Text>
    if (shown.items.length === 0) return <Text dimColor>No messages yet.</Text>
    const { items, hidden } = lastItems(shown.items, drawnChars)
    return (
      <Box flexDirection="column">
        {hidden > 0 && <Text dimColor>{`... ${hidden} older items hidden`}</Text>}
        {items.map(item)}
      </Box>
    )
  }

  const agent = entries[viewed]
  const titleWidth = columns - MARK_WIDTH - 1
  // The context takes what the row below the title has left: its padding, then each cell
  // before the context with the gap after it, then the dot and its gap.
  const metaLabel = modelLabel(agent)
  const metaUsed =
    MARK_WIDTH +
    1 +
    (metaLabel === undefined ? 0 : metaLabel.length + 1 + SEP.length + 1) +
    (agent === undefined ? 0 : runsLabel(agent.runs).length + 1) +
    (SEP.length + 1) +
    (TIME_WIDTH + 1) +
    (SEP.length + 1)
  const ctxText =
    agent?.context === undefined ? null : contextFit(agent.context, columns - metaUsed)
  // The engine scrolls the pane as one tree, so the header goes out of view. A bar out of the
  // flow, at the first row that the window shows, keeps the back button, the agent and its
  // context in view. Its second row has the controls of the agent. It has a background: it
  // lies over two rows of the transcript.
  // The controls of the agent, with words where `room` has cells for them.
  const controls = (prefix: string, room: number) => {
    const ctl = controlLabels(room, view.stopAsk === viewed)
    return [
      <Button
        key={`${prefix}msg:${viewed}`}
        label={ctl.message}
        onPress={() => onCompose(viewed)}
      />,
      agent?.status === 'running' && (
        <Button key={`${prefix}stop:${viewed}`} label={ctl.stop} onPress={() => onStop(viewed)} />
      ),
    ]
  }
  const stickyRoom = columns - (BACK.length + BUTTON_CHROME + 1) - (MARK_WIDTH + 1)
  const stickyCtx =
    agent?.context === undefined
      ? null
      : contextFit(agent.context, stickyRoom - MIN_STICKY_NAME - 1)
  const stickyName = Math.max(1, stickyRoom - (stickyCtx === null ? 0 : stickyCtx.length + 1))
  const sticky = (key: string, top: number) => (
    <Box
      key={key}
      position="absolute"
      top={top}
      left={0}
      width={isClient ? columns : '100%'}
      flexDirection="column"
      backgroundColor={PALETTE.strip}
    >
      <Box key={`${key}:head`} flexDirection="row" alignItems="center" gap={1}>
        <Button key={`${key}:back`} label={BACK} onPress={onBack} />
        {agent !== undefined && cell(`${key}:mark`, agentMark(agent))}
        {rest(`${key}:title`, agent === undefined ? viewed : name(agent), stickyName, {
          bold: true,
          color: agent?.status === 'running' ? TONE.running : PALETTE.fg,
        })}
        {stickyCtx !== null &&
          agent?.context !== undefined &&
          cell(
            `${key}:ctx`,
            shownCtx(agent.id, {
              text: '',
              ctx: { ...agent.context, isFull: stickyCtx === contextText(agent.context, true) },
              color: contextColor(agent.context),
            }),
          )}
      </Box>
      <Box key={`${key}:controls`} flexDirection="row" gap={1}>
        {controls(`${key}:`, columns - 1)}
      </Box>
    </Box>
  )
  return (
    <Box flexDirection="column" position="relative">
      {/* The toolbar: real buttons (`[ label ]` on the terminal, native ones on desktop), so
          they read as controls beside the transcript's plain rows. */}
      <Box flexDirection="row" gap={1}>
        <Button key="back" label={BACK} onPress={onBack} />
        <Button
          key="wrap"
          {...(isWrapped ? { variant: 'primary' as const } : {})}
          label={`wrap ${isWrapped ? 'on' : 'off'}`}
          onPress={onWrap}
        />
        {controls('', columns - TOOLBAR_USED)}
      </Box>
      {controlError('err', viewed)}
      <Box key="title" flexDirection="row" alignItems="center" gap={1}>
        {agent !== undefined && cell('mark', agentMark(agent))}
        {rest('title', agent === undefined ? viewed : name(agent), titleWidth, {
          bold: true,
          color: agent?.status === 'running' ? TONE.running : PALETTE.fg,
        })}
      </Box>
      {/* Below the title: the model, the runs and the working time, with a dot between them,
          under the title's text. */}
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
          {agent.model !== undefined && cell('meta:sep:runs', { text: SEP, dim: true })}
          {cell('meta:runs', { text: runsLabel(agent.runs), dim: true })}
          {cell('meta:sep:time', { text: SEP, dim: true })}
          {cell('meta:time', timeCell(agent, now))}
          {ctxText !== null && cell('meta:sep:ctx', { text: SEP, dim: true })}
          {ctxText !== null &&
            agent.context !== undefined &&
            cell(
              'meta:ctx',
              shownCtx(agent.id, {
                text: '',
                ctx: { ...agent.context, isFull: ctxText === contextText(agent.context, true) },
                color: contextColor(agent.context),
              }),
            )}
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
      {isClient ? (
        <Text key="rule" dimColor wrap="truncate">
          {'─'.repeat(Math.max(0, columns))}
        </Text>
      ) : (
        line('rule')
      )}
      {body()}
      {/* After the transcript: the engine gives no height of the pane, so no row stays at its
          end. */}
      <Box key="sayrow" flexDirection="row">
        {say(viewed, columns, false)}
      </Box>
      {controlError('err:end', viewed)}
      {scrollTop > 0 && sticky('sticky', scrollTop)}
      {/* The engine moves the window after this drawing: until then the row it shows has a bar
          too, so no drawing is without a bar at its top. */}
      {scrollFrom !== undefined &&
        scrollFrom > 0 &&
        scrollFrom !== scrollTop &&
        sticky('stickyfrom', scrollFrom)}
    </Box>
  )
}
