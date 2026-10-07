// A character that joins commands, redirects or substitutes: a command with one is not
// simple, and a prefix says nothing about what it runs.
const NOT_SIMPLE = /[;&|<>$`(){}\\]/
// The shell parts words at a space. A tab, a line break or a character that is not ASCII
// can look like a space and is not one, so a command with one has no rule.
const PRINTABLE = /^[\x20-\x7e]*$/
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/
// A first word that runs its arguments as a different command: a prefix with one names
// the wrapper, not what runs. The list is the common ones, not all of them.
const WRAPPERS = new Set(
  'sudo doas env command exec eval nohup time timeout nice ionice xargs watch ssh sh bash zsh dash ksh fish npx bunx pnpx uvx'.split(
    ' ',
  ),
)

// The rule of a call: the question offers it, and a later call with the same rule matches.
// For Bash it is the command and its subcommand (`git push`). A command with no
// subcommand (`rm -rf x`, `bash -c "..."`) has none: one word says too little about what
// runs. For each other tool it is the tool name.
export const ruleOf = (tool: string, input: unknown): string | undefined => {
  if (tool !== 'Bash') return tool
  const command = (input as { command?: unknown } | null | undefined)?.command
  if (typeof command !== 'string') return undefined
  if (!PRINTABLE.test(command) || NOT_SIMPLE.test(command)) return undefined
  const [first, second] = command.split(' ').filter((word) => word !== '')
  if (first === undefined || first.includes('=')) return undefined
  if (WRAPPERS.has(first.slice(first.lastIndexOf('/') + 1))) return undefined
  if (second === undefined || !SUBCOMMAND.test(second)) return undefined
  return `Bash(${first} ${second}:*)`
}
