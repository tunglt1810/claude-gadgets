import { expect, test } from 'claude-code/testing'
import { type MdPart, mdParts, tableLines } from './mdTable'
import { cellWidth } from './wrap'

const TABLE = ['| File | Problem |', '| --- | --- |', '| `a.ts` | **None** here. |'].join('\n')
const LEFT = ['left', 'left']

const table = (text: string) => {
  const part = mdParts(text).find((p) => p.kind === 'table')
  return part as Extract<MdPart, { kind: 'table' }> | undefined
}

test('mdParts parts a table from the markdown around it', () => {
  expect(mdParts(`Before.\n\n${TABLE}\n\nAfter.`)).toEqual([
    { kind: 'md', text: 'Before.\n' },
    { kind: 'table', head: ['File', 'Problem'], align: LEFT, rows: [['a.ts', 'None here.']] },
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

test('mdParts closes a fence only with the mark that opened it', () => {
  // A ``` line in a ~~~ fence, and in a fence of four marks, is code.
  for (const mark of ['~~~', '````']) {
    const text = `${mark}\n\`\`\`\n${TABLE}\n${mark}`
    expect(mdParts(text)).toEqual([{ kind: 'md', text }])
  }
})

test('mdParts gives a short row empty cells and reads a link as its label', () => {
  expect(table('| a | b |\n|---|---|\n| [x](https://e.com) |')).toMatchObject({
    head: ['a', 'b'],
    rows: [['x', '']],
  })
})

test('mdParts keeps the text of a code span as written', () => {
  const rows = table(
    [
      '| a | b |',
      '|---|---|',
      '| `src/**/*.ts` and `**kwargs` | `handlers[i](e)` |',
      '| a `|` in code | ``` or `~~~` |',
      '| an escaped \\| bar | **bold** |',
    ].join('\n'),
  )?.rows
  expect(rows).toEqual([
    ['src/**/*.ts and **kwargs', 'handlers[i](e)'],
    ['a | in code', '``` or ~~~'],
    ['an escaped | bar', 'bold'],
  ])
})

test('mdParts takes no table when the rule has another count of cells than the head', () => {
  // A setext heading, or a paragraph above a rule.
  const text = 'Result: pass | fail\n---\nNext paragraph'
  expect(mdParts(text)).toEqual([{ kind: 'md', text }])
})

test('mdParts reads the side that the rule gives each column', () => {
  expect(table('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |')?.align).toEqual([
    'left',
    'center',
    'right',
  ])
})

test('mdParts ends a table at an empty line or at the start of another block', () => {
  // As the engine's markdown: a line with no bar is a row still.
  expect(mdParts('| a | b |\n|---|---|\n| 1 | 2 |\nlast\n\nAfter | all.')).toEqual([
    {
      kind: 'table',
      head: ['a', 'b'],
      align: LEFT,
      rows: [
        ['1', '2'],
        ['last', ''],
      ],
    },
    { kind: 'md', text: '\nAfter | all.' },
  ])
  expect(mdParts('| a | b |\n|---|---|\n| 1 | 2 |\n# Next | part')).toEqual([
    { kind: 'table', head: ['a', 'b'], align: LEFT, rows: [['1', '2']] },
    { kind: 'md', text: '# Next | part' },
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

test('tableLines gives each row the same count of cells with wide characters', () => {
  const lines = tableLines(
    ['Check', 'Result'],
    [
      ['lint', '✅ 日本語 ok'],
      ['test', '❌'],
    ],
    80,
  )
  for (const line of lines) expect(cellWidth(line)).toBe(cellWidth(lines[0] as string))
  expect(lines[3]).toBe('│ lint  │ ✅ 日本語 ok │')
})

test('tableLines puts a cell at the side of its column', () => {
  expect(tableLines(['n', 'name'], [['1', 'ab']], 80, ['right', 'center'])).toEqual([
    '┌───┬──────┐',
    '│ n │ name │',
    '├───┼──────┤',
    '│ 1 │  ab  │',
    '└───┴──────┘',
  ])
  expect(tableLines(['count'], [['7']], 80, ['right'])[3]).toBe('│     7 │')
})

test('tableLines cuts a long word and keeps the table', () => {
  const lines = tableLines(
    ['File', 'Problem'],
    [['mods/flight-deck/src/cellClient.tsx', 'one two three']],
    30,
  )
  expect(lines[0]).toMatch(/^┌─+┬─+┐$/)
  for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(30)
  expect(lines.join('')).toContain('.tsx')
})

test('tableLines draws a row as a list of its cells when the columns have no room', () => {
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

test('tableLines draws the head of a table that has no rows', () => {
  expect(tableLines(['File', 'Problem'], [], 80)).toEqual([
    '┌──────┬─────────┐',
    '│ File │ Problem │',
    '└──────┴─────────┘',
  ])
  expect(tableLines(['Filename', 'Problem'], [], 12)).toEqual(['Filename', 'Problem'])
})
