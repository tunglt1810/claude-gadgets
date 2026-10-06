export type LinesChanged = { added: number; removed: number }

const count = (lines: unknown, sign: string): number =>
  Array.isArray(lines) ? lines.filter((l) => typeof l === 'string' && l.startsWith(sign)).length : 0

// Lines a file tool's result added and removed, counted the way the engine counts them
// for the status line: the `+` and `-` lines of the result's `structuredPatch`, or every
// line of `content` when the patch is empty (a created file). Anything else is 0/0.
export const linesChanged = (result: unknown): LinesChanged => {
  if (typeof result !== 'object' || result === null) return { added: 0, removed: 0 }
  const r = result as Record<string, unknown>
  if (!Array.isArray(r.structuredPatch)) return { added: 0, removed: 0 }
  if (r.structuredPatch.length === 0) {
    const content = typeof r.content === 'string' ? r.content : ''
    return { added: content === '' ? 0 : content.split('\n').length, removed: 0 }
  }
  const hunks = r.structuredPatch.map((h) =>
    typeof h === 'object' && h !== null ? (h as Record<string, unknown>).lines : undefined,
  )
  return {
    added: hunks.reduce<number>((n, lines) => n + count(lines, '+'), 0),
    removed: hunks.reduce<number>((n, lines) => n + count(lines, '-'), 0),
  }
}
