import { type Engine, expect, type mock, test } from 'claude-code/testing'

type On = Parameters<typeof mock.store>[0]

const BACKDROP = { scene: 'glyph-tide', plugin: 'glyph-tide', glass: { blur: 16, opacity: 0.6 } }

// The engine's answers beneath the plugin: what the theme calls and a session start got.
function engine(on: On, rows: unknown[] = []) {
  const calls: string[] = []
  const sets: unknown[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: rows }) as never)
  on('theme.set', (_$, e) => {
    calls.push('set')
    sets.push(e)
    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('theme.clear', () => {
    calls.push('clear')
    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return { calls, sets }
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

async function backdropSvg($: Engine, surface: 'desktop' | 'mobile', props: object = BACKDROP) {
  const ui = await $.ui.mount({
    plugin: 'glyph-tide',
    surface,
    component: 'Backdrop',
    props,
  } as never)
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return svg
}

test('the session starts with the glyph backdrop', async ($, on) => {
  const { sets } = engine(on)
  await start($)
  expect(sets).toEqual([{ backdrop: { scene: 'glyph-tide' } }])
})

test('the backdrop draws the scene on desktop and mobile', async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['desktop', 'mobile'] as const) {
    const svg = await backdropSvg($, surface)
    expect(String(svg?.props.source)).toContain('xMidYMid slice')
    // An Svg without it is drawn as an image, and its waves do not move.
    expect(svg?.props.isInteractive).toBe(true)
  }
})

test("another plugin's backdrop is left alone", async ($, on) => {
  engine(on)
  await start($)
  const svg = await backdropSvg($, 'desktop', { ...BACKDROP, scene: 'lagoon', plugin: 'other' })
  expect(svg).toBeUndefined()
})

test('the backdrop stays after a prompt by default', async ($, on) => {
  const { calls } = engine(on)
  await start($)
  await $.prompt.submit({ text: 'hi' } as never)
  expect(calls).toEqual(['set'])
})

test(
  'the backdrop goes after the first prompt when the option is on',
  { options: { hideAfterPrompt: true } },
  async ($, on) => {
    const { calls } = engine(on)
    await start($)
    await $.prompt.submit({ text: 'hi' } as never)
    await $.prompt.submit({ text: 'again' } as never)
    expect(calls).toEqual(['set', 'clear'])
  },
)

test(
  'a resumed session with messages gets no backdrop when the option is on',
  { options: { hideAfterPrompt: true } },
  async ($, on) => {
    const { calls } = engine(on, [{ type: 'user' }])
    await start($)
    expect(calls).toEqual([])
  },
)

test('motion off draws a still scene', { options: { motion: false } }, async ($, on) => {
  engine(on)
  await start($)
  const svg = await backdropSvg($, 'desktop')
  expect(String(svg?.props.source)).not.toContain('@keyframes')
})
