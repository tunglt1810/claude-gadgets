import { expect, test } from 'claude-code/testing'
import type { Task, TaskGroup } from '../types'
import {
  applyCall,
  firstLine,
  groupTimes,
  isOpen,
  isStopped,
  MAX_PROMPT,
  parseHistory,
  promptTitle,
  replay,
  tasksKey,
} from './tasks'

const create = (id: string, subject: string, description = '') => ({
  tool: 'TaskCreate',
  input: { subject, description, activeForm: subject },
  result: { task: { id, subject } },
})
const updateCall = (input: Record<string, unknown>, success = true) => ({
  tool: 'TaskUpdate',
  input,
  result: { success, taskId: input.taskId },
})
const task = (over: Partial<Task> & { id: string }): Task => ({
  subject: over.id,
  description: '',
  status: 'pending',
  startedAt: null,
  endedAt: null,
  ...over,
})
const apply = (calls: Parameters<typeof applyCall>[1][], now: number | null = 1, prompt = 'p') =>
  calls.reduce<TaskGroup[]>((g, c) => applyCall(g, c, now, prompt), [])

test('the first TaskCreate starts a group with the prompt and the time', () => {
  expect(applyCall([], create('1', 'A', 'dA'), 100, 'p1')).toEqual([
    {
      prompt: 'p1',
      createdAt: 100,
      tasks: [
        {
          id: '1',
          subject: 'A',
          description: 'dA',
          status: 'pending',
          startedAt: null,
          endedAt: null,
        },
      ],
    },
  ])
})

test('tasks are in numeric ID order', () => {
  const ids = (g: TaskGroup[]) => g[0]?.tasks.map((t) => t.id)
  expect(ids(apply([create('2', 'B'), create('1', 'A')]))).toEqual(['1', '2'])
  expect(ids(apply([create('10', 'J'), create('9', 'I')]))).toEqual(['9', '10'])
})

test('a change of status sets the times once', () => {
  let g = apply([create('1', 'A')])
  g = applyCall(g, updateCall({ taskId: '1', status: 'in_progress' }), 200, 'p')
  g = applyCall(g, updateCall({ taskId: '1', status: 'in_progress' }), 300, 'p')
  expect(g[0]?.tasks[0]).toMatchObject({ status: 'in_progress', startedAt: 200, endedAt: null })
  g = applyCall(g, updateCall({ taskId: '1', status: 'completed' }), 400, 'p')
  expect(g[0]?.tasks[0]).toMatchObject({ status: 'completed', startedAt: 200, endedAt: 400 })
})

test('TaskUpdate changes the subject and the description, and deleted removes the task', () => {
  let g = apply([create('1', 'A'), create('2', 'B')])
  g = applyCall(g, updateCall({ taskId: '1', subject: 'A2', description: 'd2' }), 1, 'p')
  expect(g[0]?.tasks[0]).toMatchObject({ subject: 'A2', description: 'd2' })
  g = applyCall(g, updateCall({ taskId: '2', status: 'deleted' }), 1, 'p')
  expect(g[0]?.tasks.map((t) => t.id)).toEqual(['1'])
})

test('TaskUpdate of an unknown ID or with no success changes nothing', () => {
  const g = apply([create('1', 'A')])
  expect(applyCall(g, updateCall({ taskId: '9', status: 'completed' }), 1, 'p')).toBe(g)
  expect(applyCall(g, updateCall({ taskId: '1', status: 'completed' }, false), 1, 'p')).toBe(g)
})

test('a TaskCreate after a group is all completed starts a new group', () => {
  let g = apply([create('1', 'A')], 1, 'p1')
  g = applyCall(g, updateCall({ taskId: '1', status: 'completed' }), 2, 'p1')
  const before = g[0]
  g = applyCall(g, create('2', 'B'), 3, 'p2')
  expect(g.length).toBe(2)
  expect(g[0]).toBe(before)
  expect(g[1]).toMatchObject({ prompt: 'p2', createdAt: 3, tasks: [{ id: '2', subject: 'B' }] })
})

