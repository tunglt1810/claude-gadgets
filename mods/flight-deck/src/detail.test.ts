import { expect, test } from 'claude-code/testing'
import type { AgentEntry, Cell } from '../types'
import { detailCells } from './detail'
import { PALETTE } from './palette'

const agent = (extra: Partial<AgentEntry>): AgentEntry => ({
  id: 'a1',
  status: 'idle',
  runs: 1,
  startedAt: 0,
  endedAt: 10,
  ...extra,
})
const full = agent({
  model: 'claude-sonnet-5-5',
  effort: 'high',
  context: { tokens: 182_400, window: 1_000_000 },
})
// The row as the pane draws it: the cells with one cell between them.
const row = (cells: Cell[]) => cells.map((c) => c.text).join(' ')

test('the detail row names the model, the effort and the context length', () => {
  const cells = detailCells(full, 80)
  expect(row(cells)).toBe('sonnet-5-5 · high · ctx 182.4k/1M 18%')
  expect(cells.at(-1)).toEqual({ text: 'ctx 182.4k/1M 18%', color: PALETTE.green })
  expect(cells.slice(0, -1).every((c) => c.dim === true)).toBe(true)
})

test('an absent part has no cell and no separator', () => {
  expect(row(detailCells(agent({ model: 'claude-haiku-4-5-20251001' }), 80))).toBe('haiku-4-5')
  expect(
    row(detailCells(agent({ model: 'm', context: { tokens: 100_000, window: 200_000 } }), 80)),
  ).toBe('m · ctx 100.0k/200k 50%')
})

test('an agent with no step says so', () => {
  expect(detailCells(agent({}), 80)).toEqual([{ text: 'no step yet', dim: true }])
})

test('a narrow row drops the counts first, then cuts the model', () => {
  expect(row(detailCells(full, 30))).toBe('sonnet-5-5 · high · ctx 18%')
  const narrow = row(detailCells(full, 24))
  expect(narrow.length).toBeLessThanOrEqual(24)
  expect(narrow).toContain('ctx 18%')
  expect(narrow).toContain('high')
})

const width = (cells: Cell[]) => row(cells).length

test('a row is never wider than its room, down to the percentage alone', () => {
  for (let room = 7; room <= 40; room++)
    expect(width(detailCells(full, room))).toBeLessThanOrEqual(room)
  expect(row(detailCells(full, 17))).toBe('high · ctx 18%')
  expect(row(detailCells(full, 10))).toBe('ctx 18%')
})

test('a row with no context cuts the model to its room', () => {
  const noCtx = agent({ model: 'claude-sonnet-5-5', effort: 'high' })
  expect(row(detailCells(noCtx, 80))).toBe('sonnet-5-5 · high')
  for (let room = 1; room <= 20; room++)
    expect(width(detailCells(noCtx, room))).toBeLessThanOrEqual(room)
})

test('a row with no room at all still draws one cell', () => {
  for (const room of [0, -5]) expect(detailCells(full, room)).toHaveLength(1)
})
