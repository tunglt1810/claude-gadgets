import { expect, test } from 'claude-code/testing'
import { controlLabels, sendFailure, stopFailure } from './control'

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
