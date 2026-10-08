import { expect, test } from 'claude-code/testing'
import type { LastPrompt } from '../types'
import {
  breaksHead,
  breaksView,
  causeColor,
  causeOf,
  clockText,
  detect,
  diffOf,
  hashes,
  hashOf,
  listedTools,
  type StepPrompt,
  withStep,
} from './breaks'
import { PALETTE } from './palette'

const HOUR = 3_600_000
// Dollars rounded to a millionth: float sums are not exact.
const usd = (n: number | null | undefined): number => Math.round((n ?? Number.NaN) * 1e6) / 1e6
const last = (over: Partial<LastPrompt> = {}): LastPrompt => ({
  tokens: 100_000,
  model: 'claude-opus-5-5',
  messageCount: 40,
  at: 1000,
  fingerprint: {},
  ...over,
})
const step = (over: Partial<StepPrompt> = {}): StepPrompt => ({
  tokens: 101_000,
  cacheRead: 0,
  model: 'claude-opus-5-5',
  messageCount: 42,
  at: 2000,
  fingerprint: {},
  ...over,
})

test('hashOf gives one short text for one text', () => {
  expect(hashOf('abc')).toBe(hashOf('abc'))
  expect(hashOf('abc')).not.toBe(hashOf('abd'))
  expect(hashes([{ name: 'memory', text: 'a' }])).toEqual({ memory: hashOf('a') })
})

test('listedTools leaves out the deferred tools', () => {
  const list = [
    { name: 'Read', description: 'reads', mcp: false },
    { name: 'NotebookEdit', description: 'edits', mcp: false },
    { name: 'mcp__a__b', description: 'b', mcp: true },
    { name: 'mcp__a__c', description: 'c', mcp: true },
    { name: 'WebFetch', description: 'fetches', mcp: false },
  ]
  // A `tool.describe` result is first, then the stored names, then the rule: an MCP tool is
  // deferred.
  const known = new Map([
    ['NotebookEdit', true],
    ['mcp__a__c', false],
  ])
  const res = listedTools(list, known, ['WebFetch'])
  expect(Object.keys(res.tools).sort()).toEqual(['Read', 'mcp__a__c'])
  expect(res.tools.Read).toBe(hashOf('reads'))
  expect(res.deferred.sort()).toEqual(['NotebookEdit', 'WebFetch', 'mcp__a__b'])
})

test('detect finds a step that reads less than half of the expected tokens', () => {
  expect(detect(undefined, step())).toBeNull()
  expect(detect(last(), step({ cacheRead: 49_999 }))).toEqual({
    expected: 100_000,
    rewritten: 50_001,
  })
  // Half is no break.
  expect(detect(last(), step({ cacheRead: 50_000 }))).toBeNull()
  // A step with a large new tool result reads the full prefix.
  expect(detect(last(), step({ tokens: 400_000, cacheRead: 100_000 }))).toBeNull()
  // After a compaction the prompt is shorter than the prefix.
  expect(detect(last(), step({ tokens: 38_000, cacheRead: 0 }))).toEqual({
    expected: 38_000,
    rewritten: 38_000,
  })
  // A short prompt can be below the minimum that the API caches.
  expect(detect(last({ tokens: 3999 }), step({ cacheRead: 0 }))).toBeNull()
  expect(detect(last({ tokens: 4000 }), step({ cacheRead: 0 }))).not.toBeNull()
})

test('diffOf names the first difference of two maps and counts the others', () => {
  expect(diffOf({ a: '1' }, { a: '1' })).toBeNull()
  expect(diffOf(undefined, { a: '1' })).toBeNull()
  expect(diffOf({ a: '1' }, undefined)).toBeNull()
  expect(diffOf({ Write: '1', Read: '2' }, { Read: '2' })).toBe('- Write')
  expect(diffOf({ Read: '2' }, { Read: '2', mcp__a__b: '3' })).toBe('+ mcp__a__b')
  expect(diffOf({ Bash: '1' }, { Bash: '9' })).toBe('Bash changed')
  // Removed names first, then added, then changed.
  expect(diffOf({ a: '1', b: '1', c: '1' }, { b: '2', c: '1', d: '1' })).toBe('- a · +2 more')
})

test('causeOf gives each cause', () => {
  const none = { ttlMs: HOUR, compaction: null }
  expect(
    causeOf(last(), step(), HOUR, { trigger: 'auto', before: 171_000, after: 38_000 }),
  ).toEqual({
    cause: 'compact',
    detail: 'auto · 171.0k → 38.0k',
  })
  expect(causeOf(last(), step(), HOUR, { trigger: 'manual' })).toEqual({
    cause: 'compact',
    detail: 'manual',
  })
  expect(causeOf(last(), step({ messageCount: 12 }), none.ttlMs, none.compaction)).toEqual({
    cause: 'history',
    detail: '40 → 12 messages',
  })
  expect(
    causeOf(last(), step({ model: 'claude-sonnet-5-5' }), none.ttlMs, none.compaction),
  ).toEqual({ cause: 'model', detail: 'opus-5-5 → sonnet-5-5' })
  expect(causeOf(last(), step({ at: 1000 + HOUR + 4_324_000 }), HOUR, null)).toEqual({
    cause: 'ttl',
    detail: 'idle 2:12:04',
  })
  const fp = {
    tools: { Read: '1', Write: '2' },
    sections: { memory: '1' },
    context: { claudeMd: '1' },
  }
  const at = (over: object) => step({ fingerprint: { ...fp, ...over } })
  expect(causeOf(last({ fingerprint: fp }), at({ tools: { Read: '1' } }), HOUR, null)).toEqual({
    cause: 'tools',
    detail: '- Write',
  })
  expect(causeOf(last({ fingerprint: fp }), at({ sections: { memory: '9' } }), HOUR, null)).toEqual(
    {
      cause: 'prompt',
      detail: 'memory changed',
    },
  )
  expect(
    causeOf(last({ fingerprint: fp }), at({ context: { claudeMd: '9' } }), HOUR, null),
  ).toEqual({
    cause: 'context',
    detail: 'claudeMd changed',
  })
  expect(causeOf(last({ fingerprint: fp }), at({}), HOUR, null)).toEqual({
    cause: 'unknown',
    detail: 'no change seen',
  })
})

