import type { Args, EngineInterface, Next, Register } from 'claude-code'
import { ruleOf } from '../src/rule'
import { isNoVerdict, question } from '../src/verdict'

const RUN = 'Run once'
const REFUSE = 'Do not run'
const REMEMBER = 'Do not ask again: '
// The chip of the question: 12 characters at most.
const HEADER = 'No verdict'

// Calls whose verdict the engine left to the mode's decider, and calls the user approved.
// Both are keyed by `tool_use_id` and live for one `tool.call`.
const asked = new Set<string>()
const approved = new Set<string>()

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
  if (approved.has(id))
    return { decision: 'allow' as const, reason: 'The user approved this call.' }
  const verdict = await next(e)
  if (verdict.decision === 'ask') asked.add(id)
  return verdict
}

async function gate($: EngineInterface, e: Args<'tool.call'>, next: Next<'tool.call'>) {
  const id = e.tool_use_id
  try {
    const res = await next(e)
    const denial = res.deny ?? (res.isError ? res.text : undefined)
    // A tool that ran can print the same words: only a call that waited for a verdict counts.
    if (denial === undefined || !asked.has(id) || !isNoVerdict(denial)) return res
    const { tool, tool_use_id: _id, ...args } = e
    const known = await sessionRules($)
    const rule = ruleOf(tool, args)
    if (rule === undefined || !known.has(rule)) {
      const text = question(tool, args)
      if (text === undefined) return res
      const offer = rule === undefined ? undefined : REMEMBER + rule
      const options = offer === undefined ? [RUN, REFUSE] : [RUN, offer, REFUSE]
      // A dismissed question, or a run with no user, keeps the engine's denial.
      const answer = await $.ui.ask(text, { options, header: HEADER }).catch(() => undefined)
      if (answer === REFUSE) return { deny: 'The user refused this call. Do not issue it again.' }
      if (rule !== undefined && answer === offer) known.add(rule)
      else if (answer !== RUN) return res
    } else $.ui.toast(`verdict-gate ran ${rule} with no review`)
    approved.add(id)
    return await next(e)
  } finally {
    asked.delete(id)
    approved.delete(id)
  }
}

export const register: Register = (on) => {
  on('tool.check', check)
  on('tool.call', gate)
}
