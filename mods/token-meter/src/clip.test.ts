import { expect, test } from 'claude-code/testing'
import { clipLines, cut } from './clip'

test('a short text is not changed', () => {
  expect(clipLines('a\nb', 40)).toBe('a\nb')
})

test('a long text keeps max lines and gives the hidden count', () => {
  const text = Array.from({ length: 5000 }, (_, i) => `l${i}`).join('\n')
  const out = clipLines(text, 40).split('\n')
  expect(out).toHaveLength(41)
  expect(out[39]).toBe('l39')
  expect(out[40]).toBe('... 4960 more lines')
})

test('one hidden line reads as singular', () => {
  expect(clipLines('a\nb\nc', 2)).toBe('a\nb\n... 1 more line')
})

test('cut keeps one row inside the width', () => {
  expect(cut('abcdef', 10)).toBe('abcdef')
  expect(cut('abcdef', 4)).toBe('abc…')
  expect(cut('a\nb', 10)).toBe('a b')
  expect(cut('abc', 0)).toBe('')
})
