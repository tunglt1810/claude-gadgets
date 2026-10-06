import { expect, test } from 'claude-code/testing'
import { agentsKey, completed, merged, parseRegistry, ran, spawned } from './registry'

test('spawn adds a running entry with its data', () => {
  const r = spawned({}, 'a1', 100, { parentId: 'p', type: 'Explore', description: 'find x' })
  expect(r.a1).toEqual({
    id: 'a1',
    parentId: 'p',
    type: 'Explore',
    description: 'find x',
    status: 'running',
    runs: 0,
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

test('complete sets idle, counts the run and stamps the end', () => {
  const r = completed(spawned({}, 'a1', 100, {}), 'a1', 200)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 1, endedAt: 200 })
})

test('a second run counts again', () => {
  let r = completed(spawned({}, 'a1', 100, {}), 'a1', 200)
  r = ran(r, 'a1', 300)
  expect(r.a1?.status).toBe('running')
  r = completed(r, 'a1', 400)
  expect(r.a1).toMatchObject({ status: 'idle', runs: 2, endedAt: 400 })
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
