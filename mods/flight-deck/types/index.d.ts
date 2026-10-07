// The contract is self-contained (no imports); src/ imports these types from '../types'.
export type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number }

// One subagent's own share of the session's numbers, keyed by its agent id. `parentId` is
// the agent whose loop spawned it; absent when the main loop did.
export type AgentUsage = {
  totals: Totals
  tools: number
  added: number
  removed: number
  lastStepAt: number | null
  parentId?: string
}

// The part of the meter that survives resume (stored per session id).
// `costUsd` is the engine's session total (latest figure, never summed here); `added` and
// `removed` are the lines file tools changed, as the status line counts them. `agents` and
// `bg` count the subagents and the background tasks the session started. The totals cover
// every loop; `byAgent` holds each subagent's part of them.
export type Snapshot = {
  totals: Totals
  tools: number
  lastStepAt: number | null
  workMs: number
  costUsd: number
  added: number
  removed: number
  agents: number
  bg: number
  byAgent: Record<string, AgentUsage>
  // The tokens of every loop by the model its steps named, and the main loop's model.
  byModel: Record<string, Totals>
  // The cost of those tokens priced at each step, by the cache lifetime of its loop.
  costByModel: Record<string, number>
  // The advisor calls the API ran inside the steps: how many, their time, and the model the
  // settings name. A step's usage leaves their tokens out, so their cost is estimated.
  // `usd` is the growth of the ledger cost that no step holds, over the turns that called it.
  // `base` is that rest at the start of the turn; `pending` marks a call not settled yet.
  advisor: { calls: number; ms: number; usd: number; base: number; model?: string; pending?: true }
  // The steps of the main loop that had a usage: each one read the overhead from the cache.
  steps: number
  // The wire names of the MCP tools that a loop called, each name one time.
  mcpCalls: string[]
  mainModel?: string
}

// What the band draws from: the snapshot plus runtime-only turn bookkeeping.
export type Meter = Snapshot & {
  sessionId: string | null
  active: number
  busySince: number | null
  // The agents whose run holds a work interval.
  working: string[]
}

// One animated number: it moves from `from` to `to`, starting at `startedAt`.
export type Tween = { from: number; to: number; startedAt: number }

// The numbers the band animates when they change.
export type Counts = {
  in: number
  out: number
  tools: number
  cost: number
  added: number
  removed: number
}

// The tweens of one session; another session's values are never drawn.
export type Shown = { sessionId: string | null; tweens: Record<keyof Counts, Tween> }

// The tweens of the named values of one session: the costs of the dashboard.
export type NamedShown = { sessionId: string | null; tweens: Record<string, Tween> }

// One subagent of the session, as the pane lists it. `runs` counts started runs, the one that
// runs too: a message to an ended agent starts it again under the same id. `stopped` is a run
// that ended with no answer: killed, failed or aborted.
export type AgentEntry = {
  id: string
  parentId?: string
  type?: string
  description?: string
  name?: string
  // The address of a teammate in its team: what the TaskStop tool takes for it.
  teammateId?: string
  // The model and the effort of the agent's latest step.
  model?: string
  effort?: string
  // The input side of the agent's latest step, and the window of the step's model.
  context?: { tokens: number; window: number }
  status: 'running' | 'idle' | 'stopped'
  runs: number
  startedAt: number
  endedAt: number | null
}

export type Registry = Record<string, AgentEntry>

// The registry of one session; another session's entries are never drawn.
export type Agents = { sessionId: string | null; entries: Registry }

// One row of the transcript screen.
export type TranscriptItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'tool'
      id: string
      tool: string
      input: Record<string, unknown>
      result?: string
      isError: boolean
      agentId?: string
    }
  | { kind: 'answer'; text: string }

export type Transcript =
  | { agentId: string; items: TranscriptItem[] }
  | { agentId: string; deny: string }

// What the pane shows. `agentId` null is the agent tree; `expanded` holds the tool_use ids
// of the open tool calls; `collapsedAgents` the ids of the agents whose detail row is closed (a row is open at first);
// `isWrapped` draws a transcript's long text on several rows. `isContext` puts the context
// screen in place of the tree; `openCategories` holds the names of its open category rows.
// `compose` is the agent whose message field is open on the tree; `stopAsk` the agent whose
// stop button waits for its second press; `controlError` the message or the stop that the engine refused, with the
// reason (`isAsk`: auto mode did not judge the message, and the pane asks the person); `sent` counts the changes that are not in this state and draw the pane again: a message that the pane sent off, a field that got or lost a row.
export type PaneView = {
  isOpen: boolean
  isWrapped: boolean
  agentId: string | null
  expanded: string[]
  collapsedAgents: string[]
  transcript: Transcript | null
  isContext: boolean
  openCategories: string[]
  compose: string | null
  stopAsk: string | null
  controlError: { agentId: string; reason: string } | { agentId: string; isAsk: true } | null
  sent: number
}

