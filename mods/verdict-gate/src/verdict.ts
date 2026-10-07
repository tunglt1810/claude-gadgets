// The words of the engine's denial texts for a call that auto mode did not judge
// (Claude Code 2.1.292). A judgment of the classifier has none of them.
const NO_VERDICT =
  /gave no verdict|auto mode classifier|auto mode's safety classifier|auto mode could not evaluate|auto mode cannot determine/

export const isNoVerdict = (text: string): boolean => NO_VERDICT.test(text)

const MAX_DETAIL = 2000

// The user approves what the question shows, so it shows the whole call or there is no
// question. JSON keeps a line break and a control character as written (`\n`), not drawn.
export const question = (tool: string, args: Record<string, unknown>): string | undefined => {
  const detail = JSON.stringify(args)
  if (detail.length > MAX_DETAIL) return undefined
  return `Auto mode did not review this ${tool} call: ${detail}. Run it?`
}
