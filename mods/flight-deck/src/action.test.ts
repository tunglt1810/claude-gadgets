import { expect, test } from 'claude-code/testing'
import { focusAction, toggled } from './action'

const transcript = {
  agentId: 'a1',
  items: [
    { kind: 'tool' as const, id: 't1', tool: 'Agent', input: {}, isError: false, agentId: 'a2' },
  ],
}

test('focusAction reads the action of each pane button key', () => {
  expect(focusAction('back', null)).toEqual({ kind: 'back' })
  expect(focusAction('wrap', null)).toEqual({ kind: 'wrap' })
  // The back button of the bar that stays in view while the transcript scrolls.
  expect(focusAction('sticky:back', null)).toEqual({ kind: 'back' })
  expect(focusAction('stickyfrom:back', null)).toEqual({ kind: 'back' })
  expect(focusAction('agent:a9', null)).toEqual({ kind: 'open', agentId: 'a9' })
  expect(focusAction('expand:a9', null)).toEqual({ kind: 'expand', agentId: 'a9' })
  // The detail row of an agent is a button as its name is, so the two start at one place.
  expect(focusAction('detail:a9', null)).toEqual({ kind: 'open', agentId: 'a9' })
  expect(focusAction('tool:t1', null)).toEqual({ kind: 'tool', toolUseId: 't1' })
  expect(focusAction('child:t1', transcript)).toEqual({ kind: 'open', agentId: 'a2' })
})

test('focusAction refuses a key that is not a pane button', () => {
  expect(focusAction('child:t1', null)).toBeNull()
  expect(focusAction('child:zz', transcript)).toBeNull()
  expect(focusAction('agents', null)).toBeNull()
  expect(focusAction('agent:', null)).toBeNull()
  expect(focusAction('expand:', null)).toBeNull()
})

test('toggled adds an absent id and removes a present one', () => {
  expect(toggled([], 'a1')).toEqual(['a1'])
  expect(toggled(['a1', 'a2'], 'a1')).toEqual(['a2'])
  // A pane state of an older shape (a hot reload) has no list.
  expect(toggled(undefined, 'a1')).toEqual(['a1'])
})
