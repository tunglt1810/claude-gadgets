import { expect, test } from 'claude-code/testing'
import { formatCountdown, formatDuration, formatTokens, formatUsd } from './format'

test('formatTokens', () => {
  expect([999, 1200, 12400, 1500000].map(formatTokens)).toEqual(['999', '1.2k', '12.4k', '1.5M'])
})

test('formatCountdown', () => {
  expect(formatCountdown(222000)).toBe('3:42')
  expect(formatCountdown(5000)).toBe('0:05')
  expect(formatCountdown(null)).toBe('--')
  expect(formatCountdown(0)).toBe('expired')
  expect(formatCountdown(-500)).toBe('expired')
})

test('formatDuration', () => {
  expect([42000, 725000, 3723000, -5, Number.NaN].map(formatDuration)).toEqual([
    '0:42',
    '12:05',
    '1:02:03',
    '0:00',
    '0:00',
  ])
})

test('formatUsd', () => {
  expect([0, 0.416, 12.5, 123.456, -1, Number.NaN].map(formatUsd)).toEqual([
    '0.00',
    '0.42',
    '12.50',
    '123.46',
    '0.00',
    '0.00',
  ])
})
