import { type Engine, expect, mock, test } from 'claude-code/testing'
import { cellText } from '../src/cell'
import type { Cell } from '../types'

const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 80,
  cache_creation_input_tokens: 10,
  model: 'm',
}
const STEP = { turnId: 't1', index: 0, model: 'm', messageCount: 1 }
const DONE = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const

const stepResult = (usage: typeof USAGE | null) => ({
  turnId: 't1',
  index: 0,
  answer: '',
  toolUses: [] as never[],
  stopReason: 'end_turn' as const,
  usage,
})

// The engine's bottom answer for a streaming step: no chunks, just the result.
const stepHook = (usage: typeof USAGE | null) =>
  async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield* [] as never[]
    return { ...stepResult(usage), turnId: e.turnId, index: e.index }
  }

// `turn.step` streams: the plugin's hook only runs once the stream is read to its end.
const runStep = async ($: Engine, input: typeof STEP & { agentId?: string }) => {
  const stream = $.turn.step(input)
  for await (const _chunk of stream) {
    // chunks are not under test
  }
  return stream.result
}

// State is observed only through what the band draws, on the given surface.
const bandText = async (
  $: Engine,
  surface: 'terminal' | 'desktop' = 'terminal',
  agentId?: string,
) => {
  const ui = await $.ui.mount({
    plugin: 'flight-deck',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 200, view: { agentId } } as never,
  })
  // The band is the row's top-level Texts (nested ones repeat their text) with the agents
  // button between them; in an agent view there is one Text and no button.
  const runs = (await ui.findAll({ type: 'Text' })).filter((t) => t.props.wrap === 'truncate')
  const button = await ui.find({ type: 'Button' })
  await ui.unmount()
  const label = button === undefined ? [] : [String(button.props.label)]
  return [runs[0]?.text ?? '', ...label, runs[1]?.text ?? ''].join('')
}

// A changed count runs to its new value over a short time: let it arrive, then read.
const SETTLE_MS = 500
const settled = async (
  $: Engine,
  clock: ReturnType<typeof mock.clock>,
  surface: 'terminal' | 'desktop' = 'terminal',
) => {
  await clock.advance(SETTLE_MS)
  return bandText($, surface)
}

// Answers for the events beneath the plugin, so each test only states what differs.
const engine = (
  on: Parameters<typeof mock.store>[0],
  id: () => string = () => 'S1',
  toolResult: (e?: unknown) => object = () => ({ result: {} as never, text: 'ok' }),
  isSpawnRefused: () => boolean = () => false,
  settings: () => object = () => ({}),
  env: Record<string, string> = {},
  usage: () => object = () => ({}),
) => {
  mock.env(on, env)
  on(
    'session.usage',
    () => ({ value: { startedAt: 0, context: {}, rateLimits: [], ...usage() } }) as never,
  )
  on('session.id', () => ({ value: id() }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('tool.call', (_$, e) => toolResult(e) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('agent.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: settings() }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  let spawned = 0
  on('agent.spawn', () =>
    isSpawnRefused() ? { deny: 'no' } : { model: 'm', agentId: `a${++spawned}` },
  )
}

// The test `$` takes the whole spawn input; only the parent loop is under test.
const spawn = ($: Engine, parentAgentId?: string) =>
  $.agent.spawn({ prompt: 'p', parentAgentId } as never)

const measure = ($: Engine, usd?: number) =>
  $.session.measure({
    context: {},
    rateLimits: [],
    ...(usd === undefined ? {} : { cost: { usd } }),
    changed: ['cost'],
  } as never)

test(
  'turn.step accumulates usage and shows cache hit',
  { options: { cacheTtl: '5m' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    engine(on)
    on('turn.step', stepHook(USAGE))

    await runStep($, STEP)
    await runStep($, { ...STEP, index: 1 })

    const text = await settled($, clock)
    expect(text).toContain('↑ in 200')
    expect(text).toContain('↓ out 10')
    expect(text).toContain('◈ cache 80%')
    expect(text).toContain('◔ 5:00')
  },
)

test(
  'a subagent step adds tokens but does not extend the countdown',
  { options: { cacheTtl: '5m' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    engine(on)
    on('turn.step', stepHook(USAGE))

    await runStep($, STEP)
    await clock.advance(10_000)
    await runStep($, { ...STEP, agentId: 'sub1' })

    const text = await settled($, clock)
    expect(text).toContain('↑ in 200')
    expect(text).toContain('◔ 4:50')
  },
)

test('a step without usage changes nothing and never produces NaN', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(null))

  await runStep($, STEP)

  const text = await settled($, clock)
  expect(text).toContain('↑ in 0')
  expect(text).toContain('◔ --')
  expect(text).not.toContain('NaN')
})

test('tool calls are counted', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await settled($, clock)).toContain('⌘ calls 3')
})

test('data is stored per session id and reloaded when the id comes back', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  let id = 'S1'
  engine(on, () => id)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  id = 'S2'
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const other = await settled($, clock)
  expect(other).toContain('↑ in 0')
  expect(other).toContain('⌘ calls 1')

  id = 'S1'
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const back = await settled($, clock)
  expect(back).toContain('↑ in 100')
  expect(back).toContain('⌘ calls 1')
})

test('resume: a stored session is loaded on its first event', async ($, on) => {
  const clock = mock.clock(on, { now: 5000 })
  mock.store(on, {
    'session:S1': {
      totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      tools: 7,
      lastStepAt: 1000,
      workMs: 9000,
    },
  })
  engine(on)

  await $.tool.call({ tool: 'Bash', command: 'true' })

  const text = await settled($, clock)
  expect(text).toContain('⌘ calls 8')
  expect(text).toContain('◷ work 0:09')
})

test('working time covers turn.start -> turn.complete', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(5000)
  await $.turn.complete({ ...DONE, turnId: 't1' })
  await clock.advance(60_000)

  expect(await settled($, clock)).toContain('◷ work 0:05')
})

test('overlapping turns count the outer interval once', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(1000)
  await $.turn.start({ text: 'b', turnId: 't2' })
  await clock.advance(1000)
  await $.turn.complete({ ...DONE, turnId: 't2' })
  await clock.advance(1000)
  await $.turn.complete({ ...DONE, turnId: 't1' })

  expect(await settled($, clock)).toContain('◷ work 0:03')
})

test('an aborted turn still closes its interval', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(2000)
  await $.turn.complete({ ...DONE, turnId: 't1', isAborted: true, reason: 'aborted' })

  expect(await settled($, clock)).toContain('◷ work 0:02')
})

test('the work clock runs live while a turn is open', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(3000)

  expect(await settled($, clock)).toContain('◷ work 0:03')
})

test('the countdown changes tone and expires', { options: { cacheTtl: '5m' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  await clock.advance(250_000)
  expect(await settled($, clock)).toContain('◔ 0:50')
  await clock.advance(310_000)
  expect(await settled($, clock)).toContain('◔ expired')
})

test('the band draws on the desktop surface too', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await settled($, clock, 'desktop')).toContain('⌘ calls 1')
})

test('a cache lifetime of 1h is honoured', { options: { cacheTtl: '1h' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)

  expect(await settled($, clock)).toContain('◔ 60:00')
})

test('a subagent turn.complete does not close the main ◷ interval', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(2000)
  await $.turn.complete({ ...DONE, turnId: 'sub-turn', agentId: 'sub1' })
  await clock.advance(3000)
  await $.turn.complete({ ...DONE, turnId: 't1' })

  expect(await settled($, clock)).toContain('◷ work 0:05')
})

test('parallel tool calls are all counted', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  await Promise.all([1, 2, 3, 4, 5].map(() => $.tool.call({ tool: 'Bash', command: 'true' })))

  expect(await settled($, clock)).toContain('⌘ calls 5')
})

test(
  'the band shows the stored session before any event happens',
  { options: { cacheTtl: '5m' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: 5000 })
    mock.store(on, {
      'session:S1': {
        totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        tools: 7,
        lastStepAt: 1000,
        workMs: 9000,
      },
    })
    engine(on)

    const text = await settled($, clock)
    expect(text).toContain('⌘ calls 7')
    expect(text).toContain('◷ work 0:09')
    expect(text).toContain('◔ 4:56')
  },
)

test(
  'the countdown starts when the request was sent, not when the response ended',
  { options: { cacheTtl: '5m' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    engine(on)
    on('turn.step', async function* (_$, e) {
      yield* [] as never[]
      await clock.advance(100_000)
      return { ...stepResult(USAGE), turnId: e.turnId, index: e.index }
    })

    await runStep($, STEP)

    expect(await settled($, clock)).toContain('◔ 3:20')
  },
)

test('a denied tool call is not counted', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  let isDenied = true
  engine(
    on,
    () => 'S1',
    () => (isDenied ? { deny: 'blocked' } : { result: {} as never, text: 'ok' }),
  )

  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await settled($, clock)).toContain('⌘ calls 0')

  isDenied = false
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await settled($, clock)).toContain('⌘ calls 1')
})

test('parallel events leave the stored copy as the latest state', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  let id = 'S1'
  engine(on, () => id)

  await Promise.all([1, 2, 3, 4, 5].map(() => $.tool.call({ tool: 'Bash', command: 'true' })))
  id = 'S2'
  await $.tool.call({ tool: 'Bash', command: 'true' })
  id = 'S1'
  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await settled($, clock)).toContain('⌘ calls 6')
})

test('only the 50 most recent sessions are kept in the store', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const old = Array.from({ length: 50 }, (_, i) => `o${i}`)
  const entries: Record<string, unknown> = { sessions: old }
  for (const id of old) {
    entries[`session:${id}`] = {
      totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      tools: 9,
      lastStepAt: null,
      workMs: 0,
    }
  }
  mock.store(on, entries)
  let id = 'S1'
  engine(on, () => id)

  await $.tool.call({ tool: 'Bash', command: 'true' })
  id = 'o49'
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await settled($, clock)).toContain('⌘ calls 1 ')

  id = 'o0'
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await settled($, clock)).toContain('⌘ calls 10 ')
})

test('a turn that is open when the session id changes keeps its time', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  let id = 'S1'
  engine(on, () => id)

  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(1000)
  id = 'S2'
  await clock.advance(3000)
  await $.turn.complete({ ...DONE, turnId: 't1' })

  expect(await settled($, clock)).toContain('◷ work 0:04')
})

