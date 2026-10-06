import { expect, test } from 'claude-code/testing'
import { inputCode, toolSummary } from './summary'

test('a file tool shows its path', () => {
  expect(toolSummary('Read', { file_path: '/r/README.md' })).toBe('Read /r/README.md')
})

test('Bash shows its command on one row', () => {
  expect(toolSummary('Bash', { command: 'wc -l\nREADME.md' })).toBe('Bash wc -l README.md')
})

test('Agent shows its description', () => {
  expect(toolSummary('Agent', { description: 'find x', prompt: 'long' })).toBe('Agent find x')
})

test('a search tool shows its pattern', () => {
  expect(toolSummary('Grep', { pattern: 'foo', path: 'src' })).toBe('Grep foo')
})

test('an unknown tool shows its first string value, or its name alone', () => {
  expect(toolSummary('mcp__x__y', { n: 1, q: 'hello' })).toBe('mcp__x__y hello')
  expect(toolSummary('mcp__x__y', { n: 1 })).toBe('mcp__x__y')
})

test('inputCode: a Bash command is shell source', () => {
  expect(inputCode('Bash', { command: 'ls -la' }, 40)).toEqual({
    source: 'ls -la',
    language: 'bash',
  })
})

test('inputCode: an Edit is a diff of the old and the new text', () => {
  expect(
    inputCode('Edit', { file_path: 'src/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' }, 40),
  ).toEqual({
    source: '@@ -1,2 +1,3 @@\n-a\n-b\n+a\n+c\n+d',
    format: 'diff',
    path: 'src/a.ts',
  })
})

test('inputCode: a Write is the file content, colored by its path', () => {
  expect(inputCode('Write', { file_path: 'a.py', content: 'x = 1' }, 40)).toEqual({
    source: 'x = 1',
    path: 'a.py',
  })
})

test('inputCode: any other tool is its input as JSON', () => {
  expect(inputCode('Grep', { pattern: 'x' }, 40)).toEqual({
    source: '{\n  "pattern": "x"\n}',
    language: 'json',
  })
  // A tool input of the wrong shape falls back to JSON too.
  expect(inputCode('Edit', { file_path: 1 }, 40).language).toBe('json')
})

test('inputCode: a long edit keeps a diff the engine can parse', () => {
  const old = Array.from({ length: 100 }, (_, i) => `o${i}`).join('\n')
  const code = inputCode('Edit', { file_path: 'a', old_string: old, new_string: 'n' }, 40)
  const lines = code.source.split('\n')
  expect(lines[0]).toBe('@@ -1,21 +1,1 @@')
  expect(lines).toHaveLength(23)
  expect(lines[21]).toBe('-... 80 more lines')
})
