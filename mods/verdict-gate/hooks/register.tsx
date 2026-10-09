import type { Args, EngineInterface, Next, Register } from 'claude-code'
import { ruleOf } from '../src/rule'
import { isNoVerdict, question } from '../src/verdict'

const RUN = 'Run once'
const REFUSE = 'Do not run'
const REMEMBER = 'Do not ask again: '
// The chip of the question: 12 characters at most.
const HEADER = 'No verdict'

// A call whose verdict the engine left to the mode's decider: the input that `tool.check`
// read, as JSON, and its rule. A hook beneath can change a call, so this is the input that
// would run, not always the one `tool.call` got.
type Asked = { detail: string; rule: string | undefined }

// The asked calls and the approved inputs, keyed by `tool_use_id`. An entry lives for one
// `tool.call`. A check whose `tool.call` does not pass this plugin leaves its entry, so
// the map has a limit and drops its oldest entry.
const asked = new Map<string, Asked>()
const approved = new Map<string, string>()
const MAX_ASKED = 256

// The end of the question before this one: calls at the same time get one question at a
// time, so a rule from one answer settles the next.
let turn: Promise<void> = Promise.resolve()

const json = (input: unknown): string => JSON.stringify(input) ?? ''

const isUnjudged = (res: { deny?: string; isError?: boolean; text?: string }): boolean =>
  isNoVerdict(res.deny ?? (res.isError ? res.text : undefined) ?? '')

// The rules the user approved, for one session id: a different id starts with none.
let session: string | undefined
let rules = new Set<string>()

async function sessionRules($: EngineInterface) {
  const id = await $.session.id()
  if (id !== session) {
    session = id
    rules = new Set()
  }
  return rules
}

async function check(_$: EngineInterface, e: Args<'tool.check'>, next: Next<'tool.check'>) {
  const id = e.tool_use_id
  if (id === undefined) return next(e)
  // The verdict beneath comes first: an approval changes an `ask`, never a `deny`.
  const verdict = await next(e)
  if (verdict.decision !== 'ask') return verdict
  const detail = json(e.input)
  // An approval is for the input that the question showed, not for the `tool_use_id`.
  if (approved.get(id) === detail)
    return { decision: 'allow' as const, reason: 'The user approved this call.' }
  if (approved.has(id)) return verdict
  asked.set(id, { detail, rule: ruleOf(e.tool, e.input) })
  const oldest = asked.keys().next().value
  if (asked.size > MAX_ASKED && oldest !== undefined) asked.delete(oldest)
  return verdict
}

// The engine raises one of these two events when a tool ran, before `tool.call` has its
// answer. A call that ran did not wait for a verdict, whatever its output says.
async function ran(
  _$: EngineInterface,
  e: Args<'classic.PostToolUse'>,
  next: Next<'classic.PostToolUse'>,
) {
  asked.delete(e.tool_use_id)
  return next(e)
}

async function failed(
  _$: EngineInterface,
  e: Args<'classic.PostToolUseFailure'>,
  next: Next<'classic.PostToolUseFailure'>,
) {
  asked.delete(e.tool_use_id)
  return next(e)
}

async function gate($: EngineInterface, e: Args<'tool.call'>, next: Next<'tool.call'>) {
  const id = e.tool_use_id
  try {
    const res = await next(e)
    // A tool that ran can print the same words: only a call that still waits for a verdict
    // counts (`ran` and `failed` remove the others).
    const call = asked.get(id)
    if (call === undefined || !isUnjudged(res)) return res
    const { detail, rule } = call
    const prior = turn
    let release = () => {}
    turn = new Promise((done) => {
      release = done
    })
    await prior
    let added: Set<string> | undefined
    try {
      const known = await sessionRules($)
      if (rule !== undefined && known.has(rule)) $.ui.toast(`Ran ${rule} with no review`)
      else {
        const text = question(e.tool, detail)
        if (text === undefined) return res
        const offer = rule === undefined ? undefined : REMEMBER + rule
        const options = offer === undefined ? [RUN, REFUSE] : [RUN, offer, REFUSE]
        // A dismissed question, or a run with no user, keeps the engine's denial.
        const answer = await $.ui.ask(text, { options, header: HEADER }).catch(() => undefined)
        if (answer === REFUSE) return { deny: 'The user refused this call. Do not issue it again.' }
        if (rule !== undefined && answer === offer) added = known.add(rule)
        else if (answer !== RUN) return res
      }
    } finally {
      release()
    }
    approved.set(id, detail)
    const again = await next(e)
    // A new rule stays only when its first call got past the check.
    if (added !== undefined && rule !== undefined && asked.has(id) && isUnjudged(again))
      added.delete(rule)
    return again
  } finally {
    asked.delete(id)
    approved.delete(id)
  }
}

export const register: Register = (on) => {
  on('tool.check', check)
  on('tool.call', gate)
  on('classic.PostToolUse', ran)
  on('classic.PostToolUseFailure', failed)
}