test(
  'session.start starts the tick for a session with a live cache',
  { options: { cacheTtl: '5m' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {
      'session:S1': {
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        tools: 0,
        lastStepAt: 1000,
        workMs: 0,
      },
    })
    engine(on)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await clock.advance(10_000)

    expect(await settled($, clock)).toContain('◔ 4:50')
  },
)

test('the band is one flex row: the segments around the agents button, not a column', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  const ui = await $.ui.mount({
    plugin: 'flight-deck',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, view: {} } as never,
  })
  const root = await ui.drawn()
  await ui.unmount()

  expect(root.type).toBe('Box')
  expect(root).toMatchObject({ props: { flexDirection: 'row' } })
})

test('cost follows the session ledger: the latest figure, not a sum', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  await measure($, 0.1)
  await measure($, 0.416)
  expect(await settled($, clock)).toContain('$ cost 0.42')

  // A measurement without a ledger keeps the last figure.
  await measure($)
  expect(await settled($, clock)).toContain('$ cost 0.42')
})

// The end of a turn reads the ledger: the band shows that figure, as the dashboard does.
test('the band shows the ledger cost read at the end of a turn', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  let ledger = 0
  engine(on, undefined, undefined, undefined, undefined, undefined, () => ({
    cost: { usd: ledger },
  }))

  await $.turn.start({ text: 'a', turnId: 't1' })
  ledger = 1.5
  await $.turn.complete({ turnId: 't1', ...DONE })

  expect(await settled($, clock)).toContain('$ cost 1.50')
})

test('edits add their changed lines to the diff; failed and denied calls do not', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  const patch = { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] }
  let answer: object = { result: patch, text: 'ok' }
  engine(
    on,
    () => 'S1',
    () => answer,
  )

  await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'b', new_string: 'c' })
  answer = { result: { type: 'create', content: 'x\ny', structuredPatch: [] }, text: 'ok' }
  await $.tool.call({ tool: 'Write', file_path: 'b', content: 'x\ny' })
  answer = { result: patch, text: 'failed', isError: true }
  await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'b', new_string: 'c' })
  answer = { deny: 'no' }
  await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'b', new_string: 'c' })

  expect(await settled($, clock)).toContain('± diff +4 -1 ')
})

test('cost and diff survive a session id round trip', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  let id = 'S1'
  engine(
    on,
    () => id,
    () => ({ result: { structuredPatch: [{ lines: ['+a', '-b', '-c'] }] }, text: 'ok' }),
  )

  await measure($, 2.5)
  await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'b', new_string: 'c' })
  id = 'S2'
  const other = await settled($, clock)
  expect(other).toContain('$ cost 0.00')
  expect(other).toContain('± diff +0 -0 ')

  id = 'S1'
  const back = await settled($, clock)
  expect(back).toContain('$ cost 2.50')
  expect(back).toContain('± diff +1 -2 ')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a changed count runs from the old value to the new one (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    engine(on)
    on('turn.step', stepHook(USAGE))

    await runStep($, STEP)
    expect(await settled($, clock, surface)).toContain('↑ in 100 ')

    await runStep($, { ...STEP, index: 1 })
    expect(await bandText($, surface)).toContain('↑ in 100 ')

    await clock.advance(120)
    const mid = Number(/↑ in (\d+) /.exec(await bandText($, surface))?.[1])
    expect(mid).toBeGreaterThan(100)
    expect(mid).toBeLessThan(200)

    expect(await settled($, clock, surface)).toContain('↑ in 200 ')
  })
}

test('a loaded session shows its stored counts first, then runs to the new value', async ($, on) => {
  const clock = mock.clock(on, { now: 5000 })
  mock.store(on, {
    'session:S1': {
      totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      tools: 7,
      lastStepAt: 1000,
      workMs: 9000,
    },
  })
  engine(on)

  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await bandText($)).toContain('⌘ calls 7 ')
  expect(await settled($, clock)).toContain('⌘ calls 8 ')
})

test('a change during a tween continues from the displayed value', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  await clock.advance(120)
  const before = Number(/↑ in (\d+) /.exec(await bandText($))?.[1])
  await runStep($, { ...STEP, index: 1 })
  const after = Number(/↑ in (\d+) /.exec(await bandText($))?.[1])

  expect(before).toBeGreaterThan(0)
  expect(after).toBe(before)
  expect(await settled($, clock)).toContain('↑ in 200 ')
})

test('started subagents are counted; a refused spawn is not', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  let isRefused = false
  engine(on, undefined, undefined, () => isRefused)

  await spawn($)
  await spawn($)
  isRefused = true
  await spawn($)

  expect(await settled($, clock)).toMatch(/▸ agents 2$/)
})

test('background tasks are counted: a tool call sent to the background, not an Agent call', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  let answer: object = { result: {} as never, text: 'ok' }
  engine(
    on,
    () => 'S1',
    () => answer,
  )

  await $.tool.call({ tool: 'Bash', command: 'sleep 9', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await $.tool.call({ tool: 'Agent', prompt: 'p', description: 'd', run_in_background: true })
  answer = { result: {} as never, text: 'failed', isError: true }
  await $.tool.call({ tool: 'Bash', command: 'sleep 9', run_in_background: true })

  expect(await settled($, clock)).toContain('◇ bg 1 ')

  // A monitor is a background task by nature: it has no flag.
  answer = { result: {} as never, text: 'ok' }
  await $.tool.call({ tool: 'Monitor', command: 'tail -f x' } as never)
  expect(await settled($, clock)).toContain('◇ bg 2 ')
})

test('the session totals include a subagent and the agents it spawned', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  await runStep($, { ...STEP, agentId: 'a1' })
  await runStep($, { ...STEP, agentId: 'a2' })
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'a2' } as never)

  const text = await settled($, clock)
  expect(text).toContain('↑ in 300 ')
  expect(text).toContain('↓ out 15 ')
  expect(text).toContain('⌘ calls 1 ')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(
    `an agent's transcript shows that agent and the agents below it (${surface})`,
    { options: { cacheTtl: '5m' } },
    async ($, on) => {
      const clock = mock.clock(on, { now: 1000 })
      mock.store(on, {})
      engine(
        on,
        () => 'S1',
        () => ({ result: { structuredPatch: [{ lines: ['+a', '-b'] }] }, text: 'ok' }),
      )
      on('turn.step', stepHook(USAGE))

      await runStep($, STEP)
      await spawn($)
      await spawn($, 'a1')
      await spawn($)
      await clock.advance(10_000)
      await runStep($, { ...STEP, agentId: 'a1' })
      await runStep($, { ...STEP, agentId: 'a2' })
      await runStep($, { ...STEP, agentId: 'a3' })
      await $.tool.call({ tool: 'Edit', file_path: 'a', agentId: 'a2' } as never)
      await clock.advance(SETTLE_MS)

      const sub = await bandText($, surface, 'a1')
      // The band names the agent and shows its context length before its tokens.
      expect(sub).toMatch(/◆ agent · a\d m │ ctx 100\/200k 0% │ ↑ in 200 /)
      expect(sub).toContain('↓ out 10 ')
      expect(sub).toContain('⌘ calls 1 ')
      // An agent's band has no agents button: the diff is its last part.
      expect(sub).toMatch(/± diff \+1 -1$/)
      // The agent's own cache: its step was sent 10s after the main one.
      expect(sub).toContain('◔ 5:00')
      expect(sub).not.toContain('$ cost')

      const main = await bandText($, surface)
      expect(main).toContain('↑ in 400 ')
      expect(main).toMatch(/▸ agents 3$/)
      expect(main).toContain('◔ 4:50')
    },
  )
}

test('spawn counts and per-agent data survive a session id round trip', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  let id = 'S1'
  engine(on, () => id)
  on('turn.step', stepHook(USAGE))

  await spawn($)
  await runStep($, { ...STEP, agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'sleep 9', run_in_background: true })
  id = 'S2'
  expect(await settled($, clock)).toMatch(/▸ agents 0$/)

  id = 'S1'
  const back = await settled($, clock)
  expect(back).toMatch(/▸ agents 1$/)
  expect(back).toContain('◇ bg 1 ')
  expect(await bandText($, 'terminal', 'a1')).toContain(
    '◆ agent · a1 m │ ctx 100/200k 0% │ ↑ in 100 ',
  )
})

test("the tick keeps running while a subagent's cache is live, after the main one lapsed", async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  await clock.advance(200_000)
  await runStep($, { ...STEP, agentId: 'a1' })
  // The main cache lapses here; the subagent's has 200s more.
  await clock.advance(110_000)
  expect(await bandText($, 'terminal', 'a1')).toContain('◔ 3:10')

  await clock.advance(60_000)
  expect(await bandText($, 'terminal', 'a1')).toContain('◔ 2:10')
})

// One agent's messages as the engine returns them: a prompt, a tool call, the handback.
const ROWS = [
  { role: 'user', text: 'Count the lines.', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      {
        tool_use_id: 't1',
        tool: 'Bash',
        input: { command: 'wc -l README.md' },
        text: '52 README.md',
      },
    ],
  },
  { role: 'user', text: '', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      { tool_use_id: 't2', tool: 'SubagentHandback', input: { message: '52 lines.' }, text: 'ok' },
    ],
  },
]

type Surface = 'terminal' | 'desktop'
const SURFACES = ['terminal', 'desktop'] as const

// The pane's answers beneath the plugin; `opens` and `closes` record what the plugin asked.
const paneEngine = (on: Parameters<typeof mock.store>[0], messages: () => unknown = () => ROWS) => {
  const calls = { opens: 0, closes: 0, isOpenFocused: false, title: '' }
  on('session.messages', () => ({ value: messages() }) as never)
  on('ui.open', (_$, e) => {
    calls.opens++
    calls.isOpenFocused = e.focus === true
    calls.title = String(e.title)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', () => {
    calls.closes++
    return { value: undefined } as never
  })
  return calls
}

const mountPane = (
  $: Engine,
  surface: Surface,
  isFocused = true,
  bodyColumns = 80,
  scrollOffset = 0,
) =>
  $.ui.mount({
    plugin: 'flight-deck',
    surface,
    component: 'Pane',
    requestId: 'agents',
    props: {
      title: 'Agents',
      isFocused,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: scrollOffset, bodyRows: 40 },
      view: {},
    } as never,
  })

