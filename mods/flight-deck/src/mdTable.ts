import { cellWidth, wrapRows } from './wrap'

export type Align = 'left' | 'center' | 'right'

// A part of a markdown text: a table, with its cells as plain text, or the markdown between
// two tables.
export type MdPart =
  | { kind: 'md'; text: string }
  | { kind: 'table'; head: string[]; align: Align[]; rows: string[][] }

// The rule below the head of a table: `|---|:--:|`.
const RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
// The line that opens or closes a code fence: its marks, and the text after them.
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
// The line that starts another block, which ends a table: a heading, a quote or a fence.
const BLOCK = /^\s*(#{1,6}\s|>|`{3,}|~{3,})/

// The start of the run of exactly `count` backticks at or after `from`, or -1.
const closing = (text: string, from: number, count: number): number => {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '`') continue
    let end = i
    while (text[end] === '`') end++
    if (end - i === count) return i
    i = end
  }
  return -1
}

// Markdown outside a code span as plain text: the marks of bold go, and a link is its label.
const plain = (text: string): string =>
  text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '')

// The cells of a table row as plain text. The text of a code span stays as written, and a bar
// in it does not part two cells: a cell that the engine's markdown cuts there is whole here.
const cells = (line: string): string[] => {
  const src = line.trim()
  const out: string[] = []
  let cell = ''
  let text = ''
  const flush = () => {
    cell += plain(text)
    text = ''
  }
  for (let i = 0; i < src.length; ) {
    if (src[i] === '\\' && src[i + 1] === '|') {
      text += '|'
      i += 2
    } else if (src[i] === '`') {
      let count = 1
      while (src[i + count] === '`') count++
      const end = closing(src, i + count, count)
      flush()
      // Backticks with no closing run are text.
      cell += end === -1 ? src.slice(i, i + count) : src.slice(i + count, end)
      i = end === -1 ? i + count : end + count
    } else if (src[i] === '|') {
      flush()
      out.push(cell)
      cell = ''
      i++
    } else text += src[i++]
  }
  flush()
  out.push(cell)
  if (src.startsWith('|')) out.shift()
  if (src.endsWith('|') && !src.endsWith('\\|')) out.pop()
  return out.map((c) => c.replace(/\s+/g, ' ').trim())
}

const side = (rule: string): Align =>
  rule.endsWith(':') ? (rule.startsWith(':') ? 'center' : 'right') : 'left'

// The tables of a markdown text, apart from the markdown around them. The engine sizes a
// table of a `Markdown` to a width that is not the pane's: the pane draws a table itself.
export const mdParts = (text: string): MdPart[] => {
  const lines = text.split('\n')
  const parts: MdPart[] = []
  let md: string[] = []
  // The marks of the open code fence: a fence closes with as many of the same mark, or more.
  let fence: string | null = null
  const flush = () => {
    if (md.length > 0) parts.push({ kind: 'md', text: md.join('\n') })
    md = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    const mark = FENCE.exec(line)
    if (mark !== null) {
      const [, marks = '', rest = ''] = mark
      if (fence === null) fence = marks
      else if (marks[0] === fence[0] && marks.length >= fence.length && rest.trim() === '')
        fence = null
      md.push(line)
      continue
    }
    const rule = lines[i + 1]
    const head = cells(line)
    // A table has a bar in its head, and a rule with as many cells as the head.
    if (
      fence !== null ||
      !line.includes('|') ||
      rule === undefined ||
      !RULE.test(rule) ||
      cells(rule).length !== head.length
    ) {
      md.push(line)
      continue
    }
    const rows: string[][] = []
    // As the engine's markdown: a table ends at an empty line or at another block, and a
    // line with no bar before that is a row.
    for (i += 2; i < lines.length; i++) {
      const next = lines[i] as string
      if (next.trim() === '' || BLOCK.test(next)) break
      const row = cells(next)
      rows.push(head.map((_, c) => row[c] ?? ''))
    }
    i--
    flush()
    parts.push({ kind: 'table', head, align: cells(rule).map(side), rows })
  }
  flush()
  return parts
}

const longestWord = (text: string) => Math.max(0, ...text.split(' ').map(cellWidth))

// The cells that a column keeps for a long word when the table has less room for it.
const MIN_COLUMN = 6

const pad = (text: string, width: number, align: Align = 'left'): string => {
  const gap = Math.max(0, width - cellWidth(text))
  const left = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0
  return `${' '.repeat(left)}${text}${' '.repeat(gap - left)}`
}

// The rows of a table in `columns` cells, as the main transcript draws one: each column as
// wide as its longest cell when the table fits; narrower columns with wrapped cells when it
// does not; and each row as a list of `head: cell` when the columns have no room. A word
// longer than an equal part of the room is cut: it does not make the table a list.
export const tableLines = (
  head: string[],
  rows: string[][],
  columns: number,
  align: Align[] = [],
): string[] => {
  const all = [head, ...rows]
  const col = (f: (cell: string) => number) =>
    head.map((_, c) => Math.max(1, ...all.map((r) => f(r[c] ?? ''))))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  // A bar and two spaces for each column, and the last bar.
  const room = columns - (3 * head.length + 1)
  const part = Math.max(MIN_COLUMN, Math.floor(room / head.length))
  const full = col(cellWidth)
  const least = col((cell) => Math.min(longestWord(cell), part))

  if (sum(least) > room) {
    const width = Math.max(1, columns)
    if (rows.length === 0) return head.flatMap((h) => wrapRows(h, width))
    const rule = '─'.repeat(width)
    return rows.flatMap((row, r) => [
      ...(r === 0 ? [] : [rule]),
      ...row.flatMap((cell, c) => wrapRows(`${head[c]}: ${cell}`, width)),
    ])
  }

  const widths = [...least]
  if (sum(full) <= room) widths.splice(0, widths.length, ...full)
  else {
    // The room that is left goes to the columns by the width that each still needs.
    const spare = room - sum(least)
    const need = sum(full) - sum(least)
    for (let c = 0; c < widths.length; c++)
      widths[c] =
        (least[c] as number) +
        Math.floor((spare * ((full[c] as number) - (least[c] as number))) / need)
  }

  const border = (left: string, mid: string, right: string) =>
    `${left}${widths.map((w) => '─'.repeat(w + 2)).join(mid)}${right}`
  const draw = (row: string[]) => {
    const wrapped = row.map((cell, c) => wrapRows(cell, widths[c] as number))
    const height = Math.max(...wrapped.map((w) => w.length))
    return Array.from(
      { length: height },
      (_, l) =>
        `│ ${wrapped.map((w, c) => pad(w[l] ?? '', widths[c] as number, align[c])).join(' │ ')} │`,
    )
  }
  return [
    border('┌', '┬', '┐'),
    ...draw(head),
    ...rows.flatMap((row) => [border('├', '┼', '┤'), ...draw(row)]),
    border('└', '┴', '┘'),
  ]
}
