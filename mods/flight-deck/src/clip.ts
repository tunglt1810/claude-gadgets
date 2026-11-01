export const clipLines = (text: string, max: number): string => {
  const lines = text.split('\n')
  if (lines.length <= max) return text
  const hidden = lines.length - max
  return [...lines.slice(0, max), `... ${hidden} more line${hidden === 1 ? '' : 's'}`].join('\n')
}

export const cut = (text: string, columns: number): string => {
  if (columns <= 0) return ''
  const row = text.replace(/\s+/g, ' ').trim()
  return row.length <= columns ? row : `${row.slice(0, columns - 1)}…`
}
