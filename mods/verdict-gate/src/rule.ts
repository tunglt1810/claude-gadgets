// A character that joins commands, redirects or substitutes: a command with one is not
// simple, and a prefix says nothing about what it runs.
const NOT_SIMPLE = /[;&|<>$`(){}\\\n\r]/
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/

// The words of a simple Bash command; none for each other command.
const words = (args: Record<string, unknown>): string[] => {
  const { command } = args
  if (typeof command !== 'string' || NOT_SIMPLE.test(command)) return []
  const all = command.trim().split(/\s+/)
  return all[0] === undefined || all[0] === '' || all[0].includes('=') ? [] : all
}

const bashRule = (prefix: string): string => `Bash(${prefix}:*)`

// The rule that the question offers for a call: the command prefix for Bash, the tool
// name for each other tool.
export const ruleOf = (tool: string, args: Record<string, unknown>): string | undefined => {
  if (tool !== 'Bash') return tool
  const [first, second] = words(args)
  if (first === undefined) return undefined
  return bashRule(second !== undefined && SUBCOMMAND.test(second) ? `${first} ${second}` : first)
}

// Each rule that a call matches: a Bash rule matches a simple command that is its prefix,
// or that starts with its prefix and a space.
export const rulesFor = (tool: string, args: Record<string, unknown>): string[] => {
  if (tool !== 'Bash') return [tool]
  const [first, second] = words(args)
  if (first === undefined) return []
  return second === undefined
    ? [bashRule(first)]
    : [bashRule(first), bashRule(`${first} ${second}`)]
}
