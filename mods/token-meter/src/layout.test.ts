import { expect, test } from 'claude-code/testing'
import { bandSegments } from './layout'
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
}
const base = { snap, busySince: null, now: 78_000, ttl: '5m' as const }
const segs = (cols: number) => bandSegments({ ...base, columns: cols })
const text = (cols: number) =>
  segs(cols)
    .map((s) => s.text)
    .join('')

test('every metric is icon, label, value', () => {
  const t = text(140)
  expect(t).toContain('↑ in 12.5k')
  expect(t).toContain('↓ out 3.1k')
  expect(t).toContain('◈ hit 1%')
  expect(t).toContain('⌘ calls 14')
  expect(t).toContain('◷ work 12:05')
  expect(t).toContain('$ cost 0.42')
  expect(t).toContain('± diff +120 -30')
  expect(t).toContain('◔ cache 3:42')
  expect(t).toContain('━')
})

test('every metric uses the same spacing: one icon, a space, the label, a space, the value', () => {
  const metrics = segs(140).filter((s) => /^\S \S/.test(s.text))
  expect(metrics.length).toBe(10)
  for (const m of metrics) expect(m.text).toMatch(/^\S [a-z]+ \S+$/)
})

test('metrics are grouped: tokens | activity | spend | cache', () => {
  expect(text(140).split(' │ ')).toEqual([
    '↑ in 12.5k  ↓ out 3.1k  ◈ hit 1%',
    '⌘ calls 14  ◆ agents 2  ◇ bg 1  ◷ work 12:05',
    '$ cost 0.42  ± diff +120 -30',
    expect.stringMatching(/^◔ cache 3:42 ━{10}$/),
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

test('narrow widths drop the bar first, then diff, hit, calls, work, cost, output', () => {
  expect(text(110)).not.toContain('━')
  expect(text(110)).toContain('diff')
  expect(text(100)).not.toContain('diff')
  expect(text(100)).toContain('hit')
  expect(text(80)).not.toContain('hit')
  expect(text(80)).toContain('calls')
  expect(text(70)).not.toContain('calls')
  expect(text(70)).toContain('work')
  expect(text(60)).not.toContain('work')
  expect(text(60)).toContain('cost')
  expect(text(40)).not.toContain('cost')
  expect(text(40)).toContain('out')
  expect(text(30)).not.toContain('out')
  expect(text(20)).toBe('◔ cache 3:42')
})

test('cost is yellow; added lines are green and removed lines red', () => {
  const all = segs(120)
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
    bandSegments({ ...base, now, columns: 120 }).find((s) => s.text.startsWith('◔ cache '))
  expect(cache(0)?.color).toBe(PALETTE.green)
  expect(cache(250_000)?.color).toBe(PALETTE.yellow)
  expect(cache(290_000)?.color).toBe(PALETTE.red)
  expect(cache(400_000)?.color).toBe(PALETTE.dim)
  expect(cache(400_000)?.strike).toBe(true)
})

const target = { in: 12490, out: 3100, tools: 14, cost: 0.416, added: 120, removed: 30 }

test('animated counts replace the numbers that are drawn', () => {
  const shown = { in: 999, out: 2000, tools: 13, cost: 0.2, added: 100, removed: 20 }
  const t = bandSegments({ ...base, columns: 120, shown })
    .map((s) => s.text)
    .join('')
  expect(t).toContain('↑ in 999')
  expect(t).toContain('↓ out 2.0k')
  expect(t).toContain('⌘ calls 13')
  expect(t).toContain('$ cost 0.20')
  expect(t).toContain('± diff +100 -20')
  expect(t).toContain('◈ hit 1%')
})

test('parts are dropped by the target values, so a part does not come and go during a tween', () => {
  const columns = text(200).length - 1
  expect(text(columns)).not.toContain('━')
  // `999` is narrower than `12.5k`: with the bar it would fit, but the target does not.
  const t = bandSegments({ ...base, columns, shown: { ...target, in: 999 } })
    .map((s) => s.text)
    .join('')
  expect(t).toContain('↑ in 999')
  expect(t).not.toContain('━')
})

test('spawn counts are the first metrics dropped after the bar', () => {
  const full = text(200)
  expect(full).toContain('◆ agents 2')
  expect(full).toContain('◇ bg 1')
  const w = full.length
  expect(text(w - 1)).not.toContain('━')
  const noBar = text(w - 1).length
  expect(text(noBar - 1)).not.toContain('◇ bg')
  expect(text(noBar - 1)).toContain('◆ agents 2')
  expect(text(noBar - 1)).toContain('± diff')
})

test('an agent view is marked and leaves out the session-only metrics', () => {
  const t = bandSegments({ ...base, columns: 200, isAgentView: true })
    .map((s) => s.text)
    .join('')
  expect(t.startsWith('◆ agent │ ↑ in 12.5k')).toBe(true)
  expect(t).toContain('⌘ calls 14')
  expect(t).toContain('± diff +120 -30')
  expect(t).toContain('◔ cache 3:42')
  for (const gone of ['$ cost', '◷ work', '◆ agents', '◇ bg']) expect(t).not.toContain(gone)
})
