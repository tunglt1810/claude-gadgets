import type { Task, TaskGroup, TaskStatus } from '../types'

export type ToolUseLike = {
  tool: string
  input: Record<string, unknown>
  result?: unknown
  text?: string
  isError?: boolean
}
export type SessionMessageLike = {
  role: 'user' | 'assistant'
  text: string
  toolUses: ToolUseLike[]
}
type Call = { tool: string; input: Record<string, unknown>; result: unknown; text?: string }

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']
// The text of a `TaskCreate` result, for a message that kept no record of it.
const CREATED = /^Task #(\S+) created successfully/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const isStatus = (v: unknown): v is TaskStatus => typeof v === 'string' && STATUSES.includes(v)

const byId = (a: Task, b: Task) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id)

export const tasksKey = (sessionId: string): string => `tasks:${sessionId}`

export const firstLine = (text: string): string => (text.trim().split('\n')[0] ?? '').trim()

const isDone = (g: TaskGroup) => g.tasks.every((t) => t.status === 'completed')

const withCurrent = (groups: TaskGroup[], change: (g: TaskGroup) => TaskGroup | null) => {
  const last = groups.at(-1)
  if (last === undefined) return groups
  const next = change(last)
  return next === null ? groups : [...groups.slice(0, -1), next]
}

const created = (call: Call): string | undefined => {
  const task = isRecord(call.result) ? call.result.task : undefined
  if (isRecord(task)) return str(task.id)
  return call.result === undefined ? CREATED.exec(call.text ?? '')?.[1] : undefined
}

const onCreate = (groups: TaskGroup[], call: Call, now: number | null, prompt: string) => {
  const id = created(call)
  const subject = str(call.input.subject)
  if (id === undefined || subject === undefined) return groups
  const task: Task = {
    id,
    subject,
    description: str(call.input.description) ?? '',
    status: 'pending',
    startedAt: null,
    endedAt: null,
  }
  const last = groups.at(-1)
  if (last === undefined || last.tasks.length === 0 || isDone(last))
    return [...groups, { prompt, createdAt: now, tasks: [task] }]
  return withCurrent(groups, (g) => ({ ...g, tasks: [...g.tasks, task].sort(byId) }))
}

const onUpdate = (groups: TaskGroup[], call: Call, now: number | null) => {
  // A record says whether the update held. A message with its text only is taken as held.
  if (isRecord(call.result) ? call.result.success !== true : call.result !== undefined)
    return groups
  const id = str(call.input.taskId)
  const status = call.input.status
  return withCurrent(groups, (g) => {
    const old = g.tasks.find((t) => t.id === id)
    if (old === undefined) return null
    if (status === 'deleted') return { ...g, tasks: g.tasks.filter((t) => t !== old) }
    const next: Task = { ...old }
    const subject = str(call.input.subject)
    const description = str(call.input.description)
    if (subject !== undefined) next.subject = subject
    if (description !== undefined) next.description = description
    if (isStatus(status)) {
      next.status = status
      if (status === 'in_progress' && next.startedAt === null) next.startedAt = now
      if (status === 'completed') next.endedAt = now
    }
    return { ...g, tasks: g.tasks.map((t) => (t === old ? next : t)) }
  })
}

const onList = (groups: TaskGroup[], call: Call) => {
  const list = isRecord(call.result) ? call.result.tasks : undefined
  if (!Array.isArray(list)) return groups
  return withCurrent(groups, (g) => {
    const tasks: Task[] = []
    for (const item of list) {
      if (!isRecord(item)) continue
      const id = str(item.id)
      const subject = str(item.subject)
      if (id === undefined || subject === undefined || !isStatus(item.status)) continue
      const old = g.tasks.find((t) => t.id === id)
      tasks.push({
        id,
        subject,
        status: item.status,
        description: old?.description ?? '',
        startedAt: old?.startedAt ?? null,
        endedAt: old?.endedAt ?? null,
      })
    }
    return { ...g, tasks: tasks.sort(byId) }
  })
}

export const applyCall = (
  groups: TaskGroup[],
  call: Call,
  now: number | null,
  prompt: string,
): TaskGroup[] => {
  if (call.tool === 'TaskCreate') return onCreate(groups, call, now, prompt)
  if (call.tool === 'TaskUpdate') return onUpdate(groups, call, now)
  if (call.tool === 'TaskList') return onList(groups, call)
  return groups
}

export const replay = (messages: SessionMessageLike[]): TaskGroup[] => {
  let groups: TaskGroup[] = []
  let prompt = ''
  for (const m of messages) {
    if (m.role === 'user' && m.text.trim() !== '') prompt = firstLine(m.text)
    for (const use of m.toolUses) {
      if (use.isError === true) continue
      groups = applyCall(
        groups,
        { tool: use.tool, input: use.input, result: use.result, text: use.text },
        null,
        prompt,
      )
    }
  }
  return groups
}

const parseTask = (v: unknown): Task | null => {
  if (!isRecord(v)) return null
  const { id, subject, description, status, startedAt, endedAt } = v
  const time = (t: unknown) => (typeof t === 'number' ? t : t === null ? null : undefined)
  const start = time(startedAt)
  const end = time(endedAt)
  if (
    typeof id !== 'string' ||
    typeof subject !== 'string' ||
    typeof description !== 'string' ||
    !isStatus(status) ||
    start === undefined ||
    end === undefined
  )
    return null
  return { id, subject, description, status, startedAt: start, endedAt: end }
}

export const parseHistory = (raw: unknown): TaskGroup[] => {
  if (!Array.isArray(raw)) return []
  const groups: TaskGroup[] = []
  for (const g of raw) {
    if (!isRecord(g) || typeof g.prompt !== 'string' || !Array.isArray(g.tasks)) return []
    const createdAt = typeof g.createdAt === 'number' ? g.createdAt : null
    const tasks = g.tasks.map(parseTask)
    if (tasks.some((t) => t === null)) return []
    groups.push({ prompt: g.prompt, createdAt, tasks: tasks as Task[] })
  }
  return groups
}

export const isStopped = (groups: TaskGroup[], index: number): boolean => {
  const g = groups[index]
  return g === undefined || index !== groups.length - 1 || isDone(g)
}

export const isOpen = (groups: TaskGroup[], index: number, toggled: number[]): boolean =>
  !isStopped(groups, index) !== toggled.includes(index)

export const groupTimes = (g: TaskGroup): { from: number | null; to: number | null } => {
  const starts = g.tasks.flatMap((t) => (t.startedAt === null ? [] : [t.startedAt]))
  const ends = g.tasks.flatMap((t) => (t.endedAt === null ? [] : [t.endedAt]))
  return {
    from: starts.length > 0 ? Math.min(...starts) : g.createdAt,
    to: isDone(g) && ends.length > 0 ? Math.max(...ends) : null,
  }
}
