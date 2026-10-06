import type { AgentEntry } from '../types'

// The column widths of the agents table, in cells: the mark (two cells) and a gap, the name,
// the runs and the time, a one-cell gap before each column after the name.
export type AgentTable = { name: number; runs: number; time: number }

// The time column fits `◷ h:mm:ss`.
const TIME = 9
const MIN_NAME = 8

export const runsLabel = (n: number): string => `${n} run${n === 1 ? '' : 's'}`

export const agentTable = (agents: AgentEntry[], columns: number): AgentTable => {
  const longest = (xs: string[]) => Math.max(0, ...xs.map((x) => x.length))
  // A bare count, as wide as its header at least.
  const runs = longest(['runs', ...agents.map((a) => String(a.runs))])
  const rest = 3 + (runs + 1) + (TIME + 1)
  return { name: Math.max(MIN_NAME, columns - rest), runs, time: TIME }
}

// How long after its end an agent still counts as recent.
export const RECENT_MS = 5 * 60_000

// How recent an agent's activity is at `now`: it runs, it ended a short time ago, or neither.
export const recency = (a: AgentEntry, now: number): 'active' | 'recent' | 'old' =>
  a.status === 'running'
    ? 'active'
    : a.endedAt !== null && now - a.endedAt < RECENT_MS
      ? 'recent'
      : 'old'
