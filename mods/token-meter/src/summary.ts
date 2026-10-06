import { clipLines } from './clip'

const KEYS = ['file_path', 'command', 'description', 'pattern', 'url', 'query', 'path'] as const

const oneRow = (v: string): string => v.replace(/\s+/g, ' ').trim()

// One line for a tool call: the tool name and the argument that identifies the call.
export const toolSummary = (tool: string, input: Record<string, unknown>): string => {
  for (const k of KEYS) {
    const v = input[k]
    if (typeof v === 'string' && v !== '') return `${tool} ${oneRow(v)}`
  }
  const first = Object.values(input).find((v): v is string => typeof v === 'string' && v !== '')
  return first === undefined ? tool : `${tool} ${oneRow(first)}`
}

// What the `Code` element of an expanded tool call draws.
export type CodeView = { source: string; language?: string; format?: 'diff'; path?: string }

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// The input as the expanded tool call shows it, at most `max` lines: a shell command as
// shell source, an edit as a diff of its old and new text, a written file as its content,
// anything else as JSON.
export const inputCode = (tool: string, input: Record<string, unknown>, max: number): CodeView => {
  const path = str(input.file_path)
  const command = str(input.command)
  if (tool === 'Bash' && command !== undefined)
    return { source: clipLines(command, max), language: 'bash' }
  const before = str(input.old_string)
  const after = str(input.new_string)
  if (tool === 'Edit' && path !== undefined && before !== undefined && after !== undefined) {
    // Each side is cut before the hunk is built, so its header counts the lines it has.
    const half = Math.floor(max / 2)
    const gone = clipLines(before, half).split('\n')
    const come = clipLines(after, half).split('\n')
    const hunk = [
      `@@ -1,${gone.length} +1,${come.length} @@`,
      ...gone.map((l) => `-${l}`),
      ...come.map((l) => `+${l}`),
    ]
    return { source: hunk.join('\n'), format: 'diff', path }
  }
  const content = str(input.content)
  if (tool === 'Write' && path !== undefined && content !== undefined)
    return { source: clipLines(content, max), path }
  return { source: clipLines(JSON.stringify(input, null, 2), max), language: 'json' }
}
