import type { AgentEntry, Registry } from '../types'

export type { AgentEntry, Registry }

type Info = Pick<AgentEntry, 'parentId' | 'type' | 'description' | 'name'>

// What `$.agent.list()` gives for one agent, reduced to the fields the registry uses.
export type Listed = {
  id: string
  status: string
  type?: string
  description?: string
  name?: string
  parentId?: string
}

export const agentsKey = (sessionId: string): string => `agents:${sessionId}`

const blank = (id: string, at: number): AgentEntry => ({
  id,
  status: 'running',
  runs: 1,
  startedAt: at,
  endedAt: null,
})

// Only fields that are present in `info` and absent in the entry are taken.
const fill = (a: AgentEntry, info: Partial<Info>): AgentEntry => ({
  ...a,
  ...(a.parentId === undefined && info.parentId !== undefined ? { parentId: info.parentId } : {}),
  ...(a.type === undefined && info.type !== undefined ? { type: info.type } : {}),
  ...(a.description === undefined && info.description !== undefined
    ? { description: info.description }
    : {}),
  ...(a.name === undefined && info.name !== undefined ? { name: info.name } : {}),
})

export const spawned = (r: Registry, id: string, at: number, info: Partial<Info>): Registry => ({
  ...r,
  [id]: fill(r[id] ?? blank(id, at), info),
})

// An event of the agent's loop: the agent runs. Its first event can come before the spawn.
// The first event after an end starts a run, and the run is counted then.
export const ran = (r: Registry, id: string, at: number): Registry => {
  const a = r[id]
  if (a === undefined) return { ...r, [id]: blank(id, at) }
  return {
    ...r,
    [id]: { ...a, status: 'running', runs: a.runs + (a.status === 'running' ? 0 : 1) },
  }
}

// An agent as the pane and the band name it: its type, then what it does.
export const agentTitle = (a: AgentEntry): string =>
  [a.type ?? 'agent', a.description ?? a.name ?? a.id].join(' · ')

// How long an agent worked: from its spawn to `now` while it runs, to its end once it ended.
export const workedMs = (a: AgentEntry, now: number): number =>
  Math.max(0, (a.status === 'running' ? now : (a.endedAt ?? now)) - a.startedAt)

export const completed = (r: Registry, id: string, at: number): Registry => {
  const a = r[id] ?? blank(id, at)
  return { ...r, [id]: { ...a, status: 'idle', endedAt: at } }
}

// The model and the effort of a known agent's latest step: a step without effort clears it.
// `context` is absent for a step with no usage: the entry keeps the one it has.
export const tuned = (
  r: Registry,
  id: string,
  model: string,
  effort: string | undefined,
  context?: AgentEntry['context'],
): Registry => {
  const known = r[id]
  if (known === undefined) return r
  const { effort: _, ...a } = known
  return {
    ...r,
    [id]: {
      ...a,
      model,
      ...(effort === undefined ? {} : { effort }),
      ...(context === undefined ? {} : { context }),
    },
  }
}

// The model id and the effort of an agent's latest step: `claude-sonnet-5-5 high`.
export const modelLabel = (a: AgentEntry | undefined): string | undefined =>
  a?.model === undefined ? undefined : [a.model, a.effort].filter((x) => x !== undefined).join(' ')

// A run that ended with no answer. Its start counted it in `runs`.
export const stopped = (r: Registry, id: string, at: number): Registry => ({
  ...r,
  [id]: { ...(r[id] ?? blank(id, at)), status: 'stopped', endedAt: at },
})

export type TaskStatus = 'completed' | 'failed' | 'killed'

// A task notification of a known agent. No end counts a run: its start counted it. Another
// background task's notification changes nothing. A `completed` one changes no agent that
// runs: the turn.complete of the run ends it, and the notification can come after a message
// started the agent again. An agent in its first run has no earlier run: the notification
// ends it, which covers a turn.complete that the mod did not see.
export const ended = (r: Registry, id: string, status: TaskStatus, at: number): Registry => {
  const a = r[id]
  if (a === undefined) return r
  if (status !== 'completed') return stopped(r, id, at)
  if (a.status === 'running' && a.endedAt !== null) return r
  return { ...r, [id]: { ...a, status: 'idle', endedAt: at } }
}

const TASK_STATUS = new Set<string>(['completed', 'failed', 'killed'])

// The task id and the end status in the text of a task notification.
export const taskNotice = (text: string): { id: string; status: TaskStatus } | null => {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]
  if (id === undefined || status === undefined || !TASK_STATUS.has(status)) return null
  return { id, status: status as TaskStatus }
}

const ACTIVE = new Set(['pending', 'running', 'waiting'])
const DEAD = new Set(['failed', 'killed'])

// The engine's list adds agents that raised no spawn (a forked skill) and fills absent
// fields. Of a known entry's status it changes only a running agent the list shows as
// failed or killed: the events own the rest, and an absent entry tells nothing.
export const merged = (r: Registry, list: readonly Listed[], at: number): Registry => {
  let out = r
  for (const l of list) {
    const known = out[l.id]
    const base: AgentEntry = known ?? {
      ...blank(l.id, at),
      status: ACTIVE.has(l.status) ? 'running' : DEAD.has(l.status) ? 'stopped' : 'idle',
    }
    out = { ...out, [l.id]: fill(base, l) }
    if (DEAD.has(l.status) && base.status === 'running') out = stopped(out, l.id, at)
  }
  return out
}

// A stored registry loaded for a session: a running agent that this process does not list
// ran in a process that ended.
export const restored = (r: Registry, list: readonly Listed[], at: number): Registry => {
  const live = new Set(list.map((l) => l.id))
  let out = r
  for (const a of Object.values(r))
    if (a.status === 'running' && !live.has(a.id)) out = stopped(out, a.id, at)
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Defensive read: the store is JSON written by an earlier version or by hand.
export const parseRegistry = (raw: unknown): Registry => {
  if (!isRecord(raw)) return {}
  const out: Registry = {}
  for (const [id, v] of Object.entries(raw)) {
    if (!isRecord(v) || v.id !== id || !isNum(v.runs) || !isNum(v.startedAt)) continue
    const parentId = str(v.parentId)
    const type = str(v.type)
    const description = str(v.description)
    const name = str(v.name)
    const model = str(v.model)
    const effort = str(v.effort)
    const c = v.context
    const context =
      isRecord(c) && isNum(c.tokens) && isNum(c.window)
        ? { tokens: c.tokens, window: c.window }
        : undefined
    out[id] = {
      id,
      ...(parentId === undefined ? {} : { parentId }),
      ...(type === undefined ? {} : { type }),
      ...(description === undefined ? {} : { description }),
      ...(name === undefined ? {} : { name }),
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
      ...(context === undefined ? {} : { context }),
      status: v.status === 'running' || v.status === 'stopped' ? v.status : 'idle',
      // An older version counted a run at its end: an entry is one started run at least.
      runs: Math.max(1, v.runs),
      startedAt: v.startedAt,
      endedAt: isNum(v.endedAt) ? v.endedAt : null,
    }
  }
  return out
}
