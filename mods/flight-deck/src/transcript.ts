import type { TranscriptItem } from '../types'

// The part of the engine's SessionMessage that the pane reads.
export type Row = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly {
    tool_use_id: string
    tool: string
    input: Record<string, unknown>
    text?: string
    isError?: true
    agentId?: string
  }[]
}

// The tool a subagent ends a run with: its input holds the answer of the run.
const HANDBACK = 'SubagentHandback'

// A user row with text is a prompt (the task, or a later message to the agent); one without
// text holds only tool results, which the tool items already carry.
export const transcriptItems = (rows: readonly Row[]): TranscriptItem[] => {
  const items: TranscriptItem[] = []
  for (const row of rows) {
    if (row.text !== '')
      items.push({ kind: row.role === 'user' ? 'prompt' : 'text', text: row.text })
    for (const u of row.toolUses) {
      if (u.tool === HANDBACK) {
        const message = u.input.message
        items.push({
          kind: 'answer',
          text: typeof message === 'string' ? message : JSON.stringify(u.input),
        })
        continue
      }
      items.push({
        kind: 'tool',
        id: u.tool_use_id,
        tool: u.tool,
        input: u.input,
        ...(u.text === undefined ? {} : { result: u.text }),
        isError: u.isError === true,
        ...(u.agentId === undefined ? {} : { agentId: u.agentId }),
      })
    }
  }
  return items
}

export const MAX_ITEMS = 300

// The engine draws the first 100,000 characters of a tree, in the order written. The pane
// keeps its drawn items below that, with room for the rows around them.
export const MAX_CHARS = 80_000

// The newest items the pane draws, and how many older ones it leaves out: 300 at most, and no
// more than fit `limit` by the `size` of each. The newest item is drawn at any size.
export const lastItems = (
  items: TranscriptItem[],
  size: (it: TranscriptItem) => number = () => 0,
  limit = MAX_CHARS,
): { items: TranscriptItem[]; hidden: number } => {
  let kept = 0
  let total = 0
  while (kept < Math.min(items.length, MAX_ITEMS)) {
    total += size(items[items.length - 1 - kept] as TranscriptItem)
    if (kept > 0 && total > limit) break
    kept++
  }
  return kept === items.length
    ? { items, hidden: 0 }
    : { items: items.slice(-kept), hidden: items.length - kept }
}
