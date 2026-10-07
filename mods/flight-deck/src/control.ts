// The least room of a control row that draws its buttons with words: two real buttons of the
// terminal, `[ » message ]` and `[ ■ stop? ]`, with one cell between them.
const WIDE = 25

// The labels of an agent's control buttons: words in a wide row, icons in a narrow one. A
// stop button that waits for its second press ends with `?`.
export const controlLabels = (room: number, isAsked: boolean): { message: string; stop: string } =>
  room >= WIDE
    ? { message: '» message', stop: isAsked ? '■ stop?' : '■ stop' }
    : { message: '»', stop: isAsked ? '■?' : '■' }

// The row below the controls when the engine did not stop the agent.
export const stopFailure = (reason: string | undefined): string =>
  reason === undefined || reason === '' ? 'not stopped' : `not stopped: ${reason.split('\n')[0]}`

// The row below a message field when the engine did not send the message. Auto mode gives no
// verdict for a message that a plugin sends: an allow rule for the tool lets it through.
export const sendFailure = (reason: string | undefined): string => {
  if (reason === undefined || reason === '') return 'not sent'
  if (/classifier/i.test(reason)) return 'not sent: add "SendMessage" to permissions.allow'
  return `not sent: ${reason.split('\n')[0]}`
}
