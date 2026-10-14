import type { Cell, Snapshot, ToolNode, ToolsView } from '../types'
import { bashPatterns } from './bashPattern'
import { PALETTE } from './palette'

// The tools whose calls the mod counts by what they did: the patterns of a Bash command, the
// type of an agent, the name of a skill. An MCP tool needs no count of its own: its name holds
// its server.
export const subKeysOf = (tool: string, input: unknown): string[] => {
  const i = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  if (tool === 'Bash') return typeof i.command === 'string' ? bashPatterns(i.command) : []
  // An Agent call with no type starts the general-purpose agent.
  if (tool === 'Agent')
    return [typeof i.subagent_type === 'string' ? i.subagent_type : 'general-purpose']
  if (tool === 'Skill') return typeof i.skill === 'string' ? [i.skill] : []
  return []
}

const byCalls = (a: ToolNode, b: ToolNode): number =>
  b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

// A node per name, the most calls first, then by name.
const leaves = (counts: Record<string, number>): ToolNode[] =>
  Object.entries(counts)
    .map(([name, calls]) => ({ name, calls, children: [] }))
    .sort(byCalls)

// The nodes of names in two parts (`git status`, `server__tool`): a node per first part, with
// a child per second part. A name with no second part is a leaf.
const grouped = (counts: Record<string, number>, split: (name: string) => [string, string?]) => {
  const groups = new Map<string, Record<string, number>>()
  const alone: Record<string, number> = {}
  for (const [name, calls] of Object.entries(counts)) {
    const [head, rest] = split(name)
    if (rest === undefined) alone[head] = (alone[head] ?? 0) + calls
    else groups.set(head, { ...groups.get(head), [rest]: calls })
  }
  const nodes: ToolNode[] = [...groups].map(([name, sub]) => {
    const children = leaves(sub)
    // A command that ran alone too (`git` and `git status`) counts both.
    const own = alone[name] ?? 0
    delete alone[name]
    return { name, calls: own + children.reduce((n, c) => n + c.calls, 0), children }
  })
  return [...nodes, ...leaves(alone)].sort(byCalls)
}

const atSpace = (name: string): [string, string?] => {
  const at = name.indexOf(' ')
  return at < 0 ? [name] : [name.slice(0, at), name.slice(at + 1)]
}

// `mcp__server__tool`: the row is `mcp__server`, the child is the tool.
const mcpServer = (name: string): [string, string?] => {
  const at = name.indexOf('__', 'mcp__'.length)
  return at < 0 ? [name] : [name.slice(0, at), name.slice(at + 2)]
}

// What the tools screen draws of a snapshot: a row per tool, the MCP tools as a row per
// server, the most calls first. A row's children are what its calls did.
export const toolsView = (s: Pick<Snapshot, 'tools' | 'byTool' | 'bySub'>): ToolsView => {
  const mcp: Record<string, number> = {}
  const plain: Record<string, number> = {}
  for (const [name, calls] of Object.entries(s.byTool))
    (name.startsWith('mcp__') ? mcp : plain)[name] = calls
  const rows = [
    ...leaves(plain).map((r) => {
      const sub = s.bySub[r.name] ?? {}
      return { ...r, children: r.name === 'Bash' ? grouped(sub, atSpace) : leaves(sub) }
    }),
    ...grouped(mcp, mcpServer),
  ].sort(byCalls)
  const listed = rows.reduce((n, r) => n + r.calls, 0)
  return {
    total: s.tools,
    hidden: Math.max(0, s.tools - listed),
    kinds: Object.keys(s.byTool).length,
    rows,
  }
}

// The lines of a tree below its row, each with its connectors: `├─ ` and `└─ `, and `│  `
// under a node that has a sibling below it.
export const treeLines = (
  nodes: readonly ToolNode[],
  indent = '',
): { prefix: string; name: string; calls: number }[] =>
  nodes.flatMap((n, i) => {
    const isLast = i === nodes.length - 1
    return [
      { prefix: `${indent}${isLast ? '└─ ' : '├─ '}`, name: n.name, calls: n.calls },
      ...treeLines(n.children, `${indent}${isLast ? '   ' : '│  '}`),
    ]
  })

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

// The cell after the tools button, and the headline of the tools screen.
export const toolsHead = (v: ToolsView): Cell =>
  v.total === 0
    ? { text: 'no call', dim: true }
    : {
        text:
          v.kinds === 0
            ? plural(v.total, 'call')
            : `${plural(v.total, 'call')} · ${plural(v.kinds, 'tool')}`,
        color: PALETTE.orange,
      }
