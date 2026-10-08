import { expect, test } from 'claude-code/testing'
import { mdParts, tableLines } from './mdTable'

const TABLE = ['| File | Problem |', '| --- | --- |', '| `a.ts` | **None** here. |'].join('\n')

test('mdParts parts a table from the markdown around it', () => {
  expect(mdParts(`Before.\n\n${TABLE}\n\nAfter.`)).toEqual([
    { kind: 'md', text: 'Before.\n' },
    { kind: 'table', head: ['File', 'Problem'], rows: [['a.ts', 'None here.']] },
    { kind: 'md', text: '\nAfter.' },
  ])
})

test('mdParts gives text with no table as one part', () => {
  expect(mdParts('a | b\nno rule below')).toEqual([{ kind: 'md', text: 'a | b\nno rule below' }])
})

test('mdParts keeps a table in a code fence as markdown', () => {
  const text = `\`\`\`\n${TABLE}\n\`\`\``
  expect(mdParts(text)).toEqual([{ kind: 'md', text }])
})

test('mdParts gives a short row empty cells and reads a link as its label', () => {
  expect(mdParts('| a | b |\n|---|---|\n| [x](https://e.com) |')).toEqual([
    { kind: 'table', head: ['a', 'b'], rows: [['x', '']] },
  ])
})

test('tableLines draws a table that fits at the width of its cells', () => {
  expect(tableLines(['File', 'Problem'], [['a.ts', 'None here.']], 80)).toEqual([
    '┌──────┬────────────┐',
    '│ File │ Problem    │',
    '├──────┼────────────┤',
    '│ a.ts │ None here. │',
    '└──────┴────────────┘',
  ])
})

test('tableLines wraps the cells of a table that is too wide; no line is longer than the room', () => {
  const lines = tableLines(
    ['File', 'Problem'],
    [
      ['a.ts', 'one two three four five six'],
      ['b.ts', 'x'],
    ],
    24,
  )
  expect(lines).toEqual([
    '┌──────┬───────────────┐',
    '│ File │ Problem       │',
    '├──────┼───────────────┤',
    '│ a.ts │ one two three │',
    '│      │ four five six │',
    '├──────┼───────────────┤',
    '│ b.ts │ x             │',
    '└──────┴───────────────┘',
  ])
})

test('tableLines draws a row as a list of its cells when the longest words do not fit', () => {
  expect(
    tableLines(
      ['File', 'Problem'],
      [
        ['src/registry.ts', 'one two three four'],
        ['b', 'x'],
      ],
      16,
    ),
  ).toEqual([
    'File:',
    'src/registry.ts',
    'Problem: one two',
    'three four',
    '────────────────',
    'File: b',
    'Problem: x',
  ])
})
