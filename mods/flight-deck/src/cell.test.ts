import { expect, test } from 'claude-code/testing'
import { cellText } from './cell'

test('cellText draws the text, a spinner frame, or a live time', () => {
  expect(cellText({ text: 'claude-sonnet-5-5 high' }, 0, 0)).toBe('claude-sonnet-5-5 high')
  expect(cellText({ text: '', spin: true }, 1, 0)).toBe('⣽')
  expect(cellText({ text: '◷ ', since: 1000 }, 0, 66_000)).toBe('◷ 1:05')
})

test('cellText pads a right-aligned cell to its width', () => {
  expect(cellText({ text: '2 runs', width: 8, align: 'right' }, 0, 0)).toBe('  2 runs')
  expect(cellText({ text: '◷ ', since: 0, width: 9, align: 'right' }, 0, 5000)).toBe('   ◷ 0:05')
  expect(cellText({ text: '1 run', width: 8 }, 0, 0)).toBe('1 run')
})
