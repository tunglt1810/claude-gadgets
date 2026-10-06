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

// One subagent of the session, as the pane lists it. `runs` counts completed runs: a
// message to a completed agent starts it again under the same id. `stopped` is a run that
// ended with no answer: killed, failed or aborted.
export type AgentEntry = {
  id: string
  parentId?: string
  type?: string
  description?: string
  name?: string
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
// of the open tool calls; `expandedAgents` the ids of the agents whose detail row is open;
// `isWrapped` draws a transcript's long text on several rows.
export type PaneView = {
  isOpen: boolean
  isWrapped: boolean
  agentId: string | null
  expanded: string[]
  expandedAgents: string[]
  transcript: Transcript | null
}

// What a pane button does.
export type PaneAction =
  | { kind: 'open'; agentId: string }
  | { kind: 'expand'; agentId: string }
  | { kind: 'back' }
  | { kind: 'wrap' }
  | { kind: 'tool'; toolUseId: string }

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
      paneShown: NamedShown
      spin: number
      ttls: { main: '5m' | '1h'; agent: '5m' | '1h' } | null
    }
  }
}
