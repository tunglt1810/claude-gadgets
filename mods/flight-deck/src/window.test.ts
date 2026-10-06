import { expect, test } from 'claude-code/testing'
import { PALETTE } from './palette'
import {
  contextColor,
  contextFit,
  contextPct,
  contextText,
  contextTokens,
  contextTone,
  contextWindow,
} from './window'

test('context tokens are the input side of a step, without the output', () => {
  expect(
    contextTokens({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 10,
    }),
  ).toBe(100)
})

test('an absent token field counts as zero', () => {
  expect(contextTokens({ input_tokens: 7 })).toBe(7)
  expect(contextTokens({})).toBe(0)
})

test('the three known ids get the window of the catalog', () => {
  expect(contextWindow('claude-haiku-4-5-20251001', false)).toBe(200_000)
  expect(contextWindow('claude-sonnet-5-5', false)).toBe(1_000_000)
  expect(contextWindow('claude-opus-5-5', false)).toBe(1_000_000)
})

test('each native prefix gives 1M and an older model gives 200k', () => {
  for (const m of [
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5-1',
    'claude-mythos-5',
    'opus-5-5',
  ])
    expect(contextWindow(m, false)).toBe(1_000_000)
  for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'm', ''])
    expect(contextWindow(m, false)).toBe(200_000)
})

test('a [1m] suffix gives 1M, in each letter case', () => {
  expect(contextWindow('claude-sonnet-4-6[1m]', false)).toBe(1_000_000)
  expect(contextWindow('claude-haiku-4-5[1M]', false)).toBe(1_000_000)
})

test('the disable flag gives 200k for each model', () => {
  expect(contextWindow('claude-opus-5-5', true)).toBe(200_000)
  expect(contextWindow('claude-sonnet-4-6[1m]', true)).toBe(200_000)
})

test('the percentage is a whole number from 0 to 100', () => {
  expect(contextPct({ tokens: 0, window: 200_000 })).toBe(0)
  expect(contextPct({ tokens: 182_400, window: 1_000_000 })).toBe(18)
  expect(contextPct({ tokens: 300_000, window: 200_000 })).toBe(100)
  expect(contextPct({ tokens: 10, window: 0 })).toBe(0)
})

test('the tone changes at 50 and at 80', () => {
  expect(contextTone(49)).toBe('ok')
  expect(contextTone(50)).toBe('warn')
  expect(contextTone(79)).toBe('warn')
  expect(contextTone(80)).toBe('danger')
})

test('the color follows the tone', () => {
  expect(contextColor({ tokens: 10, window: 200_000 })).toBe(PALETTE.green)
  expect(contextColor({ tokens: 100_000, window: 200_000 })).toBe(PALETTE.yellow)
  expect(contextColor({ tokens: 160_000, window: 200_000 })).toBe(PALETTE.red)
})

test('the text names the tokens, the window and the percentage', () => {
  expect(contextText({ tokens: 182_400, window: 1_000_000 }, true)).toBe('ctx 182.4k/1M 18%')
  expect(contextText({ tokens: 100, window: 200_000 }, true)).toBe('ctx 100/200k 0%')
  expect(contextText({ tokens: 182_400, window: 1_000_000 }, false)).toBe('ctx 18%')
})

test('the text that fits a room: the whole one, the percentage alone, or none', () => {
  const c = { tokens: 182_400, window: 1_000_000 }
  expect(contextFit(c, 17)).toBe('ctx 182.4k/1M 18%')
  expect(contextFit(c, 16)).toBe('ctx 18%')
  expect(contextFit(c, 7)).toBe('ctx 18%')
  expect(contextFit(c, 6)).toBeNull()
  expect(contextFit(c, -3)).toBeNull()
})
