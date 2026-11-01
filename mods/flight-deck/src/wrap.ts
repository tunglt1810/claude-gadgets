const EMOJI_SELECTOR = 0xfe0f
// A code point that the terminal draws in the cell of the character before it: a combining
// mark, the joiner or a variation selector.
const isMark = (point: string): boolean => {
  const code = point.codePointAt(0) as number
  return /^\p{M}$/u.test(point) || code === 0x200d || code === 0xfe0e || code === EMOJI_SELECTOR
}
const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
] as const
const isWide = (point: string): boolean => {
  const code = point.codePointAt(0) as number
  return (
    /^\p{Emoji_Presentation}$/u.test(point) || WIDE_RANGES.some(([a, b]) => code >= a && code <= b)
  )
}
const PICTURE = /^\p{Extended_Pictographic}/u

const chars = (text: string): { text: string; width: number }[] => {
  const out: { text: string; width: number }[] = []
  for (const point of text) {
    const last = out[out.length - 1]
    if (last !== undefined && isMark(point)) {
      if (point.codePointAt(0) === EMOJI_SELECTOR && PICTURE.test(last.text)) last.width = 2
      last.text += point
      continue
    }
    out.push({ text: point, width: isWide(point) ? 2 : 1 })
  }
  return out
}

export const cellWidth = (text: string): number => chars(text).reduce((n, c) => n + c.width, 0)

export const wrapRows = (text: string, width: number): string[] => {
  const rows: string[] = []
  let row = ''
  let used = 0
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const cells = cellWidth(word)
    if (row !== '' && used + 1 + cells <= width) {
      row += ` ${word}`
      used += 1 + cells
      continue
    }
    if (row !== '') rows.push(row)
    row = ''
    used = 0
    for (const c of chars(word)) {
      if (row !== '' && used + c.width > width) {
        rows.push(row)
        row = ''
        used = 0
      }
      row += c.text
      used += c.width
    }
  }
  return [...rows, row]
}
