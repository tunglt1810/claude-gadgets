import { expect, test } from 'claude-code/testing'
import { cacheTtls, isOverLimit } from './ttl'

test('cacheTtls: the settings name the lifetimes, the main one before the mod option', () => {
  const settings = { promptCacheTtl: '5m', subagentPromptCacheTtl: '1h' }
  expect(cacheTtls(settings, '1h')).toEqual({ main: '5m', agent: '1h' })
})

test('cacheTtls: unset, the main loop takes the mod option and a subagent 5m', () => {
  expect(cacheTtls({}, '5m')).toEqual({ main: '5m', agent: '5m' })
  // A subscriber's main loop caches for an hour: the option defaults to it.
  expect(cacheTtls({}, undefined)).toEqual({ main: '1h', agent: '5m' })
})

test('cacheTtls ignores a value that is not a lifetime', () => {
  expect(cacheTtls({ promptCacheTtl: 60, subagentPromptCacheTtl: '2h' }, 'x')).toEqual({
    main: '1h',
    agent: '5m',
  })
})

test('cacheTtls: an environment variable names a lifetime before the settings', () => {
  const settings = { promptCacheTtl: '5m', subagentPromptCacheTtl: '5m' }
  const env = { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: '1h' }
  expect(cacheTtls(settings, '5m', env)).toEqual({ main: '1h', agent: '1h' })
  // A value that is not a lifetime is ignored.
  expect(cacheTtls(settings, '1h', { CLAUDE_CODE_PROMPT_CACHE_TTL: '2h' }).main).toBe('5m')
})

test('cacheTtls: FORCE_PROMPT_CACHING_5M wins over every other source', () => {
  const env = {
    FORCE_PROMPT_CACHING_5M: '1',
    CLAUDE_CODE_PROMPT_CACHE_TTL: '1h',
    ENABLE_PROMPT_CACHING_1H: '1',
  }
  expect(cacheTtls({ subagentPromptCacheTtl: '1h' }, '1h', env)).toEqual({
    main: '5m',
    agent: '5m',
  })
  // A false value does not force.
  expect(cacheTtls({}, '1h', { FORCE_PROMPT_CACHING_5M: '0' }).main).toBe('1h')
})

test('cacheTtls: ENABLE_PROMPT_CACHING_1H gives 1h where nothing names a lifetime', () => {
  const env = { ENABLE_PROMPT_CACHING_1H: 'true' }
  expect(cacheTtls({}, '5m', env)).toEqual({ main: '1h', agent: '1h' })
  expect(cacheTtls({ subagentPromptCacheTtl: '5m' }, '5m', env).agent).toBe('5m')
})

test('cacheTtls: over a plan limit the main loop caches for 5m, unless a source names 1h', () => {
  expect(cacheTtls({}, '1h', {}, true)).toEqual({ main: '5m', agent: '5m' })
  expect(cacheTtls({ promptCacheTtl: '1h' }, '1h', {}, true).main).toBe('1h')
  expect(cacheTtls({}, '1h', { ENABLE_PROMPT_CACHING_1H: '1' }, true).main).toBe('1h')
})

test('isOverLimit: a plan window at or past 100 percent', () => {
  expect(isOverLimit([{ kind: 'five_hour', percentUsed: 40 }])).toBe(false)
  expect(isOverLimit([{ kind: 'seven_day', percentUsed: 100 }])).toBe(true)
  // A gateway's spend limit is not a plan window.
  expect(isOverLimit([{ kind: 'spend_limit', percentUsed: 120 }])).toBe(false)
  expect(isOverLimit([])).toBe(false)
})
