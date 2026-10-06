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
  runs: 0,
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
export const ran = (r: Registry, id: string, at: number): Registry => ({
  ...r,
  [id]: { ...(r[id] ?? blank(id, at)), status: 'running' },
})

export const completed = (r: Registry, id: string, at: number): Registry => {
  const a = r[id] ?? blank(id, at)
  return { ...r, [id]: { ...a, status: 'idle', runs: a.runs + 1, endedAt: at } }
}

const ACTIVE = new Set(['pending', 'running', 'waiting'])

// The engine's list adds agents that raised no spawn (a forked skill) and fills absent
// fields. It does not change the status of a known entry: the events own that.
export const merged = (r: Registry, list: readonly Listed[], at: number): Registry => {
  let out = r
  for (const l of list) {
    const known = out[l.id]
    const base: AgentEntry = known ?? {
      ...blank(l.id, at),
      status: ACTIVE.has(l.status) ? 'running' : 'idle',
    }
    out = { ...out, [l.id]: fill(base, l) }
  }
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
    out[id] = {
      id,
      ...(parentId === undefined ? {} : { parentId }),
      ...(type === undefined ? {} : { type }),
      ...(description === undefined ? {} : { description }),
      ...(name === undefined ? {} : { name }),
      status: v.status === 'running' ? 'running' : 'idle',
      runs: v.runs,
      startedAt: v.startedAt,
      endedAt: isNum(v.endedAt) ? v.endedAt : null,
    }
  }
  return out
}
