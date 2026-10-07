// A character that joins commands, redirects or substitutes: a command with one is not
// simple, and a prefix says nothing about what it runs.
const NOT_SIMPLE = /[;&|<>$`(){}\\\n\r]/
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/

// The rule of a call: the question offers it, and a later call with the same rule matches.
// For Bash it is the command and its subcommand (`git push`). A command with no
// subcommand (`rm -rf x`, `bash -c "..."`) has none: one word says too little about what
// runs. For each other tool it is the tool name.
export const ruleOf = (tool: string, args: Record<string, unknown>): string | undefined => {
  if (tool !== 'Bash') return tool
  const { command } = args
  if (typeof command !== 'string' || NOT_SIMPLE.test(command)) return undefined
  const [first, second] = command.trim().split(/\s+/)
  if (first === undefined || first.includes('=')) return undefined
  if (second === undefined || !SUBCOMMAND.test(second)) return undefined
  return `Bash(${first} ${second}:*)`
}
