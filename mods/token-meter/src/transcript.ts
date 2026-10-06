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

// The newest items the pane draws, and how many older ones it leaves out.
export const lastItems = (items: TranscriptItem[]): { items: TranscriptItem[]; hidden: number } =>
  items.length <= MAX_ITEMS
    ? { items, hidden: 0 }
    : { items: items.slice(-MAX_ITEMS), hidden: items.length - MAX_ITEMS }
