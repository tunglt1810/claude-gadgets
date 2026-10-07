import { type Engine, expect, type mock, test } from 'claude-code/testing'

const NO_VERDICT =
  'Auto mode classifier gave no verdict for Bash. You may try the action again once.'
const JUDGMENT =
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: it deletes data'
const CALL = { tool: 'Bash', command: 'git push', tool_use_id: 't1' } as const

// The engine beneath the plugin: each run of a call asks `tool.check` first, as core does.
// `ask` stands for a classifier that `verdict` answers; `answer` is the user's choice.
const engine = (
  $: Engine,
  on: Parameters<typeof mock.store>[0],
  answer: string | undefined,
  verdict: string = NO_VERDICT,
) => {
  const seen = {
    runs: 0,
    asks: [] as string[],
    options: [] as string[][],
    toasts: [] as string[],
    headers: [] as (string | undefined)[],
    session: 'S1',
    checks: 0,
    // A hook beneath the plugin that changes the command: by default it changes nothing.
    rewrite: (command: string, _check: number) => command,
    // The verdict beneath the plugin for each check: by default the mode's decider gets it.
    beneath: (_check: number): 'ask' | 'deny' | 'allow' => 'ask',
    verdict,
  }
  on('session.id', () => ({ value: seen.session }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.check', () => ({ decision: seen.beneath(seen.checks) }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      const { questions } = e as unknown as {
        questions: { question: string; header?: string; options: { label: string }[] }[]
      }
      const asked = questions[0]?.question ?? ''
      seen.asks.push(asked)
      seen.headers.push(questions[0]?.header)
      seen.options.push((questions[0]?.options ?? []).map((o) => o.label))
      if (answer === undefined) return { deny: 'dismissed' } as never
      return { result: { questions, answers: { [asked]: answer } } as never, text: answer }
    }
    const { decision } = await $.tool.check({
      tool: e.tool,
      input: { command: seen.rewrite(String(e.command), ++seen.checks) },
      tool_use_id: e.tool_use_id,
    })
    if (decision !== 'allow') return { result: {} as never, text: seen.verdict, isError: true }
    seen.runs++
    return { result: {} as never, text: 'ok' }
  })
  return seen
}

test('a call without a verdict runs when the user allows it', async ($, on) => {
  const seen = engine($, on, 'Run once')

  const res = await $.tool.call(CALL)

  expect(seen.asks).toEqual([
    'Auto mode did not review this Bash call: {"command":"git push"}. Run it?',
  ])
  expect(seen.runs).toBe(1)
  expect(res.text).toBe('ok')
})

test('the approval is for one call only', async ($, on) => {
  const seen = engine($, on, 'Run once')

  await $.tool.call(CALL)
  await $.tool.call({ ...CALL, tool_use_id: 't2' })

  expect(seen.asks).toHaveLength(2)
  expect(seen.runs).toBe(2)
})

test('a call that the user refuses does not run and the model is told to stop', async ($, on) => {
  const seen = engine($, on, 'Do not run')

  const res = await $.tool.call(CALL)

  expect(seen.runs).toBe(0)
  expect(res.deny).toContain('Do not issue it again')
})

test('a dismissed question keeps the denial of the engine', async ($, on) => {
  const seen = engine($, on, undefined)

  const res = await $.tool.call(CALL)

  expect(seen.runs).toBe(0)
  expect(res.text).toBe(NO_VERDICT)
})

test('a call too long to show whole keeps the denial of the engine', async ($, on) => {
  const seen = engine($, on, 'Run once')

  const res = await $.tool.call({ ...CALL, command: 'x'.repeat(5000) })

  expect(seen.asks).toHaveLength(0)
  expect(seen.runs).toBe(0)
  expect(res.text).toBe(NO_VERDICT)
})

test('a judgment of the classifier raises no question', async ($, on) => {
  const seen = engine($, on, 'Run once', JUDGMENT)

  const res = await $.tool.call(CALL)

  expect(seen.asks).toHaveLength(0)
  expect(res.text).toBe(JUDGMENT)
})

test('a tool error with the same words raises no question when no verdict was asked', async ($, on) => {
  const asks: string[] = []
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') asks.push('asked')
    return { result: {} as never, text: NO_VERDICT, isError: true }
  })

  await $.tool.call(CALL)

  expect(asks).toHaveLength(0)
})

const REMEMBER = 'Do not ask again: Bash(git push:*)'

test('the question offers the rule of the call between the two other answers', async ($, on) => {
  const seen = engine($, on, 'Run once')

  await $.tool.call(CALL)

  expect(seen.options).toEqual([['Run once', REMEMBER, 'Do not run']])
})

