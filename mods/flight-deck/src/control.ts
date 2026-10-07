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

// The name of the mod, as the engine gives it for an element and for the origin of a call.
export const PLUGIN = 'flight-deck'

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

// The cells of a field row that its text does not get: the label `›: ` before it and the
// hint ` ⏎ send` after it.
const FIELD_CHROME = 9

// The length of each row of `text`, wrapped at a space in rows of `width` cells. A word that
// is longer than a row fills rows.
const wrapped = (text: string, width: number): number[] => {
  const rows = [0]
  for (const word of text.split(' ').filter((w) => w !== '')) {
    let rest = word.length
    const last = rows[rows.length - 1] ?? 0
    if (last > 0 && last + 1 + rest <= width) {
      rows[rows.length - 1] = last + 1 + rest
      continue
    }
    if (last > 0) rows.push(0)
    while (rest > width) {
      rows[rows.length - 1] = width
      rows.push(0)
      rest -= width
    }
    rows[rows.length - 1] = rest
  }
  return rows
}

// The most cells that the label of a field grows by.
const MAX_PAD = 3

// How the terminal draws a focused message field in a box of `columns` cells: the rows of
// its text, and the cells that its label grows by (`pad`). The engine gives no height of an
// Input: a live session gave these rules. The text wraps at a space, in rows of
// `columns - 9` cells. When the first row fills that width, the terminal draws the whole
// field in one row, cut with `…`, and the person does not see the rows below. A longer
// label makes the rows shorter: the label grows until the first row does not fill its
// width. Padding around the field does not change the width that the engine wraps at.
// The header of a transcript keeps `rows` rows for the field, so the field is not drawn on
// the rows below it.
export const fieldLayout = (text: string, columns: number): { rows: number; pad: number } => {
  for (let pad = 0; pad <= MAX_PAD; pad++) {
    const width = columns - FIELD_CHROME - pad
    if (width < 1) break
    const rows = wrapped(text, width)
    if (rows[0] !== width) return { rows: rows.length, pad }
  }
  // A box with no room, or a first row that fills each width: the terminal cuts the field.
  return { rows: 1, pad: 0 }
}
