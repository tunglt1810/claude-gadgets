import { expect, test } from 'claude-code/testing'
import { bandSegments, statSegments } from './layout'
import { PALETTE } from './palette'
import type { Snapshot } from './snapshot'

const snap: Snapshot = {
  totals: { input: 12400, output: 3100, cacheRead: 80, cacheWrite: 10 },
  tools: 14,
  lastStepAt: 0,
  workMs: 725_000,
  costUsd: 0.416,
  added: 120,
  removed: 30,
  agents: 2,
  bg: 1,
  byAgent: {},
  byModel: {},
  costByModel: {},
  advisor: { calls: 0, ms: 0, usd: 0, base: 0 },
}
const base = { snap, busySince: null, now: 78_000, ttl: '5m' as const }
const segs = (cols: number) => bandSegments({ ...base, columns: cols })
const text = (cols: number) =>
  segs(cols)
    .map((s) => s.text)
    .join('')

test('every metric is icon, label, value', () => {
  const t = text(146)
  expect(t).toContain('↑ in 12.5k')
  expect(t).toContain('↓ out 3.1k')
  expect(t).toContain('◈ cache 1%')
  expect(t).toContain('⌘ calls 14')
  expect(t).toContain('◷ work 12:05')
  expect(t).toContain('$ cost 0.42')
  expect(t).toContain('± diff +120 -30')
  expect(t).toContain('◔ 3:42')
  // The countdown is its time alone: the band draws no bar.
  expect(t).not.toContain('━')
})

test('every metric uses the same spacing: one icon, a space, the label, a space, the value', () => {
  const metrics = segs(146).filter((s) => /^\S \S/.test(s.text))
  expect(metrics.length).toBe(10)
  // Beside the percentage, the countdown is the clock and the time, with no label.
  for (const m of metrics)
    expect(m.text).toMatch(m.text.startsWith('◔') ? /^◔ \S+$/ : /^\S [a-z]+ \S+$/)
})

test('metrics are grouped: tokens | cache | activity | spend', () => {
  expect(text(146).split(' │ ')).toEqual([
    '↑ in 12.5k  ↓ out 3.1k',
    '◈ cache 1%  ◔ 3:42',
    '⌘ calls 14  ◇ bg 1  ◷ work 12:05',
    '$ cost 0.42  ± diff +120 -30  ▸ agents 2',
  ])
})

test('a band with no room for the percentage gives the countdown its label', () => {
  expect(text(100).split(' │ ')[1]).toBe('◈ cache 1%  ◔ 3:42')
  expect(text(99).split(' │ ')).toEqual([
    '↑ in 12.5k  ↓ out 3.1k',
    '◔ cache 3:42',
    '⌘ calls 14  ◷ work 12:05',
    '$ cost 0.42  ▸ agents 2',
  ])
})

test('no emoji-presentation characters: they are double width and misalign the row', () => {
  expect(text(120)).not.toMatch(/\p{Emoji_Presentation}/u)
})

test('the band never exceeds the width it is given and never starts or ends with a separator', () => {
  for (const cols of [120, 80, 70, 60, 40, 30, 20]) {
    const t = text(cols)
    expect(t.length).toBeLessThanOrEqual(cols)
    expect(t.startsWith(' │')).toBe(false)
    expect(t.endsWith('│ ')).toBe(false)
    expect(t).not.toMatch(/^ | $/)
  }
})

test('narrow widths drop bg first, then diff, hit, calls, work, cost, output, input, agents', () => {
  expect(text(129)).toContain('◇ bg')
  expect(text(124)).not.toContain('◇ bg')
  expect(text(126)).toContain('diff')
  expect(text(110)).not.toContain('diff')
  expect(text(110)).toContain('◈ cache')
  expect(text(94)).not.toContain('◈')
  expect(text(94)).toContain('calls')
  expect(text(84)).not.toContain('calls')
  expect(text(84)).toContain('work')
  expect(text(70)).not.toContain('work')
  expect(text(70)).toContain('cost')
  expect(text(60)).not.toContain('cost')
  expect(text(60)).toContain('out')
  expect(text(45)).not.toContain('out')
  expect(text(45)).toContain('in')
  expect(text(30)).not.toContain('↑ in')
  expect(text(30)).toContain('agents')
  expect(text(20)).toBe('◔ cache 3:42')
})

