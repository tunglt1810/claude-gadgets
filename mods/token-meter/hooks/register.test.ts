import { type Engine, expect, mock, test } from 'claude-code/testing'

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
    plugin: 'token-meter',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 200, view: { agentId } } as never,
  })
  const root = await ui.find({ type: 'Text' })
  await ui.unmount()
  return root?.text ?? ''
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
  toolResult: () => object = () => ({ result: {} as never, text: 'ok' }),
  isSpawnRefused: () => boolean = () => false,
) => {
  on('session.id', () => ({ value: id() }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => toolResult() as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
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

test('turn.step accumulates usage and shows cache hit', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  await runStep($, { ...STEP, index: 1 })

  const text = await settled($, clock)
  expect(text).toContain('↑ in 200')
  expect(text).toContain('↓ out 10')
  expect(text).toContain('◈ hit 80%')
  expect(text).toContain('◔ cache 5:00')
})

test('a subagent step adds tokens but does not extend the countdown', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  await clock.advance(10_000)
  await runStep($, { ...STEP, agentId: 'sub1' })

  const text = await settled($, clock)
  expect(text).toContain('↑ in 200')
  expect(text).toContain('◔ cache 4:50')
})

test('a step without usage changes nothing and never produces NaN', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(null))

  await runStep($, STEP)

  const text = await settled($, clock)
  expect(text).toContain('↑ in 0')
  expect(text).toContain('◔ cache --')
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

test('the countdown changes tone and expires', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)
  on('turn.step', stepHook(USAGE))

  await runStep($, STEP)
  await clock.advance(250_000)
  expect(await settled($, clock)).toContain('◔ cache 0:50')
  await clock.advance(310_000)
  expect(await settled($, clock)).toContain('◔ cache expired')
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

  expect(await settled($, clock)).toContain('◔ cache 60:00')
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

test('the band shows the stored session before any event happens', async ($, on) => {
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
  expect(text).toContain('◔ cache 4:56')
})

test('the countdown starts when the request was sent, not when the response ended', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, {})
  engine(on)
  on('turn.step', async function* (_$, e) {
    yield* [] as never[]
    await clock.advance(100_000)
    return { ...stepResult(USAGE), turnId: e.turnId, index: e.index }
  })

  await runStep($, STEP)

  expect(await settled($, clock)).toContain('◔ cache 3:20')
})

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

test('session.start starts the tick for a session with a live cache', async ($, on) => {
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

  expect(await settled($, clock)).toContain('◔ cache 4:50')
})

test('the band is one Text row, not a Box, so the engine adds no extra row', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {})
  engine(on)

  const ui = await $.ui.mount({
    plugin: 'token-meter',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, view: {} } as never,
  })
  const root = await ui.drawn()
  await ui.unmount()

  expect(root.type).toBe('Text')
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

  expect(await settled($, clock)).toContain('◆ agents 2 ')
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
  test(`an agent's transcript shows that agent and the agents below it (${surface})`, async ($, on) => {
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
    expect(sub).toContain('◆ agent │ ↑ in 200 ')
    expect(sub).toContain('↓ out 10 ')
    expect(sub).toContain('⌘ calls 1 ')
    expect(sub).toContain('± diff +1 -1 ')
    // The agent's own cache: its step was sent 10s after the main one.
    expect(sub).toContain('◔ cache 5:00')
    expect(sub).not.toContain('$ cost')

    const main = await bandText($, surface)
    expect(main).toContain('↑ in 400 ')
    expect(main).toContain('◆ agents 3 ')
    expect(main).toContain('◔ cache 4:50')
  })
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
  expect(await settled($, clock)).toContain('◆ agents 0 ')

  id = 'S1'
  const back = await settled($, clock)
  expect(back).toContain('◆ agents 1 ')
  expect(back).toContain('◇ bg 1 ')
  expect(await bandText($, 'terminal', 'a1')).toContain('◆ agent │ ↑ in 100 ')
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
  expect(await bandText($, 'terminal', 'a1')).toContain('◔ cache 3:10')

  await clock.advance(60_000)
  expect(await bandText($, 'terminal', 'a1')).toContain('◔ cache 2:10')
})
