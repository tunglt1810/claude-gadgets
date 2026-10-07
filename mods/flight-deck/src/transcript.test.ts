import { expect, test } from 'claude-code/testing'
import { lastItems, type Row, transcriptItems } from './transcript'

const use = (tool: string, input: Record<string, unknown>, extra: object = {}) => ({
  tool_use_id: `id-${tool}`,
  tool,
  input,
  ...extra,
})

// The rows the probe recorded for one agent that ran two times.
const TWO_RUNS: Row[] = [
  {
    role: 'user',
    text: 'Read README.md and reply with its first heading line only.',
    toolUses: [],
  },
  {
    role: 'assistant',
    text: '',
    toolUses: [use('Read', { file_path: 'README.md' }, { text: '# claude-gadgets\n...' })],
  },
  { role: 'user', text: '', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [use('SubagentHandback', { message: '# claude-gadgets' }, { text: 'ok' })],
  },
  { role: 'user', text: '', toolUses: [] },
  { role: 'user', text: 'Follow-up: reply with the number of lines in README.md.', toolUses: [] },
  {
    role: 'assistant',
    text: 'Counting.',
    toolUses: [use('Bash', { command: 'wc -l README.md' }, { text: '52 README.md' })],
  },
  { role: 'user', text: '', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [use('SubagentHandback', { message: '52 lines.' }, { text: 'ok' })],
  },
  { role: 'user', text: '', toolUses: [] },
]

test('two runs give prompts, tools and answers in order', () => {
  expect(transcriptItems(TWO_RUNS)).toEqual([
    { kind: 'prompt', text: 'Read README.md and reply with its first heading line only.' },
    {
      kind: 'tool',
      id: 'id-Read',
      tool: 'Read',
      input: { file_path: 'README.md' },
      result: '# claude-gadgets\n...',
      isError: false,
    },
    { kind: 'answer', text: '# claude-gadgets' },
    { kind: 'prompt', text: 'Follow-up: reply with the number of lines in README.md.' },
    { kind: 'text', text: 'Counting.' },
    {
      kind: 'tool',
      id: 'id-Bash',
      tool: 'Bash',
      input: { command: 'wc -l README.md' },
      result: '52 README.md',
      isError: false,
    },
    { kind: 'answer', text: '52 lines.' },
  ])
})

test('a tool call in progress has no result', () => {
  const items = transcriptItems([
    { role: 'assistant', text: '', toolUses: [use('Bash', { command: 'sleep 9' })] },
  ])
  expect(items).toEqual([
    { kind: 'tool', id: 'id-Bash', tool: 'Bash', input: { command: 'sleep 9' }, isError: false },
  ])
})

test('an errored tool call is marked', () => {
  const items = transcriptItems([
    {
      role: 'assistant',
      text: '',
      toolUses: [use('Read', { file_path: 'x' }, { text: 'no such file', isError: true })],
    },
  ])
  expect(items[0]).toMatchObject({ kind: 'tool', isError: true, result: 'no such file' })
})

test('an Agent call keeps the id of its child', () => {
  const items = transcriptItems([
    {
      role: 'assistant',
      text: '',
      toolUses: [use('Agent', { description: 'd' }, { agentId: 'child1', text: 'done' })],
    },
  ])
  expect(items[0]).toMatchObject({ kind: 'tool', tool: 'Agent', agentId: 'child1' })
})

test('a handback without a message shows its input as JSON', () => {
  const items = transcriptItems([
    { role: 'assistant', text: '', toolUses: [use('SubagentHandback', { other: 1 })] },
  ])
  expect(items).toEqual([{ kind: 'answer', text: '{"other":1}' }])
})

test('lastItems keeps the newest 300 and counts the rest', () => {
  const many = Array.from({ length: 305 }, (_, i) => ({ kind: 'text' as const, text: String(i) }))
  const { items, hidden } = lastItems(many)
  expect(items).toHaveLength(300)
  expect(hidden).toBe(5)
  expect(items[0]).toEqual({ kind: 'text', text: '5' })
  expect(lastItems(many.slice(0, 3))).toEqual({ items: many.slice(0, 3), hidden: 0 })
})

test('lastItems keeps the newest items that fit a size', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ kind: 'text' as const, text: String(i) }))
  // Each item has a size of 3: three items fit 10.
  expect(lastItems(many, () => 3, 10)).toEqual({ items: many.slice(-3), hidden: 7 })
  // The newest item is drawn when it is larger than the limit by itself.
  expect(lastItems(many, () => 30, 10)).toEqual({ items: many.slice(-1), hidden: 9 })
})
