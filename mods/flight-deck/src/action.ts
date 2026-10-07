import type { PaneAction, Transcript } from '../types'

// The action of a pane button, by its key: a click that only gave the pane the focus reaches
// the plugin as this key, not as a press. A child agent's button is keyed by its tool call, so
// the open transcript gives the agent. A key that is not a pane button is null.
export const focusAction = (element: string, transcript: Transcript | null): PaneAction | null => {
  if (element === 'back' || element === 'wrap' || element === 'context' || element === 'recount')
    return { kind: element }
  const [kind, id] = [
    element.slice(0, element.indexOf(':')),
    element.slice(element.indexOf(':') + 1),
  ]
  if (id === '' || !element.includes(':')) return null
  // The back button of the bar that stays in view while a transcript scrolls.
  if (element === 'sticky:back' || element === 'stickyfrom:back') return { kind: 'back' }
  // An agent's name, and the button of its detail row.
  if (kind === 'agent' || kind === 'detail') return { kind: 'open', agentId: id }
  if (kind === 'expand') return { kind: 'expand', agentId: id }
  // The buttons of an agent's control row, and the stop button of the transcript screen.
  if (kind === 'msg') return { kind: 'compose', agentId: id }
  if (kind === 'stop') return { kind: 'stop', agentId: id }
  // A category row of the context screen.
  if (kind === 'cat') return { kind: 'category', name: id }
  if (kind === 'tool') return { kind: 'tool', toolUseId: id }
  if (kind !== 'child' || transcript === null || !('items' in transcript)) return null
  const item = transcript.items.find((it) => it.kind === 'tool' && it.id === id)
  const agentId = item?.kind === 'tool' ? item.agentId : undefined
  return agentId === undefined ? null : { kind: 'open', agentId }
}

// A list of ids with `id` added, or removed when it is there. A pane state of an older
// shape (a hot reload) has no list.
export const toggled = (list: readonly string[] | undefined, id: string): string[] =>
  (list ?? []).includes(id) ? (list ?? []).filter((x) => x !== id) : [...(list ?? []), id]
