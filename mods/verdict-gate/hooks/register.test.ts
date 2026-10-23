import { type Engine, expect, type mock, test } from 'claude-code/testing'

const NO_VERDICT =
  'Auto mode classifier gave no verdict for Bash. You may try the action again once.'
const JUDGMENT =
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: it deletes data'
const CALL = { tool: 'Bash', command: 'git push', tool_use_id: 't1' } as const

// The engine beneath the plugin. The test engine runs `classic.PreToolUse` and `tool.check`
// before each run of a call, as core does, and settles an `ask` with
// `classic.PermissionRequest`: it stands for a classifier that `verdict` answers. `answer` is
// the user's choice.
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
    // What the tool answers when it runs.
    output: { result: {}, text: 'ok' } as { result: object; text: string; isError?: true },
    checks: 0,
    // A hook beneath the plugin that changes the command: by default it changes nothing.
    rewrite: (command: string, _check: number) => command,
    // The verdict beneath the plugin for each check: by default the mode's decider gets it.
    beneath: (_check: number): 'ask' | 'deny' | 'allow' => 'ask',
    verdict,
    // Where the session draws, and what the pane did.
    surfaces: ['terminal'] as string[],
    isPlaced: true,
    opens: [] as { id: string; title: string; closeOnEscape?: boolean }[],
    closes: [] as string[],
    // Runs while the question is open.
    onAsk: async () => {},
  }
  on('session.id', () => ({ value: seen.session }))
  on('session.surfaces', () => ({ value: seen.surfaces }) as never)
  on('ui.open', (_$, e) => {
    seen.opens.push({ id: e.id, title: String(e.title), closeOnEscape: e.closeOnEscape })
    return { value: { isPlaced: seen.isPlaced } } as never
  })
  on('ui.close', (_$, e) => {
    seen.closes.push(e.id)
    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  // A hook beneath the plugin's `tool.call` that changes the command before the check.
  on('classic.PreToolUse', (_$, e) =>
    e.tool === 'AskUserQuestion'
      ? ({} as never)
      : ({ updatedInput: { command: seen.rewrite(String(e.command), ++seen.checks) } } as never),
  )
  // The question of the plugin is the dialog itself: no verdict holds it back.
  on('tool.check', (_$, e) => ({
    decision: e.tool === 'AskUserQuestion' ? 'allow' : seen.beneath(seen.checks),
  }))
  on(
    'classic.PermissionRequest',
    () => ({ decision: { behavior: 'deny', message: seen.verdict } }) as never,
  )
  on('classic.PostToolUse', () => ({}))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      const { questions } = e as unknown as {
        questions: { question: string; header?: string; options: { label: string }[] }[]
      }
      const asked = questions[0]?.question ?? ''
      seen.asks.push(asked)
      seen.headers.push(questions[0]?.header)
      seen.options.push((questions[0]?.options ?? []).map((o) => o.label))
      await seen.onAsk()
      if (answer === undefined) return { deny: 'dismissed' } as never
      return { result: { questions, answers: { [asked]: answer } } as never, text: answer }
    }
    // The checks allowed the call: the tool runs.
    seen.runs++
    // The engine raises this event when a tool ran, before `tool.call` has its answer.
    await $.classic.PostToolUse({
      tool_name: e.tool,
      tool_input: {},
      tool_response: {},
      tool_use_id: e.tool_use_id,
    } as never)
    return seen.output as never
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

test('a call too long to show whole keeps the denial of the engine and says so', async ($, on) => {
  const seen = engine($, on, 'Run once')

  const res = await $.tool.call({ ...CALL, command: 'x'.repeat(2000) })

  expect(seen.asks).toHaveLength(0)
  expect(seen.runs).toBe(0)
  expect(res.text).toBe(NO_VERDICT)
  expect(seen.toasts).toEqual(['verdict-gate: input too long to show (2,014 characters)'])
})

const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'verdict-gate',
    surface,
    component: 'Pane',
    requestId: 'verdict',
    props: {
      title: 'x',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    } as never,
  })

const LONG = 'x'.repeat(15_000)

