import { expect, test } from 'claude-code/testing'
import { linesChanged } from './diff'

test('an edit counts the + and - lines of every hunk', () => {
  const result = {
    filePath: 'a.ts',
    structuredPatch: [
      { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+c', '+d', ' e'] },
      { oldStart: 9, oldLines: 2, newStart: 10, newLines: 1, lines: ['-x', ' y'] },
    ],
  }
  expect(linesChanged(result)).toEqual({ added: 2, removed: 2 })
})

test('a created file has an empty patch: every line of its content is added', () => {
  const result = {
    type: 'create',
    filePath: 'a.ts',
    content: 'one\ntwo\nthree',
    structuredPatch: [],
  }
  expect(linesChanged(result)).toEqual({ added: 3, removed: 0 })
})

test('an empty patch without content changes nothing', () => {
  expect(linesChanged({ structuredPatch: [] })).toEqual({ added: 0, removed: 0 })
  expect(linesChanged({ structuredPatch: [], content: '' })).toEqual({ added: 0, removed: 0 })
})

test('results of other tools and malformed records change nothing', () => {
  for (const r of [undefined, null, 'text', 3, {}, { stdout: '+x' }, { structuredPatch: 'x' }]) {
    expect(linesChanged(r)).toEqual({ added: 0, removed: 0 })
  }
  expect(linesChanged({ structuredPatch: [null, { lines: 'x' }, { lines: [1, '+a'] }] })).toEqual({
    added: 1,
    removed: 0,
  })
})