test('cost is yellow; added lines are green and removed lines red', () => {
  const all = segs(126)
  expect(all.find((s) => s.text === '$ cost 0.42')?.color).toBe(PALETTE.yellow)
  expect(all.find((s) => s.text === '± diff +120')?.color).toBe(PALETTE.green)
  expect(all.find((s) => s.text === ' -30')?.color).toBe(PALETTE.red)
})

test('colors come from the Monokai Pro palette', () => {
  const all = segs(120)
  const colors = new Set(all.map((s) => s.color).filter(Boolean))
  for (const c of colors) expect(Object.values(PALETTE)).toContain(c)
  expect(all.find((s) => s.text === '↑ in 12.5k')?.color).toBe(PALETTE.cyan)
  expect(all.find((s) => s.text === '↓ out 3.1k')?.color).toBe(PALETTE.purple)
})

test('group separators are dim', () => {
  const sep = segs(120).find((s) => s.text === ' │ ')
  expect(sep?.color).toBe(PALETTE.dim)
})

test('the countdown color follows the remaining time', () => {
  const cache = (now: number) =>
    bandSegments({ ...base, now, columns: 120 }).find((s) => s.text.startsWith('◔ '))
  expect(cache(0)?.color).toBe(PALETTE.green)
  expect(cache(250_000)?.color).toBe(PALETTE.yellow)
  expect(cache(290_000)?.color).toBe(PALETTE.red)
  expect(cache(400_000)?.color).toBe(PALETTE.dim)
})

test('an expired cache is dim text alone: no strikethrough', () => {
  const expired = bandSegments({ ...base, now: 400_000, columns: 200 })
  expect(expired.some((s) => 'strike' in s)).toBe(false)
  const row = expired.map((s) => s.text).join('')
  expect(row).toContain('◔ expired')
  // The button's `[ ]` takes four cells.
  const fitted = bandSegments({ ...base, now: 400_000, columns: row.length + 4 })
  expect(fitted.map((s) => s.text).join('')).toBe(row)
})

const target = { in: 12490, out: 3100, tools: 14, cost: 0.416, added: 120, removed: 30 }

test('animated counts replace the numbers that are drawn', () => {
  const shown = { in: 999, out: 2000, tools: 13, cost: 0.2, added: 100, removed: 20 }
  const t = bandSegments({ ...base, columns: 126, shown })
    .map((s) => s.text)
    .join('')
  expect(t).toContain('↑ in 999')
  expect(t).toContain('↓ out 2.0k')
  expect(t).toContain('⌘ calls 13')
  expect(t).toContain('$ cost 0.20')
  expect(t).toContain('± diff +100 -20')
  expect(t).toContain('◈ cache 1%')
})

test('parts are dropped by the target values, so a part does not come and go during a tween', () => {
  // One cell short of the whole band: the button's `[ ]` takes four cells.
  const columns = text(200).length + 3
  expect(text(columns)).not.toContain('◇ bg')
  // `999` is narrower than `12.5k`: with it the bg would fit, but the target does not.
  const t = bandSegments({ ...base, columns, shown: { ...target, in: 999 } })
    .map((s) => s.text)
    .join('')
  expect(t).toContain('↑ in 999')
  expect(t).not.toContain('◇ bg')
})

test('the background count is the first metric dropped', () => {
  const full = text(200)
  expect(full).toContain('▸ agents 2')
  expect(full).toContain('◇ bg 1')
  const narrow = text(full.length + 3)
  expect(narrow).not.toContain('◇ bg')
  expect(narrow).toContain('▸ agents 2')
  expect(narrow).toContain('± diff')
})

test('an agent view is marked and leaves out the session-only metrics', () => {
  const t = bandSegments({ ...base, columns: 200, isAgentView: true })
    .map((s) => s.text)
    .join('')
  expect(t.startsWith('◆ agent │ ↑ in 12.5k')).toBe(true)
  expect(t).toContain('⌘ calls 14')
  expect(t).toContain('± diff +120 -30')
  expect(t).toContain('◈ cache 1%  ◔ 3:42')
  for (const gone of ['$ cost', '◷ work', '▸ agents', '◇ bg']) expect(t).not.toContain(gone)
})

test('agents is the last part the band drops', () => {
  // Wide enough for the agents button and the cache countdown only. The button is drawn
  // as `[ label ]`: its four cells of chrome count toward the width.
  const fit = '◔ cache 3:42  [ ▸ agents 2 ]'.length
  expect(text(fit)).toBe('◔ cache 3:42  ▸ agents 2')
  expect(text(fit - 1)).toBe('◔ cache 3:42')
})

