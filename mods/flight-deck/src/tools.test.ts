import { expect, test } from 'claude-code/testing'
import { PALETTE } from './palette'
import { subKeysOf, toolsHead, toolsView, treeLines } from './tools'

const view = (tools: number, byTool: Record<string, number>, bySub = {}) =>
  toolsView({ tools, byTool, bySub })

test('toolsView sorts the tools by calls, then by name', () => {
  expect(view(6, { Read: 2, Bash: 3, Edit: 1 }).rows.map((r) => [r.name, r.calls])).toEqual([
    ['Bash', 3],
    ['Read', 2],
    ['Edit', 1],
  ])
  expect(view(2, { b: 1, a: 1 }).rows.map((r) => r.name)).toEqual(['a', 'b'])
})

test('toolsView counts the calls that no tool row holds', () => {
  // A session of an older version counted its calls, but not by tool.
  expect(view(4, {}).hidden).toBe(4)
  expect(view(5, { Bash: 2 }).hidden).toBe(3)
  expect(view(2, { Bash: 2 }).hidden).toBe(0)
})

test('the MCP tools of a server are one row, with a child per tool', () => {
  const v = view(6, {
    mcp__figma__get_metadata: 3,
    mcp__figma__search_nodes: 1,
    mcp__claude_ai_Gmail__authenticate: 1,
    Read: 1,
  })
  expect(v.rows.map((r) => [r.name, r.calls])).toEqual([
    ['mcp__figma', 4],
    ['Read', 1],
    ['mcp__claude_ai_Gmail', 1],
  ])
  expect(v.rows[0]?.children).toEqual([
    { name: 'get_metadata', calls: 3, children: [] },
    { name: 'search_nodes', calls: 1, children: [] },
  ])
  // The head counts the tools, not the rows.
  expect(v.kinds).toBe(4)
})

test('the Bash patterns are a tree: a command, then its subcommands', () => {
  const v = view(5, { Bash: 5 }, { Bash: { 'git status': 2, 'git log': 1, rg: 4, 'bun run': 1 } })
  expect(v.rows[0]?.children).toEqual([
    { name: 'rg', calls: 4, children: [] },
    {
      name: 'git',
      calls: 3,
      children: [
        { name: 'status', calls: 2, children: [] },
        { name: 'log', calls: 1, children: [] },
      ],
    },
    { name: 'bun', calls: 1, children: [{ name: 'run', calls: 1, children: [] }] },
  ])
})

test('the Agent and Skill rows list their kinds', () => {
  const v = view(
    4,
    { Agent: 3, Skill: 1 },
    { Agent: { Explore: 2, 'general-purpose': 1 }, Skill: { tdd: 1 } },
  )
  expect(v.rows[0]?.children.map((c) => c.name)).toEqual(['Explore', 'general-purpose'])
  expect(v.rows[1]?.children.map((c) => c.name)).toEqual(['tdd'])
})

test('treeLines draws the connectors of a tree', () => {
  const lines = treeLines([
    { name: 'rg', calls: 4, children: [] },
    {
      name: 'git',
      calls: 3,
      children: [
        { name: 'status', calls: 2, children: [] },
        { name: 'log', calls: 1, children: [] },
      ],
    },
  ])
  expect(lines.map((l) => `${l.prefix}${l.name} ${l.calls}`)).toEqual([
    '├─ rg 4',
    '└─ git 3',
    '   ├─ status 2',
    '   └─ log 1',
  ])
  expect(
    treeLines([
      { name: 'a', calls: 2, children: [{ name: 'x', calls: 2, children: [] }] },
      { name: 'b', calls: 1, children: [] },
    ]).map((l) => l.prefix + l.name),
  ).toEqual(['├─ a', '│  └─ x', '└─ b'])
})

test('subKeysOf names what a call of each tool did', () => {
  expect(subKeysOf('Bash', { command: 'git status && rg x' })).toEqual(['git status', 'rg'])
  expect(subKeysOf('Agent', { subagent_type: 'Explore' })).toEqual(['Explore'])
  // An Agent call with no type starts the general-purpose agent.
  expect(subKeysOf('Agent', {})).toEqual(['general-purpose'])
  expect(subKeysOf('Skill', { skill: 'superpowers:brainstorming' })).toEqual([
    'superpowers:brainstorming',
  ])
  expect(subKeysOf('Skill', {})).toEqual([])
  expect(subKeysOf('LSP', { operation: 'hover', filePath: '/x', line: 1 })).toEqual(['hover'])
  expect(subKeysOf('LSP', {})).toEqual([])
  expect(subKeysOf('Read', { file_path: '/x' })).toEqual([])
})

test('toolsHead counts the calls and the tools', () => {
  expect(toolsHead(view(0, {}))).toEqual({ text: 'no call', dim: true })
  expect(toolsHead(view(1, { Bash: 1 }))).toEqual({
    text: '1 call · 1 tool',
    color: PALETTE.orange,
  })
  expect(toolsHead(view(5, { Bash: 3, Read: 2 })).text).toBe('5 calls · 2 tools')
  // Calls that no row holds count, and name no tool.
  expect(toolsHead(view(4, {})).text).toBe('4 calls')
})
