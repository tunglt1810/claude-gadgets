// The row of the patterns that came after the list was full.
export const OTHER = '(other)'

// The most patterns a session keeps, `OTHER` included: a meter is stored on each change.
export const MAX_PATTERNS = 100

// A command with a character that is not printable ASCII (a tab and a line break aside) has no
// pattern: it can look like another command.
const PRINTABLE = /^[\x20-\x7e\t\n]*$/
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// A first word that runs the words after it: the pattern is the command it runs. Its own flags,
// numbers and assignments are left out with it (`timeout 5`, `env A=1`, `rtk proxy`).
const WRAPPERS = new Set(
  'rtk proxy sudo doas env command exec nohup time timeout nice ionice npx bunx pnpx uvx'.split(
    ' ',
  ),
)
// The commands whose second word names what they do (`git status`). For any other command the
// second word is an argument: a file or a search, not part of the pattern.
const WITH_SUBCOMMAND = new Set(
  'git gh bun npm pnpm yarn cargo go docker kubectl claude brew pip uv deno rustup terraform helm aws gcloud make'.split(
    ' ',
  ),
)

// The simple commands of a command line, each as its words, quotes kept. A separator inside
// quotes or inside `$(...)` does not split; a substitution is one word. A heredoc body is not
// a command: the line ends the parse.
const commands = (line: string): string[][] => {
  const out: string[][] = [[]]
  let word = ''
  let quote: '"' | "'" | null = null
  let depth = 0
  let isHeredoc = false
  const endWord = () => {
    if (word !== '') out[out.length - 1]?.push(word)
    word = ''
  }
  const endCommand = () => {
    endWord()
    out.push([])
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    const next = line[i + 1]
    if (quote !== null) {
      word += c
      if (c === '\\' && quote === '"' && next !== undefined) word += line[++i]
      else if (c === quote) quote = null
      continue
    }
    if (depth > 0) {
      word += c
      if (c === '(') depth++
      else if (c === ')') depth--
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      word += c
    } else if (c === '$' && next === '(') {
      depth = 1
      word += '$('
      i++
    } else if (c === '\\' && next !== undefined) {
      word += c + line[++i]
    } else if (c === '\n') {
      if (isHeredoc) break
      endCommand()
    } else if (c === ';' || c === '|') {
      if (next === c) i++
      endCommand()
    } else if (c === '&') {
      // `2>&1` is a redirection, not a separator.
      if (word.endsWith('>') || word.endsWith('<')) word += c
      else {
        if (next === '&') i++
        endCommand()
      }
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else {
      if (c === '<' && next === '<') isHeredoc = true
      word += c
    }
  }
  endWord()
  return out.filter((w) => w.length > 0)
}

// The pattern of one simple command, or none: `cd` and a bare assignment are not a command,
// and a first word that is not a plain name (`"$D"`) says nothing.
const patternOf = (words: readonly string[]): string | undefined => {
  let i = 0
  while (i < words.length) {
    const w = words[i] as string
    const base = w.slice(w.lastIndexOf('/') + 1)
    if (ASSIGNMENT.test(w)) i++
    else if (WRAPPERS.has(base)) {
      i++
      while (i < words.length && /^(-|\d+$)/.test(words[i] as string)) i++
    } else break
  }
  const first = words[i]
  if (first === undefined) return undefined
  const name = first.slice(first.lastIndexOf('/') + 1)
  if (!NAME.test(name) || name === 'cd') return undefined
  const second = words[i + 1]
  return WITH_SUBCOMMAND.has(name) && second !== undefined && SUBCOMMAND.test(second)
    ? `${name} ${second}`
    : name
}

// The patterns of a Bash command, one for each simple command in it, in order.
export const bashPatterns = (command: string): string[] =>
  PRINTABLE.test(command)
    ? commands(command).flatMap((words) => {
        const p = patternOf(words)
        return p === undefined ? [] : [p]
      })
    : []

// The counts with one call's patterns added. Once the list holds `limit` patterns, a new one
// is counted under `OTHER`.
export const countPatterns = (
  counts: Readonly<Record<string, number>>,
  patterns: readonly string[],
  limit = MAX_PATTERNS,
): Record<string, number> => {
  const next = { ...counts }
  for (const p of patterns) {
    const key = p in next || Object.keys(next).length < limit ? p : OTHER
    next[key] = (next[key] ?? 0) + 1
  }
  return next
}
