import { expect, test } from 'claude-code/testing'
import { ruleOf, rulesFor } from './rule'

const bash = (command: string) => ruleOf('Bash', { command })

test('the rule of a Bash call is the prefix of its command', () => {
  expect(bash('git push origin main')).toBe('Bash(git push:*)')
  expect(bash('rm -rf build')).toBe('Bash(rm:*)')
  expect(bash('python a.py')).toBe('Bash(python:*)')
  expect(bash('ls')).toBe('Bash(ls:*)')
})

test('a command that is not simple has no rule', () => {
  expect(bash('FOO=1 make')).toBeUndefined()
  expect(bash('')).toBeUndefined()
  for (const c of [';', '&&', '|', '<', '>', '$X', '`x`', '(x)', '{x}', '\\', '\n'])
    expect(bash(`git status ${c} rm -rf x`)).toBeUndefined()
})

test('the rule of each other tool is its name', () => {
  expect(ruleOf('Read', { file_path: 'a.md' })).toBe('Read')
  expect(ruleOf('mcp__gh__issue', {})).toBe('mcp__gh__issue')
})

test('a Bash call can match the rule of its first word or of its first two words', () => {
  expect(rulesFor('Bash', { command: 'git push -f' })).toEqual(['Bash(git:*)', 'Bash(git push:*)'])
  expect(rulesFor('Bash', { command: 'rm -rf x' })).toEqual(['Bash(rm:*)', 'Bash(rm -rf:*)'])
  expect(rulesFor('Bash', { command: 'ls' })).toEqual(['Bash(ls:*)'])
})

test('a command that is not simple matches no rule', () => {
  expect(rulesFor('Bash', { command: 'git status && rm -rf x' })).toEqual([])
  expect(rulesFor('Bash', { command: 'FOO=1 make' })).toEqual([])
  expect(rulesFor('Bash', {})).toEqual([])
})

test('each other tool matches the rule of its name', () => {
  expect(rulesFor('Read', { file_path: 'a.md' })).toEqual(['Read'])
})
