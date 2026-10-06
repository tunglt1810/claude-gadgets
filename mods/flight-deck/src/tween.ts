import type { Counts, NamedShown, Shown, Snapshot, Tween } from '../types'

export type { Counts, NamedShown, Shown, Tween }

export const TWEEN_MS = 400

// The displayed value at `now`: cubic ease-out from `from` to `to`.
export const valueAt = (t: Tween, now: number): number => {
  const p = (now - t.startedAt) / TWEEN_MS
  if (p >= 1) return t.to
  if (p <= 0) return t.from
  return t.from + (t.to - t.from) * (1 - (1 - p) ** 3)
}

// A new target continues from the value on screen, so a change in the middle of a tween
// does not jump back.
export const retarget = (t: Tween, to: number, now: number): Tween =>
  t.to === to ? t : { from: valueAt(t, now), to, startedAt: now }

const KEYS = ['in', 'out', 'tools', 'cost', 'added', 'removed'] as const

// Every prompt token counts as `in`, cached ones included (see layout.ts).
export const countsOf = (s: Snapshot): Counts => ({
  in: s.totals.input + s.totals.cacheRead + s.totals.cacheWrite,
  out: s.totals.output,
  tools: s.tools,
  cost: s.costUsd,
  added: s.added,
  removed: s.removed,
})

const mapKeys = <T>(fn: (k: keyof Counts) => T): Record<keyof Counts, T> =>
  Object.fromEntries(KEYS.map((k) => [k, fn(k)])) as Record<keyof Counts, T>

// No animation: used when a session is loaded, so resume does not count up from zero.
export const snapShown = (sessionId: string | null, target: Counts): Shown => ({
  sessionId,
  tweens: mapKeys((k) => ({ from: target[k], to: target[k], startedAt: 0 })),
})

export const retargetShown = (c: Shown, sessionId: string, target: Counts, now: number): Shown =>
  c.sessionId === sessionId
    ? { sessionId, tweens: mapKeys((k) => retarget(c.tweens[k], target[k], now)) }
    : snapShown(sessionId, target)

// Token and line counts are integers on every frame; cost keeps its fraction (the band
// rounds it to the cent).
export const shownAt = (c: Shown, now: number): Counts =>
  mapKeys((k) => {
    const v = valueAt(c.tweens[k], now)
    return k === 'cost' ? v : Math.round(v)
  })

export const isSettled = (c: Shown, now: number): boolean =>
  KEYS.every((k) => valueAt(c.tweens[k], now) === c.tweens[k].to)

// The same for values with a name each (the costs of the dashboard): a changed value runs,
// and a new name or another session shows its value at once.
export const retargetNamed = (
  c: NamedShown,
  sessionId: string,
  target: Record<string, number>,
  now: number,
): NamedShown => ({
  sessionId,
  tweens: Object.fromEntries(
    Object.entries(target).map(([k, to]) => {
      const t = c.sessionId === sessionId ? c.tweens[k] : undefined
      return [k, t === undefined ? { from: to, to, startedAt: 0 } : retarget(t, to, now)]
    }),
  ),
})

export const namedAt = (c: NamedShown, now: number): Record<string, number> =>
  Object.fromEntries(Object.entries(c.tweens).map(([k, t]) => [k, valueAt(t, now)]))

export const isNamedSettled = (c: NamedShown, now: number): boolean =>
  Object.values(c.tweens).every((t) => valueAt(t, now) === t.to)