test('causeOf takes the first cause of the order', () => {
  // A model change at the limit of the lifetime is a model change.
  const late = step({ model: 'claude-sonnet-5-5', at: 1000 + HOUR + 1, messageCount: 3 })
  expect(causeOf(last(), late, HOUR, { trigger: 'auto' }).cause).toBe('compact')
  expect(causeOf(last(), late, HOUR, null).cause).toBe('history')
  expect(causeOf(last(), { ...late, messageCount: 42 }, HOUR, null).cause).toBe('model')
  // A time equal to the lifetime is not an expired cache.
  expect(causeOf(last(), step({ at: 1000 + HOUR }), HOUR, null).cause).toBe('unknown')
  // An absent part gives no difference.
  const fp = { tools: { Read: '1' } }
  expect(causeOf(last({ fingerprint: fp }), step({ fingerprint: {} }), HOUR, null).cause).toBe(
    'unknown',
  )
})

test('withStep keeps the prompt of the step and adds an entry for a break', () => {
  // The first step of a session, or of a record of an older version: no prefix, no break.
  const first = withStep(
    {},
    step({ cacheRead: 0, fingerprint: { sections: { a: '1' } } }),
    '1h',
    null,
  )
  expect(first.breaks).toEqual([])
  expect(first.breakCount).toBe(0)
  expect(first.lostUsd).toBe(0)
  expect(first.lastPrompt).toEqual({
    tokens: 101_000,
    model: 'claude-opus-5-5',
    messageCount: 42,
    at: 2000,
    fingerprint: { sections: { a: '1' } },
  })
  // A step with no sections keeps the sections of the step before it.
  const warm = withStep(first, step({ cacheRead: 101_000, tokens: 102_000, at: 3000 }), '1h', null)
  expect(warm.breaks).toEqual([])
  expect(warm.lastPrompt?.fingerprint).toEqual({ sections: { a: '1' } })
  expect(warm.lastPrompt?.cause).toBeUndefined()
  const broken = withStep(
    warm,
    step({ model: 'claude-sonnet-5-5', tokens: 102_500, cacheRead: 500, at: 4000 }),
    '1h',
    null,
  )
  expect(broken.lastPrompt?.cause).toBe('model')
  expect(broken.breakCount).toBe(1)
  expect(broken.breaks.length).toBe(1)
  expect(broken.breaks[0]).toMatchObject({
    at: 4000,
    cause: 'model',
    detail: 'opus-5-5 → sonnet-5-5',
    rewritten: 101_500,
  })
  // 101,500 tokens at Sonnet 5.5: a 1-hour write $4, a read $0.10.
  expect(usd(broken.breaks[0]?.lostUsd)).toBe(0.39585)
  expect(usd(broken.lostUsd)).toBe(0.39585)
  // The next step that reads the cache has no cause.
  const after = withStep(
    broken,
    step({ model: 'claude-sonnet-5-5', cacheRead: 102_500, at: 5000 }),
    '1h',
    null,
  )
  expect(after.lastPrompt?.cause).toBeUndefined()
  expect(after.breakCount).toBe(1)
})

test('withStep keeps the newest 50 entries and the sum of all', () => {
  let s: ReturnType<typeof withStep> = withStep({}, step({ model: 'm' }), '5m', null)
  for (let i = 0; i < 52; i++)
    s = withStep(s, step({ model: i % 2 === 0 ? 'a' : 'b', at: 3000 + i }), '5m', null)
  expect(s.breaks.length).toBe(50)
  expect(s.breaks[0]?.at).toBe(3002)
  expect(s.breakCount).toBe(52)
  // A model with no price has no lost cost, and adds nothing to the sum.
  expect(s.breaks[0]?.lostUsd).toBeNull()
  expect(s.lostUsd).toBe(0)
})

test('breaksView and breaksHead give what the pane draws', () => {
  expect(breaksView({})).toEqual({ count: 0, lostUsd: 0, entries: [] })
  expect(breaksHead({ count: 0, lostUsd: 0, entries: [] })).toEqual({ text: 'no break', dim: true })
  expect(breaksHead({ count: 1, lostUsd: 0.914, entries: [] })).toEqual({
    text: '1 break · ≈$0.91 lost',
    color: PALETTE.yellow,
  })
  expect(breaksHead({ count: 3, lostUsd: 1.84, entries: [] }).text).toBe('3 breaks · ≈$1.84 lost')
})

test('clockText is the local time of a moment, and causeColor the tone of a cause', () => {
  // 14:02 UTC, in a zone 7 hours east of UTC.
  expect(clockText(Date.UTC(2026, 9, 8, 14, 2, 59), -420)).toBe('21:02')
  expect(clockText(Date.UTC(2026, 9, 8, 23, 30), 60)).toBe('22:30')
  expect(causeColor('ttl')).toBe(PALETTE.yellow)
  expect(causeColor('compact')).toBe(PALETTE.yellow)
  expect(causeColor('model')).toBe(PALETTE.red)
  expect(causeColor('unknown')).toBe(PALETTE.red)
})
