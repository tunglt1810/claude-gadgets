import { expect, test } from 'claude-code/testing'
import type { Shell } from '../types'
import {
  added,
  ended,
  endedWithAgent,
  MAX_SHELLS,
  outputTail,
  shellStarted,
  shellsHead,
  shownOrder,
  withTail,
} from './shells'

const PATH = '/private/tmp/claude-501/p/s/tasks/b0bjxpvql.output'

test('a background command gives its id and the path of its output', () => {
  const text = `Command running in background with ID: b0bjxpvql. Output is being written to: ${PATH}. You will be notified when it completes.`
  expect(shellStarted(text)).toEqual({ id: 'b0bjxpvql', path: PATH })
})

test('a command that the engine moved to the background gives its id and path', () => {
  for (const text of [
    `Command was manually backgrounded by user with ID: b1. Output is being written to: ${PATH}.`,
    `Command was moved to the background (ID: b1) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: ${PATH}.`,
    `Command was moved to the background (ID: b1) after running for 120s. Output is being written to: ${PATH}.`,
    `Command did not complete within its 120s timeout and was moved to the background (ID: b1). Output is being written to: ${PATH}.`,
  ])
    expect(shellStarted(text)).toEqual({ id: 'b1', path: PATH })
})

test('a shell that ends with the final response of its agent says so', () => {
  const text = `Command running in background with ID: b2. Output is being written to: ${PATH}. If it exits while you are still working you will be notified, but it is terminated when you give your final response and no notification can follow that.`
  expect(shellStarted(text)).toEqual({ id: 'b2', path: PATH, endsWithRun: true })
})

test('a result that is not a background command gives nothing', () => {
  expect(shellStarted('hello\n')).toBeNull()
  expect(shellStarted(undefined)).toBeNull()
})

test('the tail is the last lines, with no escape codes, control characters or tabs', () => {
  const raw = 'one\n\u001b[32mtwo\u001b[0m\nthree\tx\u0007\nfour\n\n'
  expect(outputTail(raw, 3)).toEqual(['two', 'three  x', 'four'])
})

test('a line that a carriage return rewrote shows its last state', () => {
  expect(outputTail('progress 10%\rprogress 90%\r\ndone\n', 5)).toEqual(['progress 90%', 'done'])
})

test('a very long line is cut', () => {
  expect(outputTail('x'.repeat(5000), 5)[0]?.length).toBe(500)
})

const shell = (id: string, over: Partial<Shell> = {}): Shell => ({
  id,
  command: `run ${id}`,
  path: `/t/${id}.output`,
  status: 'running',
  startedAt: 0,
  tail: [],
  ...over,
})

test('a new shell goes first, and the list keeps the newest shells only', () => {
  let list: Shell[] = []
  for (let i = 0; i < MAX_SHELLS + 2; i++) list = added(list, shell(`s${i}`))
  expect(list.length).toBe(MAX_SHELLS)
  expect(list[0]?.id).toBe(`s${MAX_SHELLS + 1}`)
})

test('a shell ends once, with its status and time', () => {
  const list = [shell('a')]
  const out = ended(list, 'a', 'failed', 50)
  expect(out[0]).toMatchObject({ status: 'failed', endedAt: 50 })
  expect(ended(out, 'a', 'completed', 60)).toBe(out)
  expect(ended(list, 'zz', 'completed', 60)).toBe(list)
})

test('a tail that did not change keeps the list', () => {
  const list = [shell('a', { tail: ['x'] })]
  expect(withTail(list, 'a', ['x'])).toBe(list)
  expect(withTail(list, 'a', ['x', 'y'])[0]?.tail).toEqual(['x', 'y'])
})

test('the head counts the running and the ended shells', () => {
  expect(shellsHead([shell('a'), shell('b', { status: 'completed' })]).text).toBe(
    '1 running · 1 ended',
  )
  expect(shellsHead([shell('a')]).text).toBe('1 running')
  expect(shellsHead([shell('a', { status: 'killed' })]).text).toBe('1 ended')
})

test('the shells that end with the run of an agent end when it ends', () => {
  const list = [
    shell('a', { owner: 'a1' }),
    shell('b', { owner: 'a2' }),
    shell('c'),
    shell('d', { owner: 'a1', status: 'completed', endedAt: 5 }),
  ]
  const out = endedWithAgent(list, 'a1', 70)
  expect(out.map((s) => s.status)).toEqual(['killed', 'running', 'running', 'completed'])
  expect(out[0]?.endedAt).toBe(70)
  expect(endedWithAgent(list, 'zz', 70)).toBe(list)
})

test('the running shells come first, the newest first in each group', () => {
  const list = [
    shell('new-done', { status: 'completed', startedAt: 30 }),
    shell('new-run', { startedAt: 20 }),
    shell('old-done', { status: 'failed', startedAt: 5 }),
    shell('old-run', { startedAt: 10 }),
  ]
  expect(shownOrder(list).map((s) => s.id)).toEqual(['new-run', 'old-run', 'new-done', 'old-done'])
})