// Everything the pane draws as text: Texts, Button labels, Markdown and Code bodies.
const paneText = async (ui: Awaited<ReturnType<typeof mountPane>>) => {
  const all = [
    ...(await ui.findAll({ type: 'Text' })).map((t) => t.text),
    ...(await ui.findAll({ type: 'Button' })).map((b) => String(b.props.label)),
    ...(await ui.findAll({ type: 'Markdown' })).map((m) => String(m.props.text)),
    ...(await ui.findAll({ type: 'Code' })).map((c) => String(c.props.source)),
    // A desktop draws each cell of a row in a Client: its text is in its props.
    ...(await ui.findAll({ type: 'Client' })).map((c) => cellText(c.props.props as Cell, 0, 0)),
  ]
  return all.join('\n')
}

// One cell of the pane as text: a desktop draws it in a Client, with its text in its props.
const cellOf = async (ui: Awaited<ReturnType<typeof mountPane>>, key: string) => {
  const node = await ui.find({ key })
  return node?.type === 'Client' ? cellText(node.props.props as Cell, 0, 0) : JSON.stringify(node)
}

// The status marks the pane draws, in order: a Text of indent, one mark glyph and a space.
// (A Text's key is not addressable by `find`, so the marks are told by their shape.)
const MARK_RE = /^ *[⣾⣽⣻⢿⡿⣟⣯⣷⣿✓✗] $/
// A mark is a two-cell cell: a Text in a two-cell Box on the terminal, a Client on the desktop,
// where a turning one reads as `◌ `. An empty Box before it in its row is the tree's indent.
type Mark = { text: string; props: { color?: unknown } }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const marks = async (ui: Awaited<ReturnType<typeof mountPane>>) => {
  const out: Mark[] = []
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const el = n as Node
    const kids = (el.children ?? []) as Node[]
    let indent = ''
    for (const kid of kids) {
      const grand = (kid.children ?? []) as Node[]
      if (kid.type === 'Box' && grand.length === 0 && typeof kid.props?.width === 'number')
        indent = ' '.repeat(kid.props.width + 1)
      if (kid.type === 'Box' && kid.props?.width === 2 && grand[0]?.type === 'Text') {
        const text = `${indent}${(grand[0].children ?? []).join('')} `
        // The table's header has an empty cell of a mark's width: it is not a mark.
        if (MARK_RE.test(text) && text.trim() !== '')
          out.push({ text, props: { color: grand[0].props?.color } })
      }
      const c = kid.props?.props as Cell | undefined
      if (
        kid.type === 'Client' &&
        kid.props?.module === 'src/cellClient.tsx' &&
        c?.width === 2 &&
        (c.spin === true || c.text !== '')
      )
        out.push({
          text: c.spin === true ? '◌ ' : `${indent}${c.text} `,
          props: { color: c.color },
        })
    }
    for (const k of kids) walk(k)
  }
  walk(await ui.drawn())
  return out
}

const completeAgent = ($: Engine, agentId: string) => $.turn.complete({ ...DONE, agentId } as never)

test('an empty registry shows a note', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).toContain('No agents yet.')
    await ui.unmount()
  }
})

test('the tree lists a spawned agent and a press shows its transcript', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  await completeAgent($, 'a1')

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // The runs column is a bare count; the transcript's title spells it out.
    expect(await paneText(ui)).not.toContain('1 run')
    await ui.press({ key: 'agent:a1' })
    const text = await paneText(ui)
    expect(text).toContain('1 run')
    expect(text).toContain('Count the lines.')
    expect(text).toContain('Bash wc -l README.md')
    expect(text).toContain('52 lines.')
    expect(text).not.toContain('52 README.md')

    await ui.press({ key: 'tool:t1' })
    expect(await paneText(ui)).toContain('52 README.md')
    await ui.press({ key: 'tool:t1' })
    expect(await paneText(ui)).not.toContain('52 README.md')

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
    await ui.unmount()
  }
})

test('a child agent is listed below its parent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  await spawn($, 'a1')

  const ui = await mountPane($, 'terminal')
  // Each agent has five buttons: the expand button, the name, the text of its detail row, and
  // the message and the stop of its control row.
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(10)
  expect((await marks(ui)).map((m) => m.text)).toEqual(['⣾ ', '  ⣾ '])
  await ui.unmount()
})

test('a refused read shows the refusal text', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on, () => ({ deny: 'agent a1 is not readable' }))
  await spawn($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'agent:a1' })
    expect(await paneText(ui)).toContain('agent a1 is not readable')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('an agent with no messages shows a note', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on, () => [])
  await spawn($)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  expect(await paneText(ui)).toContain('No messages yet.')
  await ui.unmount()
})

test('a second run counts and the open transcript is read again', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  let isSecond = false
  const calls = paneEngine(on, () =>
    isSecond ? [...ROWS, { role: 'user', text: 'Again.', toolUses: [] }] : ROWS,
  )
  await spawn($)
  await completeAgent($, 'a1')

  // The pane is open (the band button) with a1 on the transcript screen.
  const band = await $.ui.mount({
    plugin: 'flight-deck',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 200, view: {} } as never,
  })
  await band.press({ key: 'agents' })
  expect(calls.opens).toBe(1)
  expect(calls.title).toBe('🤖 Flight Deck')
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  expect(await paneText(ui)).not.toContain('Again.')

  isSecond = true
  // A message starts the agent again: its first call counts the run.
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'a1' } as never)
  await completeAgent($, 'a1')
  const text = await paneText(ui)
  expect(text).toContain('Again.')
  expect(text).toContain('2 runs')
  await ui.unmount()
  await band.unmount()
})

test('the band button opens the pane and a second press closes it', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  const calls = paneEngine(on)
  for (const surface of SURFACES) {
    const before = { ...calls }
    const band = await $.ui.mount({
      plugin: 'flight-deck',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, bodyColumns: 200, view: {} } as never,
    })
    await band.press({ key: 'agents' })
    expect(calls).toMatchObject({ opens: before.opens + 1, closes: before.closes })
    // The pane takes the keyboard: the first click in it presses, not focuses.
    expect(calls.isOpenFocused).toBe(true)
    expect(String((await band.find({ key: 'agents' }))?.props.label)).toContain('▾')
    await band.press({ key: 'agents' })
    expect(calls).toMatchObject({ opens: before.opens + 1, closes: before.closes + 1 })
    await band.unmount()
  }
})

test('the command toggles the pane', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  const calls = paneEngine(on)
  const first = await $.command.run({ command: 'agent-log' } as never)
  const second = await $.command.run({ command: 'agent-log' } as never)
  expect(first).toMatchObject({ text: 'Agents pane opened.' })
  expect(second).toMatchObject({ text: 'Agents pane closed.' })
  expect(calls).toMatchObject({ opens: 1, closes: 1 })
})

test('the registry is kept per session id and comes back with the id', async ($, on) => {
  let id = 'S1'
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, () => id)
  paneEngine(on)
  await spawn($)

  id = 'S2'
  await $.turn.start({ turnId: 't2' } as never)
  await completeAgent($, 'other')
  let ui = await mountPane($, 'terminal')
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:other' })).toBeDefined()
  await ui.unmount()

  id = 'S1'
  await completeAgent($, 'a1')
  ui = await mountPane($, 'terminal')
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:other' })).toBeUndefined()
  await ui.unmount()
})

test('an event of another agent does not replace the open transcript', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  let reads = 0
  paneEngine(on, () => {
    reads++
    return ROWS
  })
  await spawn($)
  await spawn($)
  const band = await $.ui.mount({
    plugin: 'flight-deck',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 200, view: {} } as never,
  })
  await band.press({ key: 'agents' })
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a2' })
  expect(reads).toBe(1)
  await completeAgent($, 'a1')
  expect(reads).toBe(1)
  await completeAgent($, 'a2')
  expect(reads).toBe(2)
  await ui.unmount()
  await band.unmount()
})

test('the wrap toggle switches the transcript between cut rows and wrapped text', async ($, on) => {
  const long = `Count the lines. ${'x'.repeat(200)} END`
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on, () => [{ role: 'user', text: long, toolUses: [] }, ...ROWS.slice(1)])
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'agent:a1' })
    await ui.press({ key: 'tool:t1' })
    // Wrapped by default.
    expect(String((await ui.find({ key: 'wrap' }))?.props.label)).toContain('on')
    expect(await paneText(ui)).toContain('END')
    for (const code of await ui.findAll({ type: 'Code' })) expect(code.props.wrap).toBe('wrap')

    await ui.press({ key: 'wrap' })
    expect(String((await ui.find({ key: 'wrap' }))?.props.label)).toContain('off')
    // A desktop cuts the prompt to the pane's columns. The terminal's layout cuts it.
    if (surface === 'desktop') expect(await paneText(ui)).not.toContain('END')
    else
      expect((await ui.findAll({ type: 'Text', text: /END/ })).map((t) => t.props.wrap)).toEqual([
        'truncate',
      ])
    for (const code of await ui.findAll({ type: 'Code' }))
      expect(code.props.wrap).toBe('truncate-end')

    // Back to the wrapped rows, so the next surface starts from the same state.
    await ui.press({ key: 'wrap' })
    await ui.press({ key: 'tool:t1' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

// The wrap choice is the plugin's, not a session's: opening the pane reads the last one stored.
test('opening the pane restores the last wrap choice', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, { wrap: false })
  engine(on)
  paneEngine(on)
  await spawn($)
  await $.command.run({ command: 'agent-log' } as never)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'agent:a1' })
  expect(String((await ui.find({ key: 'wrap' }))?.props.label)).toContain('off')
  await ui.unmount()
})

test('a running agent spins while the pane is open and stops when it completes', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  const band = await $.ui.mount({
    plugin: 'flight-deck',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 200, view: {} } as never,
  })
  await band.press({ key: 'agents' })
  const ui = await mountPane($, 'terminal')
  const mark = async () => (await marks(ui))[0]?.text.trim()

  const first = await mark()
  await clock.advance(120)
  const second = await mark()
  expect(second).not.toBe(first)
  expect(second).not.toBe('⣿')

  await completeAgent($, 'a1')
  expect(await mark()).toBe('⣿')
  await clock.advance(600)
  expect(await mark()).toBe('⣿')
  await ui.unmount()
  await band.unmount()
})

