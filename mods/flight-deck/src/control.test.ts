import { expect, test } from 'claude-code/testing'
import {
  controlLabels,
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
