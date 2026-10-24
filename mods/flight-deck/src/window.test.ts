import { expect, test } from 'claude-code/testing'
import { PALETTE } from './palette'
import {
  agentFile,
  agentsDir,
  ancestorDirs,
  ceilingOf,
  compactWindow,
  contextColor,
  contextFit,
  contextPct,
  contextTargets,
  contextText,
  contextTokens,
  contextTone,
  contextWindow,
  settingsKey,
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
    'claude-haiku-5-5',
    'claude-haiku-5-5-20261001',
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

test('the context targets name each agent that has a context', () => {
  const entry = { status: 'idle' as const, runs: 0, startedAt: 0, endedAt: null }
  expect(
    contextTargets({
      a1: { ...entry, id: 'a1', context: { tokens: 100, window: 200_000 } },
      a2: { ...entry, id: 'a2' },
    }),
  ).toEqual({ 'ctx:a1': 100 })
})

test('a settings key drops the [1m] suffix, the date and the cloud spellings', () => {
  for (const m of [
    'claude-opus-5-5',
    'claude-opus-5-5[1m]',
    'Claude-Opus-5-5[1M]',
    'claude-opus-5-5-20261001',
    'us.anthropic.claude-opus-5-5-20261001-v1:0',
    'global.anthropic.claude-opus-5-5-v1:0',
    'anthropic.claude-opus-5-5-v1',
    'claude-opus-5-5@20261001',
  ])
    expect(settingsKey(m)).toBe('claude-opus-5-5')
})

const OPUS = 'claude-opus-5-5'

test('with no setting there is no compaction window', () => {
  expect(compactWindow(OPUS, [], undefined)).toBeUndefined()
  expect(compactWindow(OPUS, [{}, { modelSettings: {} }], undefined)).toBeUndefined()
})

test('the window of the model comes from its own settings, in any spelling of the key', () => {
  const user = { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } }
  expect(compactWindow(OPUS, [user], undefined)).toBe(400_000)
  expect(compactWindow('claude-opus-5-5[1m]', [user], undefined)).toBe(400_000)
  expect(compactWindow('claude-sonnet-5-5', [user], undefined)).toBeUndefined()
  const dated = { modelSettings: { 'claude-opus-5-5-20261001': { autoCompactWindow: 300_000 } } }
  expect(compactWindow(OPUS, [dated], undefined)).toBe(300_000)
})

test('the canonical key wins over another spelling in the same file', () => {
  const user = {
    modelSettings: {
      [OPUS]: { autoCompactWindow: 400_000 },
      'claude-opus-5-5[1m]': { autoCompactWindow: 300_000 },
    },
  }
  expect(compactWindow(OPUS, [user], undefined)).toBe(400_000)
})

test('the top-level window applies to a model with no window of its own', () => {
  const user = {
    autoCompactWindow: 500_000,
    modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } },
  }
  expect(compactWindow(OPUS, [user], undefined)).toBe(400_000)
  expect(compactWindow('claude-sonnet-5-5', [user], undefined)).toBe(500_000)
})

test('a later file with a top-level window drops the model windows of the files before it', () => {
  const user = { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } }
  const project = { autoCompactWindow: 600_000 }
  expect(compactWindow(OPUS, [user, project], undefined)).toBe(600_000)
})

test('a later file with only model windows keeps the files before it', () => {
  const user = {
    autoCompactWindow: 500_000,
    modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } },
  }
  const local = { modelSettings: { 'claude-sonnet-5-5': { autoCompactWindow: 300_000 } } }
  expect(compactWindow(OPUS, [user, local], undefined)).toBe(400_000)
  expect(compactWindow('claude-sonnet-5-5', [user, local], undefined)).toBe(300_000)
  expect(compactWindow('claude-fable-5-1', [user, local], undefined)).toBe(500_000)
})

test('auto is no window', () => {
  const user = {
    autoCompactWindow: 500_000,
    modelSettings: { [OPUS]: { autoCompactWindow: 'auto' } },
  }
  expect(compactWindow(OPUS, [user], undefined)).toBeUndefined()
  expect(compactWindow(OPUS, [{ autoCompactWindow: 'auto' }], undefined)).toBeUndefined()
})

