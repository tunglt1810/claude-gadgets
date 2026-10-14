import { expect, test } from 'claude-code/testing'
import { PALETTE } from './palette'
import { toolsHead, toolsView } from './tools'

test('toolsView sorts the tools by calls, then by name', () => {
  expect(toolsView({ tools: 6, byTool: { Read: 2, Bash: 3, Edit: 1 }, byBash: {} }).rows).toEqual([
    { name: 'Bash', calls: 3 },
    { name: 'Read', calls: 2 },
    { name: 'Edit', calls: 1 },
  ])
  expect(
    toolsView({ tools: 2, byTool: { b: 1, a: 1 }, byBash: {} }).rows.map((r) => r.name),
  ).toEqual(['a', 'b'])
})

test('toolsView counts the calls that no tool row holds', () => {
  // A session of an older version counted its calls, but not by tool.
  expect(toolsView({ tools: 4, byTool: {}, byBash: {} }).hidden).toBe(4)
  expect(toolsView({ tools: 5, byTool: { Bash: 2 }, byBash: {} }).hidden).toBe(3)
  expect(toolsView({ tools: 2, byTool: { Bash: 2 }, byBash: {} }).hidden).toBe(0)
})

test('toolsHead counts the calls and the tools', () => {
  expect(toolsHead(toolsView({ tools: 0, byTool: {}, byBash: {} }))).toEqual({
    text: 'no call',
    dim: true,
  })
  expect(toolsHead(toolsView({ tools: 1, byTool: { Bash: 1 }, byBash: {} }))).toEqual({
    text: '1 call · 1 tool',
    color: PALETTE.orange,
  })
  expect(toolsHead(toolsView({ tools: 5, byTool: { Bash: 3, Read: 2 }, byBash: {} })).text).toBe(
    '5 calls · 2 tools',
  )
  // Calls that no row holds count, and name no tool.
  expect(toolsHead(toolsView({ tools: 4, byTool: {}, byBash: {} })).text).toBe('4 calls')
})

test('toolsView lists the Bash patterns, the most calls first, then by name', () => {
  const v = toolsView({ tools: 3, byTool: { Bash: 3 }, byBash: { rg: 1, 'git status': 2, ls: 1 } })
  expect(v.bash).toEqual([
    { name: 'git status', calls: 2 },
    { name: 'ls', calls: 1 },
    { name: 'rg', calls: 1 },
  ])
})