test('an agent row is colored by its status', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  await spawn($)
  await completeAgent($, 'a1')

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // Both started at the same mocked time, so they keep their spawn order: a1 is idle
    // (a dim mark, a dim row), a2 runs (a green mark, a row at full strength).
    expect((await marks(ui)).map((m) => m.props.color)).toEqual(['#727072', '#a9dc76'])
    expect((await ui.find({ key: 'agent:a2' }))?.props.dimColor).toBeUndefined()
    expect((await ui.find({ key: 'agent:a1' }))?.props.dimColor).toBe(true)

    // The title is a bold cell: a Text on the terminal, a Client's props on the desktop. The
    // terminal's first bold Text is the title of the pane.
    const titleColor = async () =>
      (await ui.findAll({ type: 'Text' })).find(
        (x) => x.props.bold === true && x.text !== '🤖 Flight Deck',
      )?.props.color ??
      (await ui.findAll({ type: 'Client' }))
        .map((c) => c.props.props as Cell)
        .find((c) => c.bold === true)?.color
    await ui.press({ key: 'agent:a2' })
    expect(await titleColor()).toBe('#a9dc76')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'agent:a1' })
    expect(await titleColor()).toBe('#fcfcfa')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a tool call is colored by its outcome', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  const use = (id: string, extra: object) => ({
    tool_use_id: id,
    tool: 'Bash',
    input: { command: id },
    ...extra,
  })
  paneEngine(on, () => [
    {
      role: 'assistant',
      text: '',
      toolUses: [
        use('ok', { text: 'fine' }),
        use('bad', { text: 'boom', isError: true }),
        use('run', {}),
      ],
    },
  ])
  await spawn($)
  await completeAgent($, 'a1')

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'agent:a1' })
    const drawn = (await marks(ui)).map((m) => [m.text.trim(), m.props.color])
    // The title's mark first: a1 is idle.
    expect(drawn).toEqual([
      ['⣿', '#727072'],
      ['✓', '#a9dc76'],
      ['✗', '#ff6188'],
      [surface === 'terminal' ? '⣾' : '◌', '#ffd866'],
    ])
    // A failed call's row stays at full strength; a finished one is dim at rest.
    expect((await ui.find({ key: 'tool:ok' }))?.props.dimColor).toBe(true)
    expect((await ui.find({ key: 'tool:bad' }))?.props.dimColor).toBeUndefined()
    expect(String((await ui.find({ key: 'tool:ok' }))?.props.label)).toBe('▸ Bash ok')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

