import { expect, test } from 'claude-code/testing'
import { cellWidth, wrapRows } from './wrap'

test('cellWidth counts the cells that the terminal draws', () => {
  expect(cellWidth('abc')).toBe(3)
  // An emoji and a CJK character take two cells.
  expect(cellWidth('✅')).toBe(2)
  expect(cellWidth('日本')).toBe(4)
  // A combining mark takes none: `ệ` as three code points is one cell.
  expect(cellWidth('ệ')).toBe(1)
  // A text symbol with an emoji selector is drawn as an emoji.
  expect(cellWidth('⚠️')).toBe(2)
})

test('wrapRows breaks a row between two words', () => {
  expect(wrapRows('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrapRows('', 9)).toEqual([''])
})

test('wrapRows cuts a word that is longer than a row', () => {
  expect(wrapRows('ab abcdefgh', 3)).toEqual(['ab', 'abc', 'def', 'gh'])
})

test('wrapRows counts cells, and does not cut a character in two', () => {
  expect(wrapRows('✅ ok ✅', 5)).toEqual(['✅ ok', '✅'])
  expect(wrapRows('日本語', 4)).toEqual(['日本', '語'])
  expect(wrapRows('😀😀', 2)).toEqual(['😀', '😀'])
})
