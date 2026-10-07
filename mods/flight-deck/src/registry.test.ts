import { expect, test } from 'claude-code/testing'
import {
  agentsKey,
  completed,
  ended,
  merged,
  parseRegistry,
  ran,
  restored,
  spawned,
  stopped,
  taskNotice,
  tuned,
} from './registry'

test('spawn adds a running entry with its data', () => {
  const r = spawned({}, 'a1', 100, { parentId: 'p', type: 'Explore', description: 'find x' })
  expect(r.a1).toEqual({
    id: 'a1',
    parentId: 'p',
    type: 'Explore',
    description: 'find x',
    status: 'running',
    runs: 1,
    startedAt: 100,
    endedAt: null,
  })
})

test('a step before the spawn makes one entry that the spawn fills', () => {
  const r = spawned(ran({}, 'a1', 50), 'a1', 100, { type: 'Explore' })
  expect(Object.keys(r)).toEqual(['a1'])
  expect(r.a1?.startedAt).toBe(50)
  expect(r.a1?.type).toBe('Explore')
})

test('complete sets idle, keeps the count of the run and stamps the end', () => {
  const r = completed(spawned({}, 'a1', 100, {}), 'a1', 200)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 1, endedAt: 200 })
})

test('a second run counts again', () => {
  let r = completed(spawned({}, 'a1', 100, {}), 'a1', 200)
  r = ran(r, 'a1', 300)
  // The run is counted when it starts, and each later event of it counts nothing.
  expect(r.a1).toMatchObject({ status: 'running', runs: 2 })
  r = ran(r, 'a1', 350)
  expect(r.a1?.runs).toBe(2)
  r = completed(r, 'a1', 400)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 2, endedAt: 400 })
})

test('a second end of one run counts nothing', () => {
  // The notification of the engine can come before the turn.complete of the run.
  const noticed = ended(spawned({}, 'a1', 100, {}), 'a1', 'completed', 200)
  expect(completed(noticed, 'a1', 250).a1).toMatchObject({ status: 'idle', runs: 1 })
})

test('merge adds an agent seen only in the list and fills absent fields', () => {
  const base = spawned({}, 'a1', 100, {})
  const r = merged(
    base,
    [
      { id: 'a1', status: 'running', type: 'Explore', description: 'd', name: 'n' },
      { id: 'a2', status: 'idle', type: 'fork' },
    ],
    500,
  )
  expect(r.a1).toMatchObject({ type: 'Explore', description: 'd', name: 'n', startedAt: 100 })
  expect(r.a2).toMatchObject({ id: 'a2', type: 'fork', status: 'idle', startedAt: 500 })
})

test('merge does not replace a field that is present', () => {
  const r = merged(
    spawned({}, 'a1', 100, { type: 'Plan' }),
    [{ id: 'a1', status: 'running', type: 'x' }],
    500,
  )
  expect(r.a1?.type).toBe('Plan')
})

test('parseRegistry ignores a wrong shape', () => {
  expect(parseRegistry(null)).toEqual({})
  expect(parseRegistry({ a: 1, b: { id: 'b' } })).toEqual({})
  const good = spawned({}, 'a1', 100, { type: 'Explore' })
  expect(parseRegistry(JSON.parse(JSON.stringify(good)))).toEqual(good)
})

test('agentsKey names the store key of a session', () => {
  expect(agentsKey('S1')).toBe('agents:S1')
})

test('stop sets stopped and stamps the end, and keeps the count of the run', () => {
  const r = stopped(spawned({}, 'a1', 100, {}), 'a1', 200)
  expect(r.a1).toMatchObject({ status: 'stopped', runs: 1, endedAt: 200 })
  expect(stopped({}, 'a2', 300).a2).toMatchObject({ status: 'stopped', startedAt: 300 })
})

test('an event after a stop runs the agent again', () => {
  const r = ran(stopped(spawned({}, 'a1', 100, {}), 'a1', 200), 'a1', 300)
  expect(r.a1).toMatchObject({ status: 'running', runs: 2 })
})

test('a notification ends a known agent only', () => {
  const base = spawned({}, 'a1', 100, {})
  expect(ended(base, 'a1', 'killed', 200).a1).toMatchObject({ status: 'stopped', endedAt: 200 })
  expect(ended(base, 'a1', 'failed', 200).a1?.status).toBe('stopped')
  expect(ended(base, 'bash1', 'killed', 200)).toEqual(base)
})

test('a late completed notification does not count the run again', () => {
  const r = ended(completed(spawned({}, 'a1', 100, {}), 'a1', 200), 'a1', 'completed', 250)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 1 })
})