test('TaskList sets the current group and keeps the times and descriptions', () => {
  let g = apply([create('1', 'A', 'dA'), create('2', 'B')])
  g = applyCall(g, updateCall({ taskId: '1', status: 'in_progress' }), 50, 'p')
  g = applyCall(
    g,
    {
      tool: 'TaskList',
      input: {},
      result: {
        tasks: [
          { id: '1', subject: 'A2', status: 'completed', blockedBy: [] },
          { id: '5', subject: 'E', status: 'pending', blockedBy: [] },
        ],
      },
    },
    60,
    'p',
  )
  expect(g[0]?.tasks).toEqual([
    task({ id: '1', subject: 'A2', description: 'dA', status: 'completed', startedAt: 50 }),
    task({ id: '5', subject: 'E' }),
  ])
})

test('a result of an unknown shape changes nothing', () => {
  const g = apply([create('1', 'A')])
  for (const result of [null, 'x', { task: {} }, { tasks: 'no' }])
    for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList'])
      expect(applyCall(g, { tool, input: { taskId: '1' }, result }, 1, 'p')).toBe(g)
  expect(applyCall(g, { tool: 'Bash', input: {}, result: {} }, 1, 'p')).toBe(g)
})

test('replay rebuilds the groups from the messages, with no times', () => {
  const g = replay([
    { role: 'user', text: 'fix nav\nmore', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        {
          tool: 'TaskCreate',
          input: { subject: 'Foo', description: 'd' },
          text: 'Task #4 created successfully: Foo',
        },
        { tool: 'TaskCreate', input: { subject: 'Bad' }, text: 'boom', isError: true },
      ],
    },
  ])
  expect(g).toEqual([
    {
      prompt: 'fix nav',
      createdAt: null,
      tasks: [task({ id: '4', subject: 'Foo', description: 'd' })],
    },
  ])
})

test('a group is open by default only while it runs; a toggle flips it', () => {
  let g = apply([create('1', 'A')])
  g = applyCall(g, updateCall({ taskId: '1', status: 'completed' }), 2, 'p')
  g = applyCall(g, create('2', 'B'), 3, 'p')
  expect(isStopped(g, 0)).toBe(true)
  expect(isStopped(g, 1)).toBe(false)
  expect(isOpen(g, 1, [])).toBe(true)
  expect(isOpen(g, 1, [1])).toBe(false)
  expect(isOpen(g, 0, [])).toBe(false)
  expect(isOpen(g, 0, [0])).toBe(true)
})

test('groupTimes', () => {
  expect(groupTimes({ prompt: '', createdAt: 5, tasks: [task({ id: '1' })] })).toEqual({
    from: 5,
    to: null,
  })
  const done = {
    prompt: '',
    createdAt: 5,
    tasks: [
      task({ id: '1', status: 'completed', startedAt: 10, endedAt: 20 }),
      task({ id: '2', status: 'completed', startedAt: 21, endedAt: 30 }),
    ],
  }
  expect(groupTimes(done)).toEqual({ from: 10, to: 30 })
})

test('parseHistory, tasksKey, firstLine', () => {
  const g = apply([create('1', 'A')])
  expect(parseHistory(JSON.parse(JSON.stringify(g)))).toEqual(g)
  expect(parseHistory('x')).toEqual([])
  expect(parseHistory([{ prompt: 1 }])).toEqual([])
  expect(tasksKey('S1')).toBe('tasks:S1')
  expect(firstLine('  a b\nc')).toBe('a b')
})

test('promptTitle keeps the first line, cut to MAX_PROMPT characters', () => {
  expect(promptTitle('  fix nav\nsecret')).toBe('fix nav')
  const long = promptTitle('x'.repeat(300))
  expect(long.length).toBe(MAX_PROMPT)
  expect(long.endsWith('…')).toBe(true)
})