// What a pane button does.
export type PaneAction =
  | { kind: 'open'; agentId: string }
  | { kind: 'expand'; agentId: string }
  | { kind: 'back' }
  | { kind: 'wrap' }
  | { kind: 'context' }
  | { kind: 'recount' }
  | { kind: 'category'; name: string }
  | { kind: 'tool'; toolUseId: string }
  | { kind: 'compose'; agentId: string }
  | { kind: 'stop'; agentId: string }
  | { kind: 'send'; agentId: string; text: string }
  | { kind: 'allow'; agentId: string }

// One cell of a pane row that is not a button: a text, a turning mark (`spin`), or a time that
// counts up from `since` after the text. A right-aligned cell is padded to `width`.
export type Cell = {
  text: string
  color?: string
  dim?: boolean
  bold?: boolean
  spin?: boolean
  since?: number
  // A cost in US dollars, drawn after `text`. A changed cost runs to its new value.
  usd?: number
  // A context length, drawn in place of `text`: `ctx 182.4k/1M 18%`, or `ctx 18%` when not
  // `isFull`. Changed tokens run to their new count.
  ctx?: { tokens: number; window: number; isFull: boolean }
  width?: number
  align?: 'right'
}

// One model's row of the dashboard: its estimated cost (null with no price), the working
// time and the runs of its agents. The main loop's model also takes the session's work time.
// `main` marks the row of the main loop's model: the main loop is not a run of an agent.
export type ModelRow = {
  model: string
  costUsd: number | null
  workMs: number
  runs: number
  main?: true
}

// The numbers above the agents table: the engine's session cost and a row per model.
export type Dashboard = { costUsd: number; rows: ModelRow[] }

// What the pane draws: the agents of the screen and the numbers of the viewed agent.
export type PaneData = {
  sessionId: string | null
  entries: Registry
  stats: Snapshot | null
  dashboard: Dashboard | null
  // The context of the main loop, on the tree screen; null with no sample.
  context: ContextView | null
}

// One item below a category of the context: an MCP server (`count` is its loaded tools), a
// memory file, a skill or a custom agent.
export type ContextGroup = { name: string; tokens: number; count?: number }

// One category of the overhead, with its items; a category with no list has none.
export type ContextCategoryRow = { name: string; tokens: number; items: ContextGroup[] }

// What the mod keeps of one `$.session.usage({ breakdown })` reply. `threshold` is the count
// at which auto-compaction starts, null when it is off. `servers` holds the loaded tools of
// each MCP server by their wire names.
export type ContextSample = {
  detail: 'summary' | 'full'
  tokens: number
  window: number
  threshold: number | null
  // The room that auto-compaction keeps: the buffer rows of the breakdown.
  buffer: number
  // The tokens are a local estimate: the session has no response of the API yet.
  isEstimate: boolean
  categories: ContextCategoryRow[]
  servers: { name: string; tokens: number; tools: string[] }[]
}

// The context of one session: its latest sample, the tokens of the first sample after the
// start or a compaction (`base`), and the main turns that ended since then.
export type ContextState = {
  sessionId: string | null
  sample: ContextSample | null
  base: number | null
  turns: number
}

// What the pane draws of a context. `overhead` is the categories, `messages` the rest of the
// tokens, `buffer` the room that auto-compaction keeps. `carryUsd` is the estimated cost of
// reading tokens from the cache at each of `steps` steps; null for a model with no price.
export type ContextView = {
  detail: 'summary' | 'full'
  tokens: number
  window: number
  overhead: number
  messages: number
  buffer: number
  perTurn: number | null
  turnsLeft: number | null
  steps: number
  carryUsd: number | null
  categories: (ContextCategoryRow & { carryUsd: number | null })[]
  unused: ContextGroup[]
  deadWeight: number
}

declare module 'claude-code' {
  interface PluginState {
    'flight-deck': {
      meter: Meter
      now: number
      shown: Shown
      agents: Agents
      pane: PaneView
      paneData: PaneData
      context: ContextState
      paneShown: NamedShown
      // Where the pane's window is about to be: the offset of the latest scroll, and the
      // offset the pane was drawn with when the scroll was asked for.
      paneScroll: { offset: number; seen: number } | null
      spin: number
      ttls: { main: '5m' | '1h'; agent: '5m' | '1h' } | null
    }
  }
}
