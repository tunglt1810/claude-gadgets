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

// Auto mode gives no verdict for a message that a plugin sends: the reason says so, and the
// pane then asks the person. A message that the classifier refused was judged.
export const isNoVerdict = (reason: string | undefined): boolean =>
  reason !== undefined && /classifier gave no verdict/i.test(reason)

// Whether the engine asks for a call by its mode only: an ask that a rule of the settings, a
// classic hook or a ceiling of the organization gave is the decision of a person.
export const isOpenAsk = (verdict: {
  decision: string
  rule?: string
  hook?: string
  ceiling?: string
}): boolean =>
  verdict.decision === 'ask' &&
  verdict.rule === undefined &&
  verdict.hook === undefined &&
  verdict.ceiling === undefined

const PLUGIN = 'flight-deck'

// Whether a SendMessage call is a message of the pane: the mod made the call (`plugin`, the
// origin of the dispatch), from the main loop, to an agent of `sending`. A call of the model
// has the engine as its origin.
export const isPaneSend = (
  call: { plugin: string; agentId?: string; input: unknown },
  sending: ReadonlySet<string>,
): boolean => {
  const { input } = call
  const to = typeof input === 'object' && input !== null && 'to' in input ? input.to : null
  return (
    call.plugin === PLUGIN &&
    call.agentId === undefined &&
    typeof to === 'string' &&
    sending.has(to)
  )
}

// The button that lets the messages of the pane go in auto mode.
export const ALLOW_LABEL = 'allow messages in auto mode'

// The row below a message field when the engine did not send the message. With the answer of
// the person and still no verdict, an allow rule for the tool lets the message through.
export const sendFailure = (reason: string | undefined): string => {
  if (reason === undefined || reason === '') return 'not sent'
  if (isNoVerdict(reason)) return 'not sent: add "SendMessage" to permissions.allow'
  return `not sent: ${reason.split('\n')[0]}`
}
