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
}

// What the band draws from: the snapshot plus runtime-only turn bookkeeping.
export type Meter = Snapshot & {
  sessionId: string | null
  active: number
  busySince: number | null
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

declare module 'claude-code' {
  interface PluginState {
    'token-meter': {
      meter: Meter
      now: number
      shown: Shown
    }
  }
}
