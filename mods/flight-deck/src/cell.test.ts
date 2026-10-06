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

test("cellText draws a cost after the text: the cell's own, or the one on screen", () => {
  expect(cellText({ text: 'total ≈$', usd: 1.5 }, 0, 0)).toBe('total ≈$1.50')
  expect(cellText({ text: '≈', usd: 2, width: 9, align: 'right' }, 0, 0, 1.234)).toBe('    ≈1.23')
})

test('a context cell draws its tokens, its window and its percentage', () => {
  const ctx = { tokens: 182_400, window: 1_000_000, isFull: true }
  expect(cellText({ text: '', ctx }, 0, 0)).toBe('ctx 182.4k/1M 18%')
  expect(cellText({ text: '', ctx: { ...ctx, isFull: false } }, 0, 0)).toBe('ctx 18%')
  // While the tokens run to a new count, the cell draws the count on screen, as a whole number.
  expect(cellText({ text: '', ctx }, 0, 0, 100_000.4)).toBe('ctx 100.0k/1M 10%')
})
