// The engine's sentences for a call that auto mode did not judge (Claude Code 2.1.292).
const NO_VERDICT =
  /gave no verdict|was not reviewed:|auto mode could not evaluate|auto mode cannot determine the safety of|The API told auto mode's safety classifier/
// The engine's sentences for a call that the classifier judged. A judgment can quote a
// phrase of the other set, so it comes first: the denial stays.
const JUDGMENT =
  /denied by the Claude Code auto mode classifier|Permission for this action has been denied|judged this action dangerous/
// The engine's sentences for a call that the user rejected in the permission dialog.
const REJECTION = /The user doesn't want to (proceed with this tool use|take this action)/

export const isNoVerdict = (text: string): boolean =>
  !JUDGMENT.test(text) && !REJECTION.test(text) && NO_VERDICT.test(text)

const MAX_DETAIL = 2000

// A control, a format (bidi, zero width) or a space character that is not the ASCII space:
// a terminal hides it, obeys it or draws it as a space.
const HIDDEN = /[\p{C}\p{Z}]/gu

const visible = (text: string): string =>
  text.replace(HIDDEN, (c) => (c === ' ' ? c : `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`))

// The user approves what the question shows, so it shows the whole input (`detail`, as
// JSON) or there is no question. JSON shows a line break as written (`\n`), and each
// other hidden character shows as its code point.
export const question = (tool: string, detail: string): string | undefined => {
  const shown = visible(detail)
  if (shown.length > MAX_DETAIL) return undefined
  return `Auto mode did not review this ${tool} call: ${shown}. Run it?`
}