const notify = ($: Engine, agentId: string, status: string) =>
  $.prompt.submit({
    text: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>${status}</status>\n</task-notification>`,
    wait: false,
    origin: { kind: 'task-notification' },
  } as never)

const STOPPED = { text: '⣿ ', props: { color: '#ff6188' } }

test('an aborted run of an agent draws it stopped', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  await $.turn.complete({ ...DONE, isAborted: true, reason: 'aborted', agentId: 'a1' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await marks(ui)).toMatchObject([STOPPED])
    expect((await ui.find({ key: 'agent:a1' }))?.props.dimColor).toBe(true)
    // A run is counted at its start: an aborted run stays counted.
    await ui.press({ key: 'agent:a1' })
    expect(await paneText(ui)).toContain('1 run')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a killed notification stops the agent and its next event runs it again', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  await notify($, 'a1', 'killed')
  // A notification of a task that is not an agent changes nothing.
  await notify($, 'bash1', 'killed')

  let ui = await mountPane($, 'terminal')
  expect(await marks(ui)).toMatchObject([STOPPED])
  expect(await ui.find({ key: 'agent:bash1' })).toBeUndefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'a1' } as never)
  ui = await mountPane($, 'terminal')
  expect((await marks(ui))[0]?.props.color).toBe('#a9dc76')
  await ui.unmount()
})

test('a stored running agent that this process does not list loads as stopped', async ($, on) => {
  mock.clock(on, { now: 5000 })
  mock.store(on, {
    'agents:S1': { a9: { id: 'a9', status: 'running', runs: 0, startedAt: 1, endedAt: null } },
  })
  engine(on)
  paneEngine(on)
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'b1' } as never)

  const ui = await mountPane($, 'terminal')
  // The tool call loads the session. Its loop is not a known agent: it adds no row.
  const marked = await marks(ui)
  expect(marked).toHaveLength(1)
  expect(marked.map((m) => m.props.color)).toContain('#ff6188')
  await ui.unmount()
})

// A redraw of the pane during a click drops it on the desktop, so the spinner must not
// redraw the pane there: the mark is a Client that draws its own frames.
test('on the desktop a running mark turns in its own Client and the pane is not drawn again', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  const band = await $.ui.mount({
    plugin: 'flight-deck',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 200, view: {} } as never,
  })
  await band.press({ key: 'agents' })
  const ui = await mountPane($, 'desktop')
  const spinner = (await ui.findAll({ type: 'Client' })).find(
    (c) => (c.props.props as Cell).spin === true,
  )
  expect(spinner?.props.module).toBe('src/cellClient.tsx')
  const key = String(spinner?.key)
  const frame = async () => JSON.stringify(await ui.drawn({ in: key }))
  const pane = JSON.stringify(await ui.drawn())
  const first = await frame()
  await ui.advance(120)
  await clock.advance(600)
  expect(await frame()).not.toBe(first)
  expect(JSON.stringify(await ui.drawn())).toBe(pane)
  await ui.unmount()
  await band.unmount()
})

test('an agent shows its model and effort, and its numbers under the title', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', effort: 'high', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'a1' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // The table names no model; the dashboard's row names the short one, the transcript the
    // whole one with its effort.
    expect(await paneText(ui)).toContain('sonnet-5-5')
    expect(await paneText(ui)).not.toContain('claude-sonnet-5-5')
    await ui.press({ key: 'agent:a1' })
    const text = await paneText(ui)
    expect(text).toContain('claude-sonnet-5-5 high')
    // The model, the runs and the time are a row of their own below the title.
    expect(await ui.find({ key: 'meta' })).toBeDefined()
    expect(text).toContain('↑ in 100')
    expect(text).toContain('⌘ calls 1')
    await ui.press({ key: 'back' })
    await ui.unmount()
    // The band of the agent's view names the model and the effort too.
    expect(await bandText($, surface, 'a1')).toContain(
      '◆ agent · a1 claude-sonnet-5-5 high │ ctx 100/1M 0% │',
    )
  }
})

// The working time of an agent: from its spawn to now while it runs, to its end once it ended.
// On a desktop a running agent's time is a `Client` with its own timer, as the spinner is.
test('an agent row and its title show how long the agent worked', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  // The spawn names the agent, as each real spawn does: an old entry with no data is dropped.
  await $.agent.spawn({ prompt: 'p', description: 'work' } as never)
  await clock.advance(65_000)

  const terminal = await mountPane($, 'terminal')
  expect(await paneText(terminal)).toContain(' 1:05')
  await terminal.unmount()
  const desktop = await mountPane($, 'desktop')
  const clocks = (await desktop.findAll({ type: 'Client' })).map((c) => c.props.props as Cell)
  expect(clocks.filter((c) => c.since !== undefined).map((c) => c.since)).toEqual([1000])
  await desktop.unmount()

  await completeAgent($, 'a1')
  await clock.advance(10_000)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // The table's time has no clock; the title of the agent has it before the time.
    expect(await paneText(ui)).toContain('1:05')
    expect(await paneText(ui)).not.toContain('◷ 1:05')
    await ui.press({ key: 'agent:a1' })
    expect(await paneText(ui)).toContain('◷ 1:05')
    // A dot parts the runs from the time (and the model from the runs, when it is known).
    expect(JSON.stringify(await ui.find({ key: 'meta:sep:time' }))).toContain('·')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

// Above the agents: the engine's session cost, then per model an estimated cost, the working
// time and the runs of its agents.
test("the dashboard shows the session cost and each model's cost, time and runs", async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await runStep($, { ...STEP, model: 'claude-opus-5-5' } as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-haiku-4-5-20251001', agentId: 'a1' } as never)
  await clock.advance(65_000)
  await completeAgent($, 'a1')
  await measure($, 1.5)
  // A changed cost runs to its new value: let it arrive.
  await clock.advance(SETTLE_MS)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const text = await paneText(ui)
    expect(text).toContain('total ≈$1.50')
    expect(text).toContain('opus-5-5')
    expect(text).toContain('haiku-4-5')
    // USAGE is 10 in, 5 out, 80 read and 10 written: under a cent at either price.
    expect(text).toContain('≈0.00')
    // The time column has no clock icon, in its header or in its cells.
    expect(JSON.stringify(await ui.find({ key: 'dash:head:time' }))).not.toContain('◷')
    expect(JSON.stringify(await ui.find({ key: 'dash:time:haiku-4-5' }))).toContain('1:05')
    expect(JSON.stringify(await ui.find({ key: 'dash:time:haiku-4-5' }))).not.toContain('◷')
    expect(JSON.stringify(await ui.find({ key: 'head:time' }))).not.toContain('◷')
    expect(JSON.stringify(await ui.find({ key: 'time:a1' }))).not.toContain('◷')
    // The ledger cost the rows do not hold, with no time and no runs of its own.
    expect(text).toContain('side requests')
    expect(text).toContain('≈1.50')
    // The columns name their unit; the share of the total has its own column.
    expect(text).toContain('cost($)')
    expect(text).toContain('cost(%)')
    expect(JSON.stringify(await ui.find({ key: 'dash:pct:side requests' }))).toContain('100%')
    // The header of the agents table is built as a row is: its columns sit above the cells.
    expect(text).toContain('agents')
    expect((await ui.find({ key: 'head:namebox' }))?.props.width).toBe(
      (await ui.find({ key: 'name:a1' }))?.props.width,
    )
    expect(JSON.stringify(await ui.find({ key: 'dash:time:side requests' }))).not.toContain('◷')
    // The main loop is not a run of an agent: its row names it and shows no count.
    expect(JSON.stringify(await ui.find({ key: 'dash:runs:opus-5-5' }))).toContain('main')
    expect(JSON.stringify(await ui.find({ key: 'dash:runs:haiku-4-5' }))).toMatch(/[ "]1"/)
    await ui.unmount()
  }
})

// The API runs the advisor inside a step: the step's usage leaves its tokens out, so the
// dashboard shows its calls and its time, and its cost stays in the side requests row.
test('the dashboard counts the advisor calls of a step under the model of the settings', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, () => ({ advisorModel: 'opus' }))
  paneEngine(on)
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield* [] as never[]
    return {
      ...stepResult(USAGE),
      turnId: e.turnId,
      index: e.index,
      serverToolUses: [
        { id: 's1', name: 'advisor', input: {}, startedAt: 1000, endedAt: 66_000 },
        { id: 's2', name: 'web_search', input: {}, startedAt: 1000, endedAt: 2000 },
      ],
    }
  } as never)
  await runStep($, { ...STEP, model: 'claude-opus-5-5' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).toContain('advisor·opus')
    expect(JSON.stringify(await ui.find({ key: 'dash:time:advisor·opus' }))).toContain('1:05')
    expect(JSON.stringify(await ui.find({ key: 'dash:runs:advisor·opus' }))).toMatch(/[ "]1"/)
    await ui.unmount()
  }
})

// A cache write costs by its lifetime: the main loop's is the configured one, a subagent's 5m.
test(
  'a step is priced by the cache lifetime of its loop',
  { options: { cacheTtl: '1h' } },
  async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on, {})
    engine(on)
    paneEngine(on)
    const WRITE = { ...USAGE, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
    on('turn.step', stepHook({ ...WRITE, cache_creation_input_tokens: 1e6 }) as never)
    await runStep($, { ...STEP, model: 'claude-opus-5-5' } as never)
    await spawn($)
    await runStep($, { ...STEP, model: 'claude-sonnet-5-5', agentId: 'a1' } as never)
    await measure($, 10.5)
    const ui = await mountPane($, 'terminal')
    const text = await paneText(ui)
    // Opus 5.5 at 2 x $4 for 1h, Sonnet 5.5 at 1.25 x $2 for 5m: nothing left for `other`.
    expect(text).toContain('≈8.00')
    expect(text).toContain('≈2.50')
    expect(text).not.toContain('other')
    await ui.unmount()
  },
)

// A click on a pane that does not hold the keys only moves the focus: it reaches the plugin as
// `ui.focus`, not as a press. The plugin runs the button's action then.
test('a click that gives the pane the focus also presses the button', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  // Landing the ring draws the pane focused before `next` resolves, as a desktop does.
  let isLanding = false
  on('ui.focus', async () => {
    if (isLanding) await (await mountPane($, 'terminal', true)).unmount()
    return { value: {} } as never
  })
  await spawn($)
  await completeAgent($, 'a1')
  const ui = await mountPane($, 'desktop', false)
  const click = (element: string, kind: 'person' | 'plugin' = 'person') =>
    $.ui.focus({
      component: 'Pane',
      requestId: 'agents',
      plugin: 'flight-deck',
      element,
      origin: kind === 'person' ? { kind } : { kind, name: 'other' },
    } as never)
  // Another plugin's focus move does not press.
  await click('agent:a1', 'plugin')
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  isLanding = true
  await click('agent:a1')
  isLanding = false
  expect(await ui.find({ key: 'back' })).toBeDefined()
  await ui.unmount()
  // With the keys, a focus move is Tab or an arrow: it does not press.
  const focused = await mountPane($, 'desktop', true)
  await click('back')
  expect(await focused.find({ key: 'back' })).toBeDefined()
  await focused.unmount()
})

// The dashboard is as wide as the pane, and its last columns are the agents table's: the runs,
// then the time. So the two tables end at one edge and their runs and times line up.
test('the dashboard spans the pane and ends with the runs and the time', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await runStep($, { ...STEP, model: 'claude-opus-5-5' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const head = (await ui.find({ key: 'dash:head' })) as {
      children?: { props?: { key?: string } }[]
    }
    expect(head.children?.map((c) => c.props?.key)).toEqual([
      'dash:head:model',
      'dash:head:cost',
      'dash:head:pct',
      'dash:head:runs',
      'dash:head:time',
    ])
    // A desktop: the pane's columns less the cost (9), the share (7), the runs (7), the time (9)
    // and four gaps. The terminal's layout gives the model the rest of the row.
    const model = await ui.find({ key: 'dash:head:model' })
    if (surface === 'desktop') expect(model?.props.width).toBe(44)
    else expect(model?.props).toEqual({ key: 'dash:head:model', flexGrow: 1, flexShrink: 1 })
    await ui.unmount()
  }
})

test('the terminal pads the pane at the left and the right; a desktop has its own margins', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)

  const term = await mountPane($, 'terminal')
  expect(await term.drawn()).toMatchObject({ type: 'Box', props: { paddingX: 1 } })
  // The terminal draws no title of the pane: the pane's first row is the title there.
  expect(await paneText(term)).toMatch(/^🤖 Flight Deck\n\s*\n/)
  await term.unmount()
  const desk = await mountPane($, 'desktop')
  expect(await paneText(desk)).not.toContain('Flight Deck')
  expect(await desk.drawn()).not.toMatchObject({ props: { paddingX: 1 } })
  await desk.unmount()
})

// A desktop draws a button's label after a margin of its own. The header of the names is a
// button there too, so `agents` starts where the names start.
test('the header of the agent names is built as a name is', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)

  const desk = await mountPane($, 'desktop')
  expect(await desk.find({ key: 'head:name' })).toMatchObject({
    type: 'Button',
    props: { label: 'agents', plain: true, dimColor: true },
  })
  await desk.unmount()
  const term = await mountPane($, 'terminal')
  expect((await term.find({ key: 'head:name' }))?.type).not.toBe('Button')
  await term.unmount()
})

// A desktop's font is not fixed-width, so a count of `─` does not give a width there: the
// layout cuts a longer line at the pane's width.
test('the rule below the dashboard is as wide as the pane', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await measure($, 1)

  // The terminal's line is longer than a pane: its box has no width and shows one row of it.
  const term = await mountPane($, 'terminal')
  expect((await term.find({ key: 'dash:rule' }))?.props).toEqual({
    key: 'dash:rule',
    height: 1,
    overflow: 'hidden',
  })
  expect(await paneText(term)).toContain('─'.repeat(200))
  await term.unmount()
  const desk = await mountPane($, 'desktop')
  expect(await desk.find({ key: 'dash:rule' })).toMatchObject({
    type: 'Box',
    props: { width: 80, height: 1, overflow: 'hidden' },
  })
  await desk.unmount()
})

// A changed cost runs to its new value. The terminal draws each frame; a desktop is not drawn
// again (a redraw drops a click), so its cell takes the new cost and runs to it by itself.
test('a changed cost of the dashboard runs to its new value', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await measure($, 1)
  await clock.advance(SETTLE_MS)
  await measure($, 2)
  await clock.advance(100)

  const term = await mountPane($, 'terminal')
  const mid = Number(/total ≈\$(\d+\.\d+)/.exec(await paneText(term))?.[1])
  expect(mid).toBeGreaterThan(1)
  expect(mid).toBeLessThan(2)
  await clock.advance(SETTLE_MS)
  expect(await paneText(term)).toContain('total ≈$2.00')
  await term.unmount()

  const desk = await mountPane($, 'desktop')
  const cells = (await desk.findAll({ type: 'Client' })).map((c) => c.props.props as Cell)
  expect(cells).toContainEqual({ text: 'total ≈$', usd: 2, bold: true })
  await desk.unmount()
})

// The engine measures the ledger late, so the cost of the advisor is read at the end of the
// turn: the growth of the ledger cost that no step holds, since the turn started.
test('the dashboard takes the ledger growth over an advisor turn as the cost of the advisor', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  let ledger = 0
  engine(
    on,
    undefined,
    undefined,
    undefined,
    () => ({ advisorModel: 'opus' }),
    undefined,
    () => ({
      cost: { usd: ledger },
    }),
  )
  paneEngine(on)
  let uses: object[] = []
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield* [] as never[]
    return { ...stepResult(USAGE), turnId: e.turnId, index: e.index, serverToolUses: uses }
  } as never)
  // A side request of an earlier turn: it stays in the side requests row.
  await $.turn.start({ text: 'a', turnId: 't1' })
  await runStep($, { ...STEP, model: 'claude-opus-5-5' } as never)
  ledger = 1
  await $.turn.complete({ turnId: 't1', ...DONE })

  await $.turn.start({ text: 'b', turnId: 't2' })
  uses = [{ id: 's1', name: 'advisor', input: {}, startedAt: 1000, endedAt: 2000 }]
  await runStep($, { ...STEP, turnId: 't2', model: 'claude-opus-5-5' } as never)
  // A measure inside the turn settles nothing: the ledger is behind the steps.
  await measure($, 1.2)
  const open = await mountPane($, 'terminal')
  expect(JSON.stringify(await open.find({ key: 'dash:cost:advisor·opus' }))).toContain('—')
  await open.unmount()
  await clock.advance(1000)
  ledger = 1.63
  await $.turn.complete({ turnId: 't2', ...DONE })
  // A changed cost runs to its new value: let it arrive.
  await clock.advance(SETTLE_MS)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await cellOf(ui, 'dash:cost:advisor·opus')).toContain('≈0.63')
    expect(await cellOf(ui, 'dash:cost:side requests')).toContain('≈1.00')
    await ui.unmount()
  }
})

// The ledger can hold a step before the step's hook has counted it. A measure at that moment
// must not settle: the step's cost would be taken as the advisor's.
test('a measure while a step is in flight does not settle the cost of the advisor', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, () => ({ advisorModel: 'opus' }))
  paneEngine(on)
  const BIG = { ...USAGE, input_tokens: 1e6, model: 'claude-haiku-4-5' }
  let reply: { usage: typeof USAGE; uses: object[]; ledger?: number } = { usage: USAGE, uses: [] }
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield* [] as never[]
    // The ledger moves first.
    if (reply.ledger !== undefined) await measure($, reply.ledger)
    return {
      ...stepResult(reply.usage),
      turnId: e.turnId,
      index: e.index,
      serverToolUses: reply.uses,
    }
  } as never)
  await $.turn.start({ text: 'a', turnId: 't1' })
  reply = {
    usage: USAGE,
    uses: [{ id: 's1', name: 'advisor', input: {}, startedAt: 1000, endedAt: 2000 }],
  }
  await runStep($, { ...STEP, model: 'claude-opus-5-5' } as never)
  // The turn ends and the ledger does not hold the advisor yet.
  await $.turn.complete({ turnId: 't1', ...DONE })
  // A background agent's step of about $1: the ledger has it, and the advisor, before its hook.
  await spawn($)
  reply = { usage: BIG, uses: [], ledger: 1.63 }
  await runStep($, { ...STEP, model: 'claude-haiku-4-5', agentId: 'a1' } as never)
  await measure($, 1.64)

  const ui = await mountPane($, 'terminal')
  expect(JSON.stringify(await ui.find({ key: 'dash:cost:advisor·opus' }))).toContain('≈0.64')
  await ui.unmount()
})

test('an environment variable sets the cache lifetime before the mod option', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, undefined, { FORCE_PROMPT_CACHING_5M: '1' })
  on('turn.step', stepHook(USAGE))
  await runStep($, STEP)
  // The option defaults to 1h.
  expect(await settled($, clock)).toContain('◔ 5:00')
})

test('a session over its plan limit caches the main loop for 5m', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, undefined, undefined, () => ({
    rateLimits: [{ kind: 'five_hour', percentUsed: 100 }],
  }))
  on('turn.step', stepHook(USAGE))
  await runStep($, STEP)
  expect(await settled($, clock)).toContain('◔ 5:00')
})

// A skill that runs in a subagent raises no `agent.spawn`: its steps are the first sign of it.
test('an agent that was not spawned is counted at its first step, once', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))
  await runStep($, { ...STEP, agentId: 'skill1' })
  await runStep($, { ...STEP, index: 1, agentId: 'skill1' })
  expect(await settled($, clock)).toMatch(/▸ agents 1$/)
  // A spawned agent is counted at its spawn, and not again at its steps.
  await spawn($)
  await runStep($, { ...STEP, agentId: 'a1' })
  expect(await settled($, clock)).toMatch(/▸ agents 2$/)
})

test('a spawn that arrives after the first step of its agent does not count it again', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))
  await runStep($, { ...STEP, agentId: 'a1' })
  await spawn($)
  expect(await settled($, clock)).toMatch(/▸ agents 1$/)
})

// A skill that runs in a subagent, typed as `/skill`, raises no turn.start and no turn.complete
// of the main loop: the run of the agent is the working time.
test('the working time covers a run of an agent outside a turn of the main loop', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))
  await runStep($, { ...STEP, agentId: 'skill1' })
  await clock.advance(3000)
  await runStep($, { ...STEP, index: 1, agentId: 'skill1' })
  await clock.advance(2000)
  await completeAgent($, 'skill1')
  await clock.advance(4000)
  expect(await settled($, clock)).toContain('◷ work 0:05')
})

test('a run of an agent inside a turn of the main loop is not counted twice', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))
  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(1000)
  await runStep($, { ...STEP, agentId: 'a1' })
  await clock.advance(2000)
  await completeAgent($, 'a1')
  await clock.advance(1000)
  await $.turn.complete({ ...DONE, turnId: 't1' })
  expect(await settled($, clock)).toContain('◷ work 0:04')
})

test('a killed notification ends the working time of the agent', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))
  await runStep($, { ...STEP, agentId: 'a1' })
  await clock.advance(3000)
  await notify($, 'a1', 'killed')
  await clock.advance(5000)
  expect(await settled($, clock)).toContain('◷ work 0:03')
})

test('the transcript screen shows the context length of the agent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', agentId: 'a1' } as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-haiku-4-5-20251001', agentId: 'a2' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // The detail row of each agent is open at first: the table shows the context length.
    expect(await paneText(ui)).toContain('ctx 100/1M 0%')
    await ui.press({ key: 'agent:a1' })
    expect(await paneText(ui)).toContain('ctx 100/1M 0%')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'agent:a2' })
    expect(await paneText(ui)).toContain('ctx 100/200k 0%')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the 1M disable variable gives a window of 200k', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, undefined, { CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' })
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', agentId: 'a1' } as never)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  expect(await paneText(ui)).toContain('ctx 100/200k 0%')
  await ui.unmount()
})

test('an agent with no step shows no context part', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  expect(await paneText(ui)).not.toContain('ctx ')
  expect(await ui.find({ key: 'meta:sep:ctx' })).toBeUndefined()
  await ui.unmount()
})

test('the detail row of an agent is open at first and the expand button hides and shows it', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', effort: 'high', agentId: 'a1' } as never)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(String((await ui.find({ key: 'expand:a1' }))?.props.label)).toBe('▾')
    const open = await paneText(ui)
    expect(open).toContain('high')
    expect(open).toContain('ctx 100/1M 0%')
    expect(open).toContain('no step yet')

    await ui.press({ key: 'expand:a1' })
    expect(String((await ui.find({ key: 'expand:a1' }))?.props.label)).toBe('▸')
    const closed = await paneText(ui)
    expect(closed).not.toContain('ctx ')
    // The other row stays open.
    expect(closed).toContain('no step yet')

    // A closed row stays closed across a transcript.
    await ui.press({ key: 'agent:a1' })
    await ui.press({ key: 'back' })
    expect(await paneText(ui)).not.toContain('ctx 100/1M 0%')

    await ui.press({ key: 'expand:a2' })
    expect(await paneText(ui)).not.toContain('no step yet')

    await ui.press({ key: 'expand:a1' })
    await ui.press({ key: 'expand:a2' })
    const again = await paneText(ui)
    expect(again).toContain('ctx 100/1M 0%')
    expect(again).toContain('no step yet')
    await ui.unmount()
  }
})

test('the name button still opens the transcript beside the expand button', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'agent:a1' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a click that gives the pane the focus also closes the detail row', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('ui.focus', async () => ({ value: {} }) as never)
  await spawn($)
  const ui = await mountPane($, 'desktop', false)
  const click = (kind: 'person' | 'plugin') =>
    $.ui.focus({
      component: 'Pane',
      requestId: 'agents',
      plugin: 'flight-deck',
      element: 'expand:a1',
      origin: kind === 'person' ? { kind } : { kind, name: 'other' },
    } as never)
  // Another plugin's focus move does not press.
  await click('plugin')
  expect(await paneText(ui)).toContain('no step yet')
  await click('person')
  expect(await paneText(ui)).not.toContain('no step yet')
  await ui.unmount()
})

test('a narrow transcript screen drops the counts of the context, then the context', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-haiku-4-5-20251001', agentId: 'a1' } as never)
  // The row below the title: the model, the runs and the time take 51 cells of the 58 or 46
  // that the terminal's pane has inside its padding.
  const text = async (columns: number) => {
    const ui = await mountPane($, 'terminal', true, columns)
    if ((await ui.find({ key: 'back' })) === undefined) await ui.press({ key: 'agent:a1' })
    const out = await paneText(ui)
    await ui.unmount()
    return out
  }
  expect(await text(80)).toContain('ctx 100/200k 0%')
  const narrow = await text(62)
  expect(narrow).toContain('ctx 0%')
  expect(narrow).not.toContain('100/200k')
  expect(await text(50)).not.toContain('ctx ')
})

test('the detail row is built as an agent row is: the same boxes before its text', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // A desktop sizes a box and a padding in different units: only the same parts line up.
    expect((await ui.find({ key: 'detailrow:a1' }))?.props.paddingLeft).toBeUndefined()
    expect((await ui.find({ key: 'detail:expand:a1' }))?.props.width).toBe(
      (await ui.find({ key: 'expandbox:a1' }))?.props.width,
    )
    await ui.unmount()
  }
})

test('the agents button is at the right end of the band, after a part that takes the free room', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'flight-deck',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, bodyColumns: 200, view: {} } as never,
    })
    const root = (await ui.drawn()) as {
      children: { type: string; props: { flexGrow?: number } }[]
    }
    await ui.unmount()
    expect(root.children.map((c) => c.type)).toEqual(['Text', 'Box', 'Button'])
    expect(root.children[1]?.props.flexGrow).toBe(1)
  }
})

test('a changed context length runs to its new value', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  let usage = USAGE
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield* [] as never[]
    return { ...stepResult(usage), turnId: e.turnId, index: e.index }
  } as never)
  await spawn($)
  const step = () => runStep($, { ...STEP, model: 'claude-sonnet-5-5', agentId: 'a1' } as never)
  await step()
  await clock.advance(SETTLE_MS)
  // 100 100 tokens of input, from 100.
  usage = { ...USAGE, cache_read_input_tokens: 100_080 }
  await step()
  await clock.advance(100)

  // The terminal draws the count on screen: between the old one and the new one.
  const term = await mountPane($, 'terminal')
  const mid = await paneText(term)
  expect(mid).toContain('ctx ')
  expect(mid).not.toContain('ctx 100/1M')
  expect(mid).not.toContain('ctx 100.1k/1M')
  await clock.advance(SETTLE_MS)
  expect(await paneText(term)).toContain('ctx 100.1k/1M 10%')
  // The transcript screen runs the same way.
  await term.press({ key: 'agent:a1' })
  usage = { ...USAGE, cache_read_input_tokens: 300_080 }
  await step()
  await clock.advance(100)
  const midScreen = await paneText(term)
  expect(midScreen).not.toContain('ctx 100.1k/1M')
  expect(midScreen).not.toContain('ctx 300.1k/1M')
  await clock.advance(SETTLE_MS)
  expect(await paneText(term)).toContain('ctx 300.1k/1M 30%')
  await term.press({ key: 'back' })
  await term.unmount()

  // A desktop cell holds the new count and runs to it with its own timer.
  const desk = await mountPane($, 'desktop')
  const cells = (await desk.findAll({ type: 'Client' })).map((c) => c.props.props as Cell)
  expect(cells).toContainEqual({
    text: '',
    ctx: { tokens: 300_100, window: 1_000_000, isFull: true },
    color: '#a9dc76',
  })
  await desk.unmount()
})

test('the text of a detail row is one button, as the name above it is, on each surface', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', effort: 'high', agentId: 'a1' } as never)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // A desktop draws a button's label after a margin of its own, and its font is not
    // fixed-width: one button starts where the name starts and has no room between its parts.
    const lead = await ui.find({ key: 'detail:a1' })
    expect(lead?.type).toBe('Button')
    expect(String(lead?.props.label)).toBe('sonnet-5-5 · high ·')
    // The context length keeps its color: it is a cell after the button, not a button.
    expect((await ui.find({ key: 'detail:ctx:a1' }))?.type).not.toBe('Button')
    expect(await paneText(ui)).toContain('ctx 100/1M 0%')
    // With no context the button has no dot at its end.
    expect(String((await ui.find({ key: 'detail:a2' }))?.props.label)).toBe('no step yet')
    expect(await ui.find({ key: 'detail:ctx:a2' })).toBeUndefined()
    // A press opens the transcript, as a press on the name does.
    await ui.press({ key: 'detail:a1' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a scrolled transcript keeps a bar with the back button, the agent and its context in view', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', agentId: 'a1' } as never)

  // At the top the header itself is in view: no bar.
  const rest = await mountPane($, 'terminal')
  await rest.press({ key: 'agent:a1' })
  expect(await rest.find({ key: 'sticky' })).toBeUndefined()
  await rest.unmount()

  const ui = await mountPane($, 'terminal', true, 80, 12)
  const bar = await ui.find({ key: 'sticky' })
  // The bar is out of the flow, at the first row that the window shows. The terminal draws
  // its title and an empty row above the pane body: two rows less.
  expect(bar?.props).toMatchObject({ position: 'absolute', top: 10, width: '100%' })
  expect(bar?.props.backgroundColor).toBeDefined()
  const text = await paneText(ui)
  expect(text).toContain('← agents')
  expect(text).toContain('agent · a1')
  expect(text).toContain('ctx 100/1M 0%')
  await ui.press({ key: 'sticky:back' })
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  // The agents table has no bar.
  expect(await ui.find({ key: 'sticky' })).toBeUndefined()
  await ui.press({ key: 'agent:a1' })
  await ui.unmount()

  // A desktop scrolls by the pixel and the engine gives an offset in rows: a bar would move
  // with the text between two rows. A desktop has no bar.
  const desk = await mountPane($, 'desktop', true, 80, 12)
  expect(await desk.find({ key: 'back' })).toBeDefined()
  expect(await desk.find({ key: 'sticky' })).toBeUndefined()
  await desk.unmount()
})

test('the bar of a scrolled transcript moves to the new row before the window moves', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('ui.scroll', () => ({}) as never)
  await spawn($)
  const first = await mountPane($, 'terminal')
  await first.press({ key: 'agent:a1' })
  await first.unmount()

  // The tops are two rows less than the offsets: the terminal's title and its empty row.
  const ui = await mountPane($, 'terminal', true, 80, 12)
  const top = async (pane: typeof ui) => (await pane.find({ key: 'sticky' }))?.props.top
  expect(await top(ui)).toBe(10)
  const scroll = (requestId: string, offset: number) =>
    $.ui.scroll({
      component: 'Pane',
      requestId,
      offset,
      by: offset - 12,
      bodyRows: 40,
      contentRows: 200,
      origin: { kind: 'person' },
    } as never)
  // The engine raises the event before it moves the window: the pane still has the old offset.
  await scroll('agents', 20)
  expect(await top(ui)).toBe(18)
  // Until the window is there, a second bar stays at the row the window still shows: a
  // drawing with the window at either row has a bar at its top.
  const from = await ui.find({ key: 'stickyfrom' })
  expect(from?.props).toMatchObject({ position: 'absolute', top: 10 })
  await ui.press({ key: 'stickyfrom:back' })
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  await ui.press({ key: 'agent:a1' })
  // The scroll of another pane changes nothing.
  await scroll('other', 50)
  expect(await top(ui)).toBe(18)
  await ui.unmount()

  // An offset of the engine that is newer than the event wins: the window moved with no event.
  const moved = await mountPane($, 'terminal', true, 80, 30)
  expect(await top(moved)).toBe(28)
  // The window is at its row: one bar.
  expect(await moved.find({ key: 'stickyfrom' })).toBeUndefined()
  await moved.unmount()

  // A scroll of a desktop pane draws no bar.
  const desk = await mountPane($, 'desktop', true, 80, 12)
  await scroll('agents', 20)
  expect(await desk.find({ key: 'sticky' })).toBeUndefined()
  expect(await desk.find({ key: 'stickyfrom' })).toBeUndefined()
  await desk.unmount()
})

test('a scroll of the transcript waits for the pane to draw the bar at its new row', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  // What the pane has drawn when the engine moves the window.
  let ui: Awaited<ReturnType<typeof mountPane>> | null = null
  let topAtMove: unknown = 'not moved'
  on('ui.scroll', async () => {
    topAtMove = (await ui?.find({ key: 'sticky' }))?.props.top
    return {} as never
  })
  await spawn($)
  const first = await mountPane($, 'terminal')
  await first.press({ key: 'agent:a1' })
  await first.unmount()
  ui = await mountPane($, 'terminal', true, 80, 12)
  await $.ui.scroll({
    component: 'Pane',
    requestId: 'agents',
    offset: 13,
    by: 1,
    bodyRows: 40,
    contentRows: 200,
    origin: { kind: 'person' },
  } as never)
  // Two rows less on the terminal: its title and the empty row.
  expect(topAtMove).toBe(11)
  await ui.unmount()
})

// A pane that is dragged to another width is drawn there at once, before the hook answers: the
// engine lays the last tree out again. So the terminal's tree takes no width from the columns
// of the pane: the layout gives a row its width, and the tree of one width is right at another.
test('the terminal pane is the same tree at each width', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  on('turn.step', stepHook(USAGE) as never)
  await runStep($, { ...STEP, model: 'claude-opus-5-5' } as never)
  await spawn($)
  await runStep($, { ...STEP, model: 'claude-sonnet-5-5', effort: 'high', agentId: 'a1' } as never)
  await completeAgent($, 'a1')
  await clock.advance(SETTLE_MS)

  // Wide enough that no text is cut and no part is dropped at either width.
  const drawnAt = async (columns: number, scrollOffset = 0) => {
    const ui = await mountPane($, 'terminal', true, columns, scrollOffset)
    // Each mount gives a button a handle of its own: it is no part of the tree's shape.
    const tree = JSON.stringify(await ui.drawn()).replace(/"handle":\d+/g, '"handle":0')
    await ui.unmount()
    return tree
  }
  expect(await drawnAt(121)).toBe(await drawnAt(120))

  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  await ui.unmount()
  expect(await drawnAt(121)).toBe(await drawnAt(120))
  // A scrolled transcript has a bar at its top: it spans the pane at each width too.
  expect(await drawnAt(121, 5)).toBe(await drawnAt(120, 5))
})

// The engine draws the first 100,000 characters of a tree, in the order written, and the bar of
// a scrolled transcript is the last part of the tree: a later part is drawn over an earlier one.
// So the pane draws the newest items that fit below that limit, and the bar is not cut.
test('a transcript longer than the engine draws keeps its newest items and its bar', async ($, on) => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    role: 'assistant',
    text: `item ${i} ${'x'.repeat(4000)}`,
    toolUses: [],
  }))
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on, () => rows)
  await spawn($)

  const first = await mountPane($, 'terminal')
  await first.press({ key: 'agent:a1' })
  await first.unmount()
  const ui = await mountPane($, 'terminal', true, 80, 12)
  const text = await paneText(ui)
  expect(text.length).toBeLessThan(100_000)
  expect(text).toContain('item 59 ')
  expect(text).not.toContain('item 0 ')
  expect(text).toMatch(/\.\.\. \d+ older items hidden/)
  expect(await ui.find({ key: 'sticky' })).toBeDefined()
  await ui.press({ key: 'sticky:back' })
  await ui.unmount()
})

// A usage reply with a breakdown: 31.4k of overhead, 52.8k of messages, two MCP servers.
const CONTEXT = {
  tokens: 84200,
  window: 200000,
  breakdown: {
    categories: [
      { name: 'System prompt', tokens: 3200, kind: 'used' },
      { name: 'System tools', tokens: 8100, kind: 'used' },
      { name: 'MCP tools', tokens: 14200, kind: 'used' },
      { name: 'Memory files', tokens: 4000, kind: 'used' },
      { name: 'Skills', tokens: 1900, kind: 'used' },
      { name: 'Messages', tokens: 52800, kind: 'used' },
      { name: 'Free space', tokens: 82800, kind: 'free' },
    ],
    totalTokens: 84200,
    mcpTools: [
      { name: 'mcp__figma__get', serverName: 'figma', tokens: 6000, isLoaded: true },
      { name: 'mcp__figma__set', serverName: 'figma', tokens: 3800, isLoaded: true },
      { name: 'mcp__chrome__click', serverName: 'chrome', tokens: 1800, isLoaded: true },
    ],
    memoryFiles: [{ path: '/repo/CLAUDE.md', type: 'Project', tokens: 4000 }],
    agents: [],
    skills: { skillFrontmatter: [{ name: 'docs', tokens: 1900 }] },
    autoCompactThreshold: 167000,
    isAutoCompactEnabled: true,
  },
}

// The engine with a usage that has the breakdown above.
const contextEngine = (on: Parameters<typeof mock.store>[0]) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on, undefined, undefined, undefined, undefined, {}, () => ({ context: CONTEXT }))
  paneEngine(on)
}

const turn = async ($: Engine, turnId: string) => {
  await $.turn.start({ text: 'hi', turnId })
  await $.turn.complete({ ...DONE, turnId })
}

test('the agents screen shows the context block after a turn', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const text = await paneText(ui)
    expect(text).toContain('ctx 84.2k/200k 42%')
    expect(text).toContain('█'.repeat(40))
    expect(text).toContain('overhead 31.4k')
    expect(text).toContain('messages 52.8k')
    expect(text).toContain('dead weight 11.6k')
    await ui.unmount()
  }
})

test('a called MCP server is not dead weight', async ($, on) => {
  contextEngine(on)
  await $.tool.call({ tool: 'mcp__figma__get' } as never)
  await turn($, 't1')
  const ui = await mountPane($, 'terminal')
  const text = await paneText(ui)
  expect(text).toContain('dead weight 1.8k')
  await ui.unmount()
})

test('a usage with no breakdown draws no context block', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).not.toContain('overhead')
    await ui.unmount()
  }
})

test('the context button opens the context screen and back returns', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await paneText(ui)).not.toContain('share(%)')
    await ui.press({ key: 'context' })
    const text = await paneText(ui)
    // The press read a full breakdown.
    expect(text).toContain('full')
    expect(text).toContain('ctx 84.2k/200k 42%')
    expect(text).toContain('overhead 31.4k')
    expect(text).toContain('16% of window')
    expect(text).toContain('share(%)')
    expect(text).toContain('▸ MCP tools')
    expect(text).toContain('14.2k')
    expect(text).toContain('45%')
    // The model of the test has no price.
    expect(text).toContain('—')
    expect(text).toContain('dead weight 11.6k')
    expect(text).toContain('figma')
    // The agents table is not on this screen.
    expect(text).not.toContain('No agents yet.')

    await ui.press({ key: 'recount' })
    expect(await paneText(ui)).toContain('share(%)')

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'context' })).toBeDefined()
    expect(await paneText(ui)).not.toContain('share(%)')
    await ui.unmount()
  }
})

test('a category row opens and closes its items', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'context' })
    expect(await paneText(ui)).not.toContain('figma · 2 tools')
    await ui.press({ key: 'cat:MCP tools' })
    const open = await paneText(ui)
    expect(open).toContain('▾ MCP tools')
    expect(open).toContain('figma · 2 tools')
    expect(open).toContain('chrome · 1 tools')
    await ui.press({ key: 'cat:MCP tools' })
    expect(await paneText(ui)).not.toContain('figma · 2 tools')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the context screen stays one row wide in a narrow pane', async ($, on) => {
  contextEngine(on)
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, true, 20)
    await ui.press({ key: 'context' })
    await ui.press({ key: 'cat:MCP tools' })
    const widths = (await ui.findAll({ type: 'Box' }))
      .map((b) => b.props.width)
      .filter((w): w is number => typeof w === 'number')
    expect(widths.every((w) => w >= 0)).toBe(true)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a short rule parts a new prompt from the turn before it', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on, () => [...ROWS, { role: 'user', text: 'Now the words.', toolUses: [] }])
  await spawn($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'agent:a1' })
    expect(await paneText(ui)).toContain('> Now the words.')
    // The items are a prompt, a tool call, an answer and the new prompt. The first prompt
    // has no turn before it.
    expect(await ui.find({ key: 'turn:0' })).toBe(undefined)
    const rule = await ui.find({ key: 'turn:3' })
    expect(rule?.props.height).toBe(1)
    expect(rule?.text).toBe('─'.repeat(12))
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

// Records the messages that the plugin sends, and answers each with `result`.
const sendEngine = (
  on: Parameters<typeof mock.store>[0],
  result: () => object = () => ({ isDelivered: true }),
) => {
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    sent.push({ to: JSON.stringify(e.to), text: e.text })
    return result() as never
  })
  return sent
}

test('the message button of an agent opens a field, and Enter sends its text', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  const sent = sendEngine(on)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'msg:a1' }))?.props.label).toBe('» message')
    expect(await ui.find({ key: 'say:a1' })).toBeUndefined()
    await ui.press({ key: 'msg:a1' })
    expect((await ui.find({ key: 'say:a1' }))?.type).toBe('Input')
    await ui.input({ key: 'say:a1', text: 'stop after this file' })
    expect(sent.at(-1)?.text).toBe('stop after this file')
    expect(sent.at(-1)?.to).toContain('a1')
    // A sent message closes the field.
    expect(await ui.find({ key: 'say:a1' })).toBeUndefined()
    await ui.unmount()
  }
  expect(sent).toHaveLength(2)
})

test('a message that is not sent shows the reason and keeps its text', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  sendEngine(on, () => ({
    isDelivered: false,
    reason: 'The server-side auto mode classifier gave no verdict for SendMessage',
  }))
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    if ((await ui.find({ key: 'say:a1' })) === undefined) await ui.press({ key: 'msg:a1' })
    await ui.input({ key: 'say:a1', text: 'hello' })
    expect(await paneText(ui)).toContain('not sent: add "SendMessage" to permissions.allow')
    expect((await ui.find({ key: 'say:a1' }))?.props.value).toBe('hello')
    // An empty message is not sent, and it leaves the reason of the last one.
    await ui.input({ key: 'say:a1', text: '  ' })
    await ui.unmount()
  }
})

test('the stop button stops a running agent on its second press', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  const stops: unknown[] = []
  engine(on, undefined, (e) => {
    stops.push(e)
    return { result: {} as never, text: 'ok' }
  })
  paneEngine(on)
  await spawn($)
  await spawn($)
  await completeAgent($, 'a2')

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // An agent that does not run has no stop button.
    expect(await ui.find({ key: 'stop:a2' })).toBeUndefined()
    expect((await ui.find({ key: 'stop:a1' }))?.props.label).toBe('■ stop')
    await ui.press({ key: 'stop:a1' })
    expect((await ui.find({ key: 'stop:a1' }))?.props.label).toBe('■ stop?')
    expect(stops).toHaveLength(surface === 'terminal' ? 0 : 1)
    await ui.press({ key: 'stop:a1' })
    expect(stops.at(-1)).toMatchObject({ tool: 'TaskStop', task_id: 'a1' })
    expect((await ui.find({ key: 'stop:a1' }))?.props.label).toBe('■ stop')
    await ui.unmount()
  }
  expect(stops).toHaveLength(2)
})

test('a narrow pane draws the control buttons as icons', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, true, 24)
    expect((await ui.find({ key: 'msg:a1' }))?.props.label).toBe('»')
    expect((await ui.find({ key: 'stop:a1' }))?.props.label).toBe('■')
    await ui.unmount()
  }
})

test('the transcript screen has a message field and a stop button', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  const sent = sendEngine(on)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'agent:a1' })
    expect((await ui.find({ key: 'stop:a1' }))?.props.label).toBe('■ stop')
    // The message button moves the focus to the field: it opens no second field.
    await ui.press({ key: 'msg:a1' })
    expect(await ui.findAll({ type: 'Input' })).toHaveLength(1)
    await ui.input({ key: 'say:a1', text: 'one more thing' })
    expect(sent.at(-1)?.text).toBe('one more thing')
    // The field stays on the transcript screen, empty.
    expect((await ui.find({ key: 'say:a1' }))?.props.value).toBe('')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the bar of a scrolled transcript has the message and the stop buttons', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  const stops: unknown[] = []
  engine(on, undefined, (e) => {
    stops.push(e)
    return { result: {} as never, text: 'ok' }
  })
  paneEngine(on)
  await spawn($)

  let ui = await mountPane($, 'terminal')
  await ui.press({ key: 'agent:a1' })
  await ui.unmount()
  ui = await mountPane($, 'terminal', true, 80, 12)
  expect((await ui.find({ key: 'sticky:msg:a1' }))?.props.label).toBe('» message')
  expect((await ui.find({ key: 'sticky:stop:a1' }))?.props.label).toBe('■ stop')
  await ui.press({ key: 'sticky:stop:a1' })
  expect((await ui.find({ key: 'sticky:stop:a1' }))?.props.label).toBe('■ stop?')
  await ui.press({ key: 'sticky:stop:a1' })
  expect(stops.at(-1)).toMatchObject({ tool: 'TaskStop', task_id: 'a1' })
  // The controls are a row of their own, below the row of the back button.
  expect((await ui.find({ key: 'sticky:controls' }))?.type).toBe('Box')
  await ui.unmount()
  // A narrow bar draws them as icons.
  ui = await mountPane($, 'terminal', true, 20, 12)
  expect((await ui.find({ key: 'sticky:msg:a1' }))?.props.label).toBe('»')
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('a running agent counts its run before the run ends', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await cellOf(ui, 'runs:a1')).trim()).toContain('1')
    await ui.press({ key: 'agent:a1' })
    expect(await paneText(ui)).toContain('1 run')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a stop that the engine refuses shows the reason, and no stop is a tool call of the session', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  let isDenied = true
  engine(on, undefined, () =>
    isDenied ? { deny: 'TaskStop is not allowed.' } : { result: {} as never, text: 'ok' },
  )
  paneEngine(on)
  await spawn($)

  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'stop:a1' })
  await ui.press({ key: 'stop:a1' })
  expect(await paneText(ui)).toContain('not stopped: TaskStop is not allowed.')
  isDenied = false
  await ui.press({ key: 'stop:a1' })
  await ui.press({ key: 'stop:a1' })
  expect(await paneText(ui)).not.toContain('not stopped')
  await ui.unmount()
  expect(await settled($, clock)).toContain('⌘ calls 0')
})

test('the message field of the tree closes when the transcript opens', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)

  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'msg:a1' })
  await ui.press({ key: 'agent:a1' })
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'say:a1' })).toBeUndefined()
  await ui.unmount()
})

test('the end of a stopped tool call, after the end of the run, does not run the agent again', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  let release: () => void = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  engine(on, undefined, async () => {
    await held
    return { result: {} as never, text: 'Exit code 137', isError: true }
  })
  paneEngine(on)
  await spawn($)
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 40', agentId: 'a1' } as never)
  await new Promise((r) => setTimeout(r, 10))
  await $.turn.complete({ ...DONE, isAborted: true, reason: 'aborted', agentId: 'a1' } as never)
  release()
  await call

  const ui = await mountPane($, 'terminal')
  expect(await marks(ui)).toMatchObject([STOPPED])
  expect((await cellOf(ui, 'runs:a1')).trim()).toContain('1')
  expect(await ui.find({ key: 'stop:a1' })).toBeUndefined()
  await ui.unmount()
})

test('a stop button forgets its question when the agent ends', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  const stops: unknown[] = []
  engine(on, undefined, (e) => {
    if ((e as { tool: string }).tool === 'TaskStop') stops.push(e)
    return { result: {} as never, text: 'ok' }
  })
  paneEngine(on)
  await spawn($)

  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'stop:a1' })
  await completeAgent($, 'a1')
  // The agent runs again: the first press asks again.
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'a1' } as never)
  expect((await ui.find({ key: 'stop:a1' }))?.props.label).toBe('■ stop')
  await ui.press({ key: 'stop:a1' })
  expect(stops).toHaveLength(0)
  await ui.unmount()
})

test('a tool call of a loop that the session does not list adds no agent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  paneEngine(on)
  await spawn($)
  // An inner loop of the engine: it raises tool calls under an id, with no spawn and no step.
  await $.tool.call({ tool: 'Read', file_path: 'a.md', agentId: 'ghost' } as never)

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:ghost' })).toBeUndefined()
  await ui.unmount()
})
