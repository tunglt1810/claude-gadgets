import type { PaneAction, Transcript } from '../types'

// The action of a pane button, by its key: a click that only gave the pane the focus reaches
// the plugin as this key, not as a press. A child agent's button is keyed by its tool call, so
// the open transcript gives the agent. A key that is not a pane button is null.
export const focusAction = (element: string, transcript: Transcript | null): PaneAction | null => {
  if (element === 'back' || element === 'wrap') return { kind: element }
  const [kind, id] = [
    element.slice(0, element.indexOf(':')),
    element.slice(element.indexOf(':') + 1),
  ]
  if (id === '' || !element.includes(':')) return null
  if (kind === 'agent') return { kind: 'open', agentId: id }
  if (kind === 'tool') return { kind: 'tool', toolUseId: id }
  if (kind !== 'child' || transcript === null || !('items' in transcript)) return null
  const item = transcript.items.find((it) => it.kind === 'tool' && it.id === id)
  const agentId = item?.kind === 'tool' ? item.agentId : undefined
  return agentId === undefined ? null : { kind: 'open', agentId }
}