test('the variable wins over the settings, and is read as the engine reads it', () => {
  const user = { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } }
  expect(compactWindow(OPUS, [user], '250000')).toBe(250_000)
  expect(compactWindow(OPUS, [user], ' 300k ')).toBe(300_000)
  expect(compactWindow(OPUS, [user], '0.5M')).toBe(500_000)
  expect(compactWindow(OPUS, [user], '350,000')).toBe(350_000)
  // Below the minimum it is the minimum, above the maximum the maximum.
  expect(compactWindow(OPUS, [user], '50000')).toBe(100_000)
  expect(compactWindow(OPUS, [user], '2m')).toBe(1_000_000)
  // A value that is no size is ignored.
  expect(compactWindow(OPUS, [user], 'abc')).toBe(400_000)
  expect(compactWindow(OPUS, [user], '0')).toBe(400_000)
  expect(compactWindow(OPUS, [user], '')).toBe(400_000)
})

test('a settings value out of range is dropped, as if the file did not set it', () => {
  expect(compactWindow(OPUS, [{ autoCompactWindow: 50_000 }], undefined)).toBeUndefined()
  expect(compactWindow(OPUS, [{ autoCompactWindow: 2_000_000 }], undefined)).toBeUndefined()
  // A bad model value does not hide the top-level window.
  const bad = {
    autoCompactWindow: 500_000,
    modelSettings: { [OPUS]: { autoCompactWindow: 50_000 } },
  }
  expect(compactWindow(OPUS, [bad], undefined)).toBe(500_000)
  // A bad top-level value does not drop the model windows of the files before it.
  const user = { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } }
  expect(compactWindow(OPUS, [user, { autoCompactWindow: 'x' }], undefined)).toBe(400_000)
})

test('the window of an agent definition only lowers the window', () => {
  const user = { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } }
  expect(compactWindow(OPUS, [user], undefined, 150_000)).toBe(150_000)
  expect(compactWindow(OPUS, [user], undefined, 600_000)).toBe(400_000)
  // With no setting the definition's window applies.
  expect(compactWindow(OPUS, [], undefined, 300_000)).toBe(300_000)
  // The variable wins over the definition.
  expect(compactWindow(OPUS, [user], '700k', 150_000)).toBe(700_000)
})

test('an agent file gives its name and its window', () => {
  const file = (head: string) => `---\n${head}\n---\n\nYou review code.\n`
  expect(
    agentFile(file('name: reviewer\ndescription: Reviews\nautoCompactWindow: 150000')),
  ).toEqual({
    name: 'reviewer',
    window: 150_000,
  })
  expect(agentFile(file('name: "reviewer"\nautoCompactWindow: "200000"'))).toEqual({
    name: 'reviewer',
    window: 200_000,
  })
  expect(agentFile(file('name: reviewer'))).toEqual({ name: 'reviewer' })
  // A window out of range is dropped.
  expect(agentFile(file('name: reviewer\nautoCompactWindow: 50000'))).toEqual({ name: 'reviewer' })
  // A key below the frontmatter is not read.
  expect(agentFile('---\nname: reviewer\n---\nautoCompactWindow: 150000\n')).toEqual({
    name: 'reviewer',
  })
  expect(agentFile('no frontmatter')).toBeUndefined()
  expect(agentFile(file('description: no name'))).toBeUndefined()
})

test('the folders above the project root are listed up to the home folder, the nearest first', () => {
  expect(ancestorDirs('/Users/u/work/app', '/Users/u')).toEqual([
    '/Users/u/work/app',
    '/Users/u/work',
  ])
  expect(ancestorDirs('/Users/u/work/app/', '/Users/u/')).toEqual([
    '/Users/u/work/app',
    '/Users/u/work',
  ])
  // The home folder itself is no project folder.
  expect(ancestorDirs('/Users/u', '/Users/u')).toEqual([])
  // Outside the home folder the walk goes to the root.
  expect(ancestorDirs('/srv/app', '/Users/u')).toEqual(['/srv/app', '/srv', '/'])
})

test('an agent file value may have a comment after it', () => {
  const text = '---\nname: reviewer # the reviewer\nautoCompactWindow: 150000  # small\n---\n'
  expect(agentFile(text)).toEqual({ name: 'reviewer', window: 150_000 })
})

test('the agents folder of a folder has one slash, at the root too', () => {
  expect(agentsDir('/srv/app')).toBe('/srv/app/.claude/agents')
  expect(agentsDir('/')).toBe('/.claude/agents')
})

test('an agent compacts at the lowest window of its definition and of its parent', () => {
  expect(ceilingOf(undefined, undefined)).toBeUndefined()
  expect(ceilingOf(150_000, undefined)).toBe(150_000)
  expect(ceilingOf(undefined, 200_000)).toBe(200_000)
  expect(ceilingOf(300_000, 200_000)).toBe(200_000)
})
