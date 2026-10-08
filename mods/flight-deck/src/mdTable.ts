// A part of a markdown text: a table, with its cells as plain text, or the markdown between
// two tables.
export type MdPart =
  | { kind: 'md'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }

// The rule below the head of a table: `|---|:--:|`.
const RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const FENCE = /^\s*(```|~~~)/

// The cells of a table row as plain text: the marks of bold and of code go, and a link is its
// label.
const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) =>
      c
        .replace(/\\\|/g, '|')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|`/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )

// The tables of a markdown text, apart from the markdown around them. The engine sizes a
// table of a `Markdown` to a width that is not the pane's: the pane draws a table itself.
export const mdParts = (text: string): MdPart[] => {
  const lines = text.split('\n')
  const parts: MdPart[] = []
  let md: string[] = []
  let isFenced = false
  const flush = () => {
    if (md.length > 0) parts.push({ kind: 'md', text: md.join('\n') })
    md = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (FENCE.test(line)) isFenced = !isFenced
    const rule = lines[i + 1]
    if (
      isFenced ||
      !line.includes('|') ||
      rule === undefined ||
      !RULE.test(rule) ||
      !rule.includes('-')
    ) {
      md.push(line)
      continue
    }
    const head = cells(line)
    const rows: string[][] = []
    i += 2
    for (; i < lines.length && (lines[i] as string).includes('|'); i++) {
      const row = cells(lines[i] as string)
      rows.push(head.map((_, c) => row[c] ?? ''))
    }
    i--
    flush()
    parts.push({ kind: 'table', head, rows })
  }
  flush()
  return parts
}

// The rows of `text` at `width` cells: a row breaks between two words, and a word longer than
// a row is cut.
const wrap = (text: string, width: number): string[] => {
  const rows: string[] = []
  let row = ''
  for (let word of text.split(' ')) {
    if (row !== '' && row.length + 1 + word.length <= width) {
      row += ` ${word}`
      continue
    }
    if (row !== '') rows.push(row)
    for (; word.length > width; word = word.slice(width)) rows.push(word.slice(0, width))
    row = word
  }
  return [...rows, row]
}

const longestWord = (text: string) => Math.max(0, ...text.split(' ').map((w) => w.length))

// The rows of a table in `columns` cells, as the main transcript draws one: each column as
// wide as its longest cell when the table fits; narrower columns with wrapped cells when it
// does not; and each row as a list of `head: cell` when the longest words do not fit.
export const tableLines = (head: string[], rows: string[][], columns: number): string[] => {
  const all = [head, ...rows]
  const col = (f: (cell: string) => number) =>
    head.map((_, c) => Math.max(1, ...all.map((r) => f(r[c] ?? ''))))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const full = col((cell) => cell.length)
  const least = col(longestWord)
  // A bar and two spaces for each column, and the last bar.
  const room = columns - (3 * head.length + 1)

  if (sum(least) > room) {
    const rule = '─'.repeat(Math.max(0, columns))
    return rows.flatMap((row, r) => [
      ...(r === 0 ? [] : [rule]),
      ...row.flatMap((cell, c) => wrap(`${head[c]}: ${cell}`, Math.max(1, columns))),
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
    const wrapped = row.map((cell, c) => wrap(cell, widths[c] as number))
    const height = Math.max(...wrapped.map((w) => w.length))
    return Array.from(
      { length: height },
      (_, l) =>
        `│ ${wrapped.map((w, c) => (w[l] ?? '').padEnd(widths[c] as number)).join(' │ ')} │`,
    )
  }
  return [
    border('┌', '┬', '┐'),
    ...draw(head),
    ...rows.flatMap((row) => [border('├', '┼', '┤'), ...draw(row)]),
    border('└', '┴', '┘'),
  ]
}
