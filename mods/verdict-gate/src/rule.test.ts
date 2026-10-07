import { expect, test } from 'claude-code/testing'
import { ruleOf } from './rule'

const bash = (command: string) => ruleOf('Bash', { command })

test('the rule of a Bash call is its command and its subcommand', () => {
  expect(bash('git push origin main')).toBe('Bash(git push:*)')
  expect(bash('git push')).toBe('Bash(git push:*)')
  expect(bash('  bun   run check')).toBe('Bash(bun run:*)')
})

test('a command with no subcommand has no rule: one word says too little about what runs', () => {
  for (const c of ['ls', 'rm -rf build', 'python a.py', 'bash -c "rm -rf x"', 'env -i make'])
    expect(bash(c)).toBeUndefined()
})

test('a command that is not simple has no rule', () => {
  expect(bash('FOO=1 git push')).toBeUndefined()
  expect(bash('')).toBeUndefined()
  expect(ruleOf('Bash', {})).toBeUndefined()
  for (const c of [';', '&&', '|', '<', '>', '$X', '`x`', '(x)', '{x}', '\\', '\n'])
    expect(bash(`git status ${c} rm -rf x`)).toBeUndefined()
})

test('the rule of each other tool is its name', () => {
  expect(ruleOf('Read', { file_path: 'a.md' })).toBe('Read')
  expect(ruleOf('mcp__gh__issue', {})).toBe('mcp__gh__issue')
})
