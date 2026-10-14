import { expect, test } from 'claude-code/testing'
import { isNoVerdict, paneInput, paneQuestion, question, tooLong } from './verdict'

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
  expect(question('Bash', '{"command":"git push"}')).toBe(
    'Auto mode did not review this Bash call: {"command":"git push"}. Run it?',
  )
})

test('a line break in a command is shown as written, not drawn', () => {
  expect(question('Bash', JSON.stringify({ command: 'true\nrm -rf x' }))).toContain(
    'true\\nrm -rf x',
  )
})

test('a call too long to show whole in the question has no question', () => {
  // The dialog of a terminal does not scroll: a longer input hides its tail.
  expect(question('Bash', 'x'.repeat(2001))).toBeUndefined()
  expect(question('Bash', 'x'.repeat(2000))).toContain('x'.repeat(2000))
})

test('the question beside the pane is short and counts the characters of the input', () => {
  expect(paneQuestion('Write', 'x'.repeat(12_345))).toBe(
    'Auto mode did not review this Write call (12,345 characters, full input in the pane). Run it?',
  )
})

test('a call of up to 20,000 characters has a question beside the pane', () => {
  expect(paneQuestion('Write', 'x'.repeat(20_000))).toBeDefined()
  expect(paneQuestion('Write', 'x'.repeat(20_001))).toBeUndefined()
})

test('the pane shows the input whole, one field to a line, each hidden character as its code point', () => {
  expect(paneInput(JSON.stringify({ command: 'a\u202eb', n: 1 }))).toBe(
    '{\n  "command": "a\\u{202e}b",\n  "n": 1\n}',
  )
})

test('the toast of a call too long to show names its length', () => {
  expect(tooLong('x'.repeat(25_000))).toBe(
    'verdict-gate: input too long to show (25,000 characters)',
  )
})

test('the question shows each hidden character as its code point', () => {
  const text = question('Bash', JSON.stringify({ command: 'a\u202eb\u200bc\u007fd\u009be\u00a0f' }))
  expect(text).toContain('a\\u{202e}b\\u{200b}c\\u{7f}d\\u{9b}e\\u{a0}f')
})

test('the question shows a letter that is not ASCII as its code point: it can look like an ASCII one', () => {
  // U+0456 is a Cyrillic letter that a terminal draws as the Latin `i`.
  expect(question('Bash', '{"command":"g\u0456t push"}')).toContain('g\\u{456}t push')
  expect(question('Write', '{"content":"e\u0301"}')).toContain('e\\u{301}')
})

test('a rejection of the user is not found', () => {
  expect(
    isNoVerdict(
      "The user doesn't want to proceed with this tool use. The user said: gave no verdict",
    ),
  ).toBe(false)
  expect(isNoVerdict("The user doesn't want to take this action right now. gave no verdict")).toBe(
    false,
  )
})