test('on a desktop the whole input is in a pane, beside a short question', async ($, on) => {
  const seen = engine($, on, 'Run once')
  seen.surfaces = ['desktop']
  let drawn = ''
  seen.onAsk = async () => {
    const ui = await mountPane($, 'desktop')
    drawn = String((await ui.find({ type: 'Code' }))?.props.source)
    await ui.unmount()
  }

  const res = await $.tool.call({ ...CALL, command: LONG })

  expect(seen.opens).toEqual([
    { id: 'verdict', title: 'No verdict: Bash input', closeOnEscape: true },
  ])
  expect(drawn).toBe(`{\n  "command": "${LONG}"\n}`)
  expect(seen.asks).toEqual([
    'Auto mode did not review this Bash call (15,014 characters, full input in the pane). Run it?',
  ])
  expect(seen.closes).toEqual(['verdict'])
  expect(seen.runs).toBe(1)
  expect(res.text).toBe('ok')
})

test('the pane closes when the question is dismissed', async ($, on) => {
  const seen = engine($, on, undefined)
  seen.surfaces = ['terminal', 'desktop']

  await $.tool.call(CALL)

  expect(seen.opens).toHaveLength(1)
  expect(seen.closes).toEqual(['verdict'])
  expect(seen.runs).toBe(0)
})

test('a pane that is not placed leaves the whole input in the question', async ($, on) => {
  const seen = engine($, on, 'Run once')
  seen.surfaces = ['desktop']
  seen.isPlaced = false

  await $.tool.call(CALL)
  await $.tool.call({ ...CALL, command: LONG, tool_use_id: 't2' })

  expect(seen.asks).toEqual([
    'Auto mode did not review this Bash call: {"command":"git push"}. Run it?',
  ])
  expect(seen.runs).toBe(1)
})

test('a terminal with no desktop opens no pane', async ($, on) => {
  const seen = engine($, on, 'Run once')

  await $.tool.call(CALL)

  expect(seen.opens).toHaveLength(0)
  expect(seen.closes).toHaveLength(0)
})

test('the Close button of the pane closes only the pane', async ($, on) => {
  const seen = engine($, on, 'Run once')
  seen.surfaces = ['desktop']
  for (const surface of ['terminal', 'desktop'] as const) {
    seen.onAsk = async () => {
      const ui = await mountPane($, surface)
      expect((await ui.find({ key: 'close' }))?.props.label).toBe('Close')
      await ui.press({ key: 'close' })
      await ui.unmount()
    }
    seen.closes = []

    await $.tool.call({ ...CALL, tool_use_id: surface })

    // The question still decides: the call runs.
    expect(seen.closes).toEqual(['verdict', 'verdict'])
  }
  expect(seen.runs).toBe(2)
})

test('a pane that an earlier load left open closes at the start of a session', async ($, on) => {
  const seen = engine($, on, 'Run once')
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(seen.closes).toEqual(['verdict'])
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
  expect(seen.toasts).toEqual(['Ran Bash(git push:*) with no review'])
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

test('a tool that the classifier let run, and that failed with the same words, raises no question', async ($, on) => {
  const asks: string[] = []
  let runs = 0
  on('classic.PostToolUseFailure', () => ({}))
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }) as never)
  on('tool.call', async (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      asks.push('asked')
      return { deny: 'dismissed' } as never
    }
    runs++
    await $.classic.PostToolUseFailure({
      tool_name: e.tool,
      tool_input: {},
      tool_use_id: e.tool_use_id,
      error: NO_VERDICT,
    } as never)
    return { result: {} as never, text: NO_VERDICT, isError: true }
  })

  await $.tool.call(CALL)

  expect(asks).toHaveLength(0)
  expect(runs).toBe(1)
})

test('a rule stays when its first call ran and failed with the same words', async ($, on) => {
  const seen = engine($, on, REMEMBER)
  seen.output = { result: {}, text: NO_VERDICT, isError: true }

  await $.tool.call(CALL)
  await $.tool.call({ ...CALL, tool_use_id: 't2' })

  expect(seen.asks).toHaveLength(1)
  expect(seen.runs).toBe(2)
})