test('taskNotice reads the id and the status of a notification', () => {
  const text =
    '<task-notification>\n<task-id>a0da1</task-id>\n<status>killed</status>\n</task-notification>'
  expect(taskNotice(text)).toEqual({ id: 'a0da1', status: 'killed' })
  expect(taskNotice('<status>killed</status>')).toBeNull()
  expect(taskNotice('<task-id>a</task-id><status>running</status>')).toBeNull()
})

test('merge stops a running agent that the list shows as killed or failed', () => {
  const base = spawned(spawned({}, 'a1', 100, {}), 'a2', 100, {})
  const r = merged(
    base,
    [
      { id: 'a1', status: 'killed' },
      { id: 'a2', status: 'completed' },
      { id: 'a3', status: 'failed' },
    ],
    500,
  )
  expect(r.a1?.status).toBe('stopped')
  expect(r.a2?.status).toBe('running')
  expect(r.a3?.status).toBe('stopped')
})

test('an event applied after the merge wins over a stale killed in the list', () => {
  const base = stopped(spawned({}, 'a1', 100, {}), 'a1', 200)
  const r = ran(merged(base, [{ id: 'a1', status: 'killed' }], 300), 'a1', 300)
  expect(r.a1?.status).toBe('running')
})

test('restore stops a running agent that the list does not show', () => {
  const base = completed(spawned(spawned({}, 'a1', 100, {}), 'a2', 100, {}), 'a2', 150)
  const withA3 = spawned(base, 'a3', 100, {})
  const r = restored(withA3, [{ id: 'a3', status: 'running' }], 500)
  expect(r.a1).toMatchObject({ status: 'stopped', endedAt: 500 })
  expect(r.a2?.status).toBe('idle')
  expect(r.a3?.status).toBe('running')
})

test('parseRegistry keeps a stopped entry', () => {
  const good = stopped(spawned({}, 'a1', 100, {}), 'a1', 200)
  expect(parseRegistry(JSON.parse(JSON.stringify(good)))).toEqual(good)
})

test('tune keeps the latest model and effort of an agent', () => {
  let r = tuned(spawned({}, 'a1', 100, {}), 'a1', 'claude-sonnet-5-5', 'high')
  expect(r.a1).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' })
  r = tuned(r, 'a1', 'claude-haiku-4-5', undefined)
  expect(r.a1?.model).toBe('claude-haiku-4-5')
  expect(r.a1?.effort).toBeUndefined()
  expect(parseRegistry(JSON.parse(JSON.stringify(tuned(r, 'a1', 'm', '8000'))))).toEqual(
    tuned(r, 'a1', 'm', '8000'),
  )
})

test('tune writes the context and a step with no usage keeps it', () => {
  const ctx = { tokens: 100, window: 1_000_000 }
  let r = tuned(spawned({}, 'a1', 100, {}), 'a1', 'claude-sonnet-5-5', 'high', ctx)
  expect(r.a1?.context).toEqual(ctx)
  r = tuned(r, 'a1', 'claude-sonnet-5-5', 'high')
  expect(r.a1?.context).toEqual(ctx)
  expect(parseRegistry(JSON.parse(JSON.stringify(r)))).toEqual(r)
})

test('parseRegistry loads an entry with no context and ignores a bad one', () => {
  const old = tuned(spawned({}, 'a1', 100, {}), 'a1', 'm', undefined)
  expect(parseRegistry(JSON.parse(JSON.stringify(old))).a1?.context).toBeUndefined()
  for (const bad of [
    { tokens: 'x', window: 1 },
    { tokens: 1 },
    5,
    null,
    { tokens: 1, window: null },
  ]) {
    const raw = { a1: { ...old.a1, context: bad } }
    expect(parseRegistry(raw).a1).toEqual(old.a1)
  }
})

test('a late completed notification does not end an agent that runs again', () => {
  // The notification of a run can come after a message started the agent again.
  const again = ran(completed(spawned({}, 'a1', 100, {}), 'a1', 200), 'a1', 300)
  const r = ended(again, 'a1', 'completed', 350)
  expect(r.a1).toMatchObject({ status: 'running', runs: 2 })
  expect(ran(r, 'a1', 400).a1?.runs).toBe(2)
})

test('parseRegistry reads a record of an older version, with no run, as one started run', () => {
  const old = { a1: { id: 'a1', status: 'stopped', runs: 0, startedAt: 1, endedAt: 2 } }
  expect(parseRegistry(old).a1?.runs).toBe(1)
})

test('a completed notification ends a first run whose turn.complete the mod did not see', () => {
  // An agent in its first run has no earlier run that a late notification can be of.
  const r = ended(spawned({}, 'a1', 100, {}), 'a1', 'completed', 200)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 1, endedAt: 200 })
})
