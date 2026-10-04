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
}
const base = { snap, busySince: null, now: 78_000, ttl: '5m' as const }
const segs = (cols: number) => bandSegments({ ...base, columns: cols })
const text = (cols: number) =>
  segs(cols)
    .map((s) => s.text)
    .join('')

test('every metric is icon, label, value', () => {
  const t = text(120)
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
  const metrics = segs(120).filter((s) => /^\S \S/.test(s.text))
  expect(metrics.length).toBe(8)
  for (const m of metrics) expect(m.text).toMatch(/^\S [a-z]+ \S+$/)
})

test('metrics are grouped: tokens | activity | spend | cache', () => {
  expect(text(120).split(' │ ')).toEqual([
    '↑ in 12.5k  ↓ out 3.1k  ◈ hit 1%',
    '⌘ calls 14  ◷ work 12:05',
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
