import { expect, test } from 'claude-code/testing'
import { holdsMono, holdsText } from './engine'

test('holdsText: a Button holds a Text from Claude Code 2.1.295', () => {
  expect(holdsText('2.1.295')).toBe(true)
  expect(holdsText('2.1.296')).toBe(true)
  expect(holdsText('2.2.0')).toBe(true)
  expect(holdsText('3.0.0')).toBe(true)
  expect(holdsText('2.1.294')).toBe(false)
  expect(holdsText('2.1.293')).toBe(false)
  expect(holdsText('2.0.999')).toBe(false)
})

test('holdsText: a development build counts as its release', () => {
  expect(holdsText('2.1.295-dev')).toBe(true)
  expect(holdsText('2.1.293-dev')).toBe(false)
})

test('holdsText: a version that is not a release does not', () => {
  expect(holdsText(undefined)).toBe(false)
  expect(holdsText('next')).toBe(false)
})

test('holdsMono: a Text draws in the monospaced face from Claude Code 2.1.299', () => {
  expect(holdsMono('2.1.299')).toBe(true)
  expect(holdsMono('2.1.300')).toBe(true)
  expect(holdsMono('2.2.0')).toBe(true)
  expect(holdsMono('2.1.298')).toBe(false)
  expect(holdsMono('2.1.295')).toBe(false)
  expect(holdsMono(undefined)).toBe(false)
})
