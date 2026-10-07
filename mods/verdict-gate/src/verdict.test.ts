import { expect, test } from 'claude-code/testing'
import { isNoVerdict, question } from './verdict'

// The engine's own denial texts, from Claude Code 2.1.292.
const NO_VERDICT = [
  'Auto mode classifier gave no verdict for Bash. This is a transient failure of the check, not a judgment about the action',
  'Bash was not reviewed: the auto mode classifier transcript exceeded its context window',
  "The API told auto mode's safety classifier (x) to wait 30s from now",
  'tell the user that auto mode could not evaluate it.',
  'The classifier is unavailable, so auto mode cannot determine the safety of Bash right now.',
]

test('a denial without a verdict is found', () => {
  for (const text of NO_VERDICT) expect(isNoVerdict(text)).toBe(true)
})

// The engine's sentences for a call that the classifier judged, from the same release.
const JUDGMENT = [
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: it deletes data',
  'Permission for this action has been denied. Reason: it deletes data',
  'The server-side auto mode classifier judged this action dangerous (it gave no explanation)',
]

test('a judgment is not found', () => {
  for (const text of JUDGMENT) expect(isNoVerdict(text)).toBe(false)
})

test('a judgment that quotes a phrase of a denial without a verdict is not found', () => {
  expect(isNoVerdict(`${JUDGMENT[0]}: the command prints "gave no verdict"`)).toBe(false)
})

test('a tool error is not found', () => {
  expect(isNoVerdict('503 Service Temporarily Unavailable')).toBe(false)
  expect(isNoVerdict('error: auto mode classifier config is not valid')).toBe(false)
})

test('the question names the tool and shows the arguments whole, as JSON', () => {
  expect(question('Bash', { command: 'git push' })).toBe(
    'Auto mode did not review this Bash call: {"command":"git push"}. Run it?',
  )
})

test('a line break in a command is shown as written, not drawn', () => {
  expect(question('Bash', { command: 'true\nrm -rf x' })).toContain('true\\nrm -rf x')
})

test('a call too long to show whole has no question', () => {
  expect(question('Bash', { command: 'x'.repeat(5000) })).toBeUndefined()
})
