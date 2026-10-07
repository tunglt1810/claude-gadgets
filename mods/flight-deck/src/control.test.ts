import { expect, test } from 'claude-code/testing'
import {
  controlLabels,
  fieldLayout,
  isNoVerdict,
  isOpenAsk,
  isPaneSend,
  sendFailure,
  stopFailure,
} from './control'

test('controlLabels are words in a wide row and icons in a narrow one', () => {
  expect(controlLabels(40, false)).toEqual({ message: '» message', stop: '■ stop' })
  expect(controlLabels(40, true)).toEqual({ message: '» message', stop: '■ stop?' })
  expect(controlLabels(12, false)).toEqual({ message: '»', stop: '■' })
  expect(controlLabels(12, true)).toEqual({ message: '»', stop: '■?' })
})

test('sendFailure names the permission rule when auto mode refused the message', () => {
  expect(
    sendFailure('The server-side auto mode classifier gave no verdict for SendMessage: ...'),
  ).toBe('not sent: add "SendMessage" to permissions.allow')
})

test('sendFailure gives the first line of any other reason', () => {
  expect(sendFailure('No agent by that name.\nTry ListAgents.')).toBe(
    'not sent: No agent by that name.',
  )
  expect(sendFailure(undefined)).toBe('not sent')
})

test('stopFailure gives the first line of the reason', () => {
  expect(stopFailure('No task with that id.\nmore')).toBe('not stopped: No task with that id.')
  expect(stopFailure(undefined)).toBe('not stopped')
})

test('isNoVerdict is true for the reason of auto mode only', () => {
  expect(isNoVerdict('The server-side auto mode classifier gave no verdict for SendMessage')).toBe(
    true,
  )
  expect(isNoVerdict('No agent by that name.')).toBe(false)
  // A message that the classifier refused was judged.
  expect(isNoVerdict('Blocked by the auto mode classifier: the message is not safe.')).toBe(false)
  expect(isNoVerdict(undefined)).toBe(false)
})

test('isOpenAsk is true only for an ask that no rule, hook or ceiling gave', () => {
  expect(isOpenAsk({ decision: 'ask' })).toBe(true)
  expect(isOpenAsk({ decision: 'ask', rule: 'SendMessage' })).toBe(false)
  expect(isOpenAsk({ decision: 'ask', hook: 'PreToolUse' })).toBe(false)
  expect(isOpenAsk({ decision: 'ask', ceiling: 'ask' })).toBe(false)
  expect(isOpenAsk({ decision: 'deny' })).toBe(false)
  expect(isOpenAsk({ decision: 'allow' })).toBe(false)
})

test('isPaneSend is true only for a call of the mod to an agent with a message on its way', () => {
  const sending = new Set(['a1'])
  const own = { plugin: 'flight-deck', input: { to: 'a1', message: 'hi' } }
  expect(isPaneSend(own, sending)).toBe(true)
  // The model, and another plugin.
  expect(isPaneSend({ ...own, plugin: 'engine' }, sending)).toBe(false)
  expect(isPaneSend({ ...own, plugin: 'other-mod' }, sending)).toBe(false)
  // Another agent, a call from the loop of an agent, and no message on its way.
  expect(isPaneSend({ ...own, input: { to: 'a2' } }, sending)).toBe(false)
  expect(isPaneSend({ ...own, agentId: 'a2' }, sending)).toBe(false)
  expect(isPaneSend(own, new Set())).toBe(false)
  expect(isPaneSend({ ...own, input: null }, sending)).toBe(false)
})

// Each case is a text that a live terminal session drew in a pane of 83 columns.
test('fieldLayout counts the rows that the terminal draws a message field in', () => {
  const rows = (text: string) => fieldLayout(text, 83)
  expect(rows('')).toEqual({ rows: 1, pad: 0 })
  expect(rows('reply with the word PONG')).toEqual({ rows: 1, pad: 0 })
  const sentence =
    'this is a long message that goes on and on past the width of the pane so that it must wrap or cut at the edge'
  expect(rows(sentence)).toEqual({ rows: 2, pad: 0 })
  expect(rows('x '.repeat(120))).toEqual({ rows: 4, pad: 0 })
  expect(rows('abcdefghij '.repeat(20))).toEqual({ rows: 4, pad: 0 })
  expect(rows(`${'xx '.repeat(24)}x yy zz`)).toEqual({ rows: 2, pad: 0 })
  // A later row that fills the width is a row as any other.
  const second = `hello world this is row one and it is short enough ${'abcdefghijklmn '.repeat(5)}end`
  expect(rows(second)).toEqual({ rows: 2, pad: 0 })
})

// The terminal drew each of these texts in one row, cut with `…`, in a box of 83 columns.
test('fieldLayout makes the box narrower when the first row fills the width', () => {
  expect(fieldLayout('xx '.repeat(80), 83)).toEqual({ rows: 4, pad: 1 })
  expect(fieldLayout(`${'abcdefghijklmn '.repeat(5)}tail word`, 83)).toEqual({ rows: 2, pad: 1 })
  expect(fieldLayout(`${'abcdefghijklm '.repeat(5)}tail word`, 83)).toEqual({ rows: 2, pad: 1 })
  // The same text fills the first row of a box that is one column wider.
  expect(fieldLayout('x '.repeat(120), 84)).toEqual({ rows: 4, pad: 1 })
  expect(fieldLayout('x '.repeat(120), 85)).toEqual({ rows: 4, pad: 0 })
})

test('fieldLayout is one row when a first word fills each width, and in a box with no room', () => {
  expect(fieldLayout(`${'0123456789'.repeat(11)} and some words`, 83)).toEqual({ rows: 1, pad: 0 })
  expect(fieldLayout('hello', 4)).toEqual({ rows: 1, pad: 0 })
})
