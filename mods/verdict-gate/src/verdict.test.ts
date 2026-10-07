import { expect, test } from 'claude-code/testing'
import { isNoVerdict, question } from './verdict'

// The engine's own denial texts, from Claude Code 2.1.292.
const NO_VERDICT = [
  'The auto mode classifier gave no verdict for Bash. This is a transient failure of the check, not a judgment about the action',
  'Bash was not reviewed: the auto mode classifier transcript exceeded its context window',
  "The API told auto mode's safety classifier (x) to wait 30s from now",
  'tell the user that auto mode could not evaluate it.',
]

test('a denial without a verdict is found', () => {
  for (const text of NO_VERDICT) expect(isNoVerdict(text)).toBe(true)
})

test('a judgment and a tool error are not found', () => {
  expect(isNoVerdict('Permission for this action was denied: it deletes data.')).toBe(false)
  expect(isNoVerdict('503 Service Temporarily Unavailable')).toBe(false)
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