test('a call with no rule has only the two answers', async ($, on) => {
  const seen = engine($, on, 'Run once')

  await $.tool.call({ ...CALL, command: 'git status && git push' })

  expect(seen.options).toEqual([['Run once', 'Do not run']])
})

test('a remembered rule runs a later match with no question and shows a toast', async ($, on) => {
  const seen = engine($, on, REMEMBER)

  await $.tool.call(CALL)
  const res = await $.tool.call({ ...CALL, command: 'git push -f', tool_use_id: 't2' })

  expect(seen.asks).toHaveLength(1)
  expect(seen.runs).toBe(2)
  expect(res.text).toBe('ok')
  expect(seen.toasts).toEqual(['verdict-gate ran Bash(git push:*) with no review'])
})

test('a match longer than the limit of the question runs', async ($, on) => {
  const seen = engine($, on, REMEMBER)

  await $.tool.call(CALL)
  await $.tool.call({ ...CALL, command: `git push ${'x'.repeat(5000)}`, tool_use_id: 't2' })

  expect(seen.runs).toBe(2)
})

test('a compound command that starts as a rule gets a question', async ($, on) => {
  const seen = engine($, on, REMEMBER)

  await $.tool.call(CALL)
  await $.tool.call({ ...CALL, command: 'git push && rm -rf x', tool_use_id: 't2' })

  expect(seen.asks).toHaveLength(2)
})

test('a different session id has no rules', async ($, on) => {
  const seen = engine($, on, REMEMBER)

  await $.tool.call(CALL)
  seen.session = 'S2'
  await $.tool.call({ ...CALL, tool_use_id: 't2' })

  expect(seen.asks).toHaveLength(2)
})

test('the question has a chip that separates it from a question of the model', async ($, on) => {
  const seen = engine($, on, 'Run once')

  await $.tool.call(CALL)

  expect(seen.headers).toEqual(['No verdict'])
})

test('a remembered rule does not run a call that the classifier judged', async ($, on) => {
  const seen = engine($, on, REMEMBER)

  await $.tool.call(CALL)
  seen.verdict = JUDGMENT
  const res = await $.tool.call({ ...CALL, tool_use_id: 't2' })

  expect(seen.runs).toBe(1)
  expect(res.text).toBe(JUDGMENT)
  expect(seen.toasts).toHaveLength(0)
})

test('the question shows the input that the permission decision read', async ($, on) => {
  const seen = engine($, on, 'Run once')
  seen.rewrite = (command) => `${command} --force`

  await $.tool.call(CALL)

  expect(seen.asks[0]).toContain('{"command":"git push --force"}')
  expect(seen.runs).toBe(1)
})

test('an approval does not run an input that the question did not show', async ($, on) => {
  const seen = engine($, on, 'Run once')
  seen.rewrite = (command, check) => (check === 1 ? command : 'rm -rf x')

  const res = await $.tool.call(CALL)

  expect(seen.asks).toHaveLength(1)
  expect(seen.runs).toBe(0)
  expect(res.text).toBe(NO_VERDICT)
})

test('a rule does not run an input that changes after the match', async ($, on) => {
  const seen = engine($, on, REMEMBER)

  await $.tool.call(CALL)
  seen.rewrite = (command, check) => (check === 3 ? command : 'rm -rf x')
  await $.tool.call({ ...CALL, tool_use_id: 't2' })

  expect(seen.runs).toBe(1)
})

test('an approval does not run a call that a rule beneath now denies', async ($, on) => {
  const seen = engine($, on, 'Run once')
  seen.beneath = (check) => (check === 1 ? 'ask' : 'deny')

  await $.tool.call(CALL)

  expect(seen.asks).toHaveLength(1)
  expect(seen.runs).toBe(0)
})

test('calls at the same time get one question at a time, and a new rule answers the rest', async ($, on) => {
  const seen = engine($, on, REMEMBER)

  await Promise.all(['t1', 't2', 't3'].map((id) => $.tool.call({ ...CALL, tool_use_id: id })))

  expect(seen.asks).toHaveLength(1)
  expect(seen.runs).toBe(3)
})

test('a rule is not kept when its first call did not run', async ($, on) => {
  const seen = engine($, on, REMEMBER)
  seen.rewrite = (command, check) => (check === 2 ? 'rm -rf x' : command)

  await $.tool.call(CALL)
  await $.tool.call({ ...CALL, tool_use_id: 't2' })

  expect(seen.asks).toHaveLength(2)
})

test('a rejection of the user is not a denial without a verdict', async ($, on) => {
  const text = `The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said: it gave no verdict`
  const seen = engine($, on, 'Run once', text)

  const res = await $.tool.call(CALL)

  expect(seen.asks).toHaveLength(0)
  expect(res.text).toBe(text)
})
