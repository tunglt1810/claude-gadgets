import { expect, test } from 'claude-code/testing'
import type { Registry } from '../types'
import { treeRows } from './tree'

const agent = (id: string, startedAt: number, parentId?: string) => ({
  id,
  ...(parentId === undefined ? {} : { parentId }),
  status: 'idle' as const,
  runs: 1,
  startedAt,
  endedAt: startedAt + 1,
})

const ids = (r: Registry) => treeRows(r).map((row) => `${row.depth}:${row.agent.id}`)

test('the newest agent is first at each depth', () => {
  expect(ids({ a: agent('a', 1), b: agent('b', 2) })).toEqual(['0:b', '0:a'])
})

test('a child is below its parent, one level deeper', () => {
  const r = {
    a: agent('a', 1),
    b: agent('b', 5),
    a1: agent('a1', 2, 'a'),
    a2: agent('a2', 3, 'a'),
    a2x: agent('a2x', 4, 'a2'),
  }
  expect(ids(r)).toEqual(['0:b', '0:a', '1:a2', '2:a2x', '1:a1'])
})

test('a child whose parent is absent shows at depth 0', () => {
  expect(ids({ c: agent('c', 1, 'gone') })).toEqual(['0:c'])
})

test('a parent cycle does not loop', () => {
  const r = { a: agent('a', 1, 'b'), b: agent('b', 2, 'a') }
  expect(
    treeRows(r)
      .map((row) => row.agent.id)
      .sort(),
  ).toEqual(['a', 'b'])
})

test('an empty registry gives no rows', () => {
  expect(treeRows({})).toEqual([])
})