test('only the agents segment is the button', () => {
  expect(
    segs(200)
      .filter((s) => s.isButton)
      .map((s) => s.text),
  ).toEqual(['▸ agents 2'])
})

test('an open pane marks the button', () => {
  const t = bandSegments({ ...base, columns: 200, isPaneOpen: true })
    .filter((s) => s.isButton)
    .map((s) => s.text)
  expect(t).toEqual(['▾ agents 2'])
})

test('the stats of an agent are its tokens, cache hit, calls and diff, with no cost', () => {
  const snap = {
    totals: { input: 1000, output: 2500, cacheRead: 9000, cacheWrite: 0 },
    tools: 7,
    lastStepAt: null,
    workMs: 0,
    costUsd: 0,
    added: 12,
    removed: 3,
    agents: 0,
    bg: 0,
    byAgent: {},
    byModel: {},
    costByModel: {},
    advisor: { calls: 0, ms: 0, usd: 0, base: 0 },
  } satisfies Snapshot
  const text = statSegments(snap)
    .map((s) => s.text)
    .join('')
  expect(text).toBe('↑ in 10.0k  ↓ out 2.5k  ◈ cache 90%  ⌘ calls 7  ± diff +12 -3')
})

test('an agent view names the model and the effort after its mark', () => {
  const t = bandSegments({
    ...base,
    columns: 200,
    isAgentView: true,
    model: 'claude-sonnet-5-5 high',
  })
    .map((s) => s.text)
    .join('')
  expect(t.startsWith('◆ agent claude-sonnet-5-5 high │ ↑ in 12.5k')).toBe(true)
})

test('the agents button is the last part of the band, after a gap and no separator', () => {
  for (const cols of [146, 110, 60, 30]) {
    const all = segs(cols)
    expect(all.at(-1)?.isButton).toBe(true)
    expect(all.at(-2)?.text).toBe('  ')
  }
})

const agentBand = (columns: number, extra: object = {}) =>
  bandSegments({
    ...base,
    columns,
    isAgentView: true,
    model: 'claude-sonnet-5-5 high',
    name: 'Explore · find the window api',
    context: { tokens: 182_400, window: 1_000_000 },
    ...extra,
  })

test('an agent view names the agent and shows its context length first', () => {
  const t = agentBand(200)
    .map((s) => s.text)
    .join('')
  expect(t.split(' │ ').slice(0, 3)).toEqual([
    '◆ Explore · find the window api claude-sonnet-5-5 high',
    'ctx 182.4k/1M 18%',
    '↑ in 12.5k  ↓ out 3.1k',
  ])
})

test('the context length of an agent view has the color of its percentage', () => {
  const ctx = (tokens: number) =>
    agentBand(200, { context: { tokens, window: 200_000 } }).find((s) => s.text.startsWith('ctx '))
  expect(ctx(10)?.color).toBe(PALETTE.green)
  expect(ctx(100_000)?.color).toBe(PALETTE.yellow)
  expect(ctx(170_000)?.color).toBe(PALETTE.red)
})

test('the name of an agent view takes only the room that the band has left', () => {
  const row = (columns: number) =>
    agentBand(columns)
      .map((s) => s.text)
      .join('')
  // The name is cut, and no part is dropped for it.
  const whole = row(200).length
  const cut = row(whole - 10)
  expect(cut.length).toBeLessThanOrEqual(whole - 10)
  expect(cut).toContain('◆ Explore · find the… claude-sonnet-5-5 high')
  expect(cut).toContain('± diff +120 -30')
  // With no room for a name, the mark says `agent` as it does with no name.
  const bare = row(whole - 'Explore · find the window api'.length + 'agent'.length)
  expect(bare.startsWith('◆ agent claude-sonnet-5-5 high │ ctx 182.4k/1M 18% │')).toBe(true)
  expect(bare).toContain('± diff +120 -30')
})

test('a narrow agent view keeps the context length after the tokens are dropped', () => {
  const t = agentBand(70)
    .map((s) => s.text)
    .join('')
  expect(t).toContain('ctx 182.4k/1M 18%')
  expect(t).not.toContain('↓ out')
  expect(t.length).toBeLessThanOrEqual(70)
})

test('the band of the session has no context length', () => {
  expect(text(200)).not.toContain('ctx ')
})
