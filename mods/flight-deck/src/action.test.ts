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
  expect(focusAction('msg:a9', null)).toEqual({ kind: 'compose', agentId: 'a9' })
  expect(focusAction('stop:a9', null)).toEqual({ kind: 'stop', agentId: 'a9' })
  expect(focusAction('sticky:msg:a9', null)).toEqual({ kind: 'compose', agentId: 'a9' })
  expect(focusAction('stickyfrom:stop:a9', null)).toEqual({ kind: 'stop', agentId: 'a9' })
  // A click on a message field only gives it the focus.
  expect(focusAction('say:a9', null)).toBeNull()
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

test('focusAction reads the keys of the context screen', () => {
  expect(focusAction('context', null)).toEqual({ kind: 'context' })
  expect(focusAction('recount', null)).toEqual({ kind: 'recount' })
  expect(focusAction('cat:MCP tools', null)).toEqual({ kind: 'category', name: 'MCP tools' })
  // A header and an item row are buttons that do nothing.
  expect(focusAction('head:cat', null)).toBeNull()
  expect(focusAction('item:MCP tools:0', null)).toBeNull()
  expect(focusAction('cat:', null)).toBeNull()
})

test('focusAction reads the button that allows the messages of the pane', () => {
  expect(focusAction('allow:a1', null)).toEqual({ kind: 'allow', agentId: 'a1' })
})

test('the cache button has the cache action', () => {
  expect(focusAction('cache', null)).toEqual({ kind: 'cache' })
})
