// The engine's sentences for a call that auto mode did not judge (Claude Code 2.1.292).
const NO_VERDICT =
  /gave no verdict|was not reviewed:|auto mode could not evaluate|auto mode cannot determine the safety of|The API told auto mode's safety classifier/
// The engine's sentences for a call that the classifier judged. A judgment can quote a
// phrase of the other set, so it comes first: the denial stays.
const JUDGMENT =
  /denied by the Claude Code auto mode classifier|Permission for this action has been denied|judged this action dangerous/

export const isNoVerdict = (text: string): boolean => !JUDGMENT.test(text) && NO_VERDICT.test(text)

const MAX_DETAIL = 2000

// The user approves what the question shows, so it shows the whole input (`detail`, as
// JSON) or there is no question. JSON keeps a line break and a control character as written (`\n`), not drawn.
export const question = (tool: string, detail: string): string | undefined => {
  if (detail.length > MAX_DETAIL) return undefined
  return `Auto mode did not review this ${tool} call: ${detail}. Run it?`
}
