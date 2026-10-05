import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import { agentView, bumpAgent } from '../src/agents'
import { Band } from '../src/band'
import { ttlMs } from '../src/countdown'
import { linesChanged } from '../src/diff'
import {
  emptySnapshot,
  isComplete,
  parseSnapshot,
  type Snapshot,
  storeKey,
  touchSessions,
} from '../src/snapshot'
import { countsOf, isSettled, retargetShown, shownAt, snapShown } from '../src/tween'
import { addUsage } from '../src/usage'
import { endTurn, startTurn } from '../src/work'
import type { Meter } from '../types'

type Api = EngineInterface
type Ttl = '5m' | '1h'

const initialMeter: Meter = { ...emptySnapshot(), sessionId: null, active: 0, busySince: null }
const meter = atom({ plugin: 'token-meter', key: 'meter' } as const, initialMeter)
const nowAtom = atom({ plugin: 'token-meter', key: 'now' } as const, 0)
const shown = atom(
  { plugin: 'token-meter', key: 'shown' } as const,
  snapShown(null, countsOf(emptySnapshot())),
)

// The engine only follows `$` into functions declared at the top of this file, so
// the helpers live here and take what they need as arguments.

// Load by session id on every event: covers --resume, in-process resume and /clear
// without relying on session.start (which does not fire for those).
async function ensureLoaded($: Api): Promise<string> {
  const id = await $.session.id()
  const cur = await read($, meter)
  if (cur.sessionId === id && isComplete(cur)) return id
  const snap = parseSnapshot(await $.store.get(storeKey(id)))
  // A turn that is still open keeps running across the switch.
  await update($, meter, (c) => ({
    ...snap,
    sessionId: id,
    active: c.active,
    busySince: c.busySince,
  }))
  // A loaded session shows its counts at once: no count-up from zero.
  await update($, shown, () => snapShown(id, countsOf(snap)))
  return id
}

const MAX_SESSIONS = 50

// Only the persistent part of the meter is stored; active/busySince are runtime-only.
// The store keeps the most recent MAX_SESSIONS sessions.
async function save($: Api, id: string, s: Snapshot): Promise<void> {
  const { keep, drop } = touchSessions(await $.store.get('sessions'), id, MAX_SESSIONS)
  await $.store.set('sessions', keep)
  for (const old of drop) await $.store.delete(storeKey(old))
  await $.store.set(storeKey(id), {
    totals: s.totals,
    tools: s.tools,
    lastStepAt: s.lastStepAt,
    workMs: s.workMs,
    costUsd: s.costUsd,
    added: s.added,
    removed: s.removed,
    agents: s.agents,
    bg: s.bg,
    byAgent: s.byAgent,
  })
}

async function stamp($: Api): Promise<number> {
  const at = await $.clock.now()
  await update($, nowAtom, () => at)
  return at
}

// One 1s tick drives both the countdown and the live work clock; it stops itself
// once the cache has lapsed and no turn is running.
let timer: { cancel: () => void } | null = null
function startTimer($: Api, ttl: Ttl): void {
  if (timer !== null) return
  timer = $.clock.every(1000, async () => {
    const at = await stamp($)
    const s = await read($, meter)
    // A subagent's countdown is drawn in its own view: it keeps the tick running too.
    const lastStepAt = Math.max(
      s.lastStepAt ?? 0,
      ...Object.values(s.byAgent).map((a) => a.lastStepAt ?? 0),
    )
    const isCacheDone = lastStepAt + ttlMs(ttl) <= at
    if (isCacheDone && s.busySince === null) {
      timer?.cancel()
      timer = null
    }
  })
}

// Changed counts run to their new values. A short frame tick redraws the band (through
// `now`) and stops itself when every count has arrived.
const FRAME_MS = 60
let frames: { cancel: () => void } | null = null
async function animate($: Api, id: string, s: Snapshot): Promise<void> {
  const at = await $.clock.now()
  await update($, shown, (c) => retargetShown(c, id, countsOf(s), at))
  if (frames !== null) return
  frames = $.clock.every(FRAME_MS, async () => {
    const now = await stamp($)
    // Events can finish out of order: take the targets from the meter as it is now.
    const m = await read($, meter)
    const cur = await update($, shown, (c) =>
      m.sessionId !== null && c.sessionId === m.sessionId
        ? retargetShown(c, m.sessionId, countsOf(m), now)
        : c,
    )
    if (isSettled(cur, now)) {
      frames?.cancel()
      frames = null
    }
  })
}

// The meter for the current session as the band should draw it: the live atom, or the
// stored copy when the atom still holds another session (nothing has loaded this one yet).
async function currentMeter($: Api): Promise<Meter> {
  const id = await $.session.id()
  const cur = await read($, meter)
  if (cur.sessionId === id && isComplete(cur)) return cur
  const snap = parseSnapshot(await $.store.get(storeKey(id)))
  return { ...snap, sessionId: id, active: cur.active, busySince: cur.busySince }
}

export const register: Register = (on, options) => {
  const ttl: Ttl = options.cacheTtl === '1h' ? '1h' : '5m'

  // Start the tick for a session that already has a live cache (--resume, hot reload).
  on('session.start', async ($, e, next) => {
    await ensureLoaded($)
    const cur = await read($, meter)
    const at = await stamp($)
    if (cur.lastStepAt !== null && cur.lastStepAt + ttlMs(ttl) > at) startTimer($, ttl)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The cache is refreshed when the request is processed, not when the response ends.
    const sentAt = await $.clock.now()
    const res = yield* next(e)
    const id = await ensureLoaded($)
    await stamp($)
    // Subagents (agentId set) have their own caches: count their tokens but do not
    // touch the main countdown. Each keeps its own share and its own countdown.
    const isMain = e.agentId === undefined
    // Compute inside the updater: concurrent events must not overwrite each other.
    const nextMeter = await update($, meter, (c) => ({
      ...c,
      totals: addUsage(c.totals, res.usage),
      lastStepAt: isMain && res.usage !== null ? sentAt : c.lastStepAt,
      byAgent: bumpAgent(c.byAgent, e.agentId, (a) => ({
        ...a,
        totals: addUsage(a.totals, res.usage),
        lastStepAt: res.usage !== null ? sentAt : a.lastStepAt,
      })),
    }))
    await animate($, id, nextMeter)
    await save($, id, nextMeter)
    startTimer($, ttl)
    return res
  })

  on('tool.call', async ($, e, next) => {
    const res = await next(e)
    // A call the user or a rule denied never ran.
    if (res.deny !== undefined) return res
    const id = await ensureLoaded($)
    await stamp($)
    // A failed edit changed nothing on disk.
    const diff = res.isError ? { added: 0, removed: 0 } : linesChanged(res.result)
    // A background Agent call is a subagent: `agent.spawn` counts it.
    // A monitor is a background task by nature and has no flag.
    const isBackground =
      !res.isError &&
      e.tool !== 'Agent' &&
      (e.tool === 'Monitor' || ('run_in_background' in e && e.run_in_background === true))
    const nextMeter = await update($, meter, (c) => ({
      ...c,
      tools: c.tools + 1,
      added: c.added + diff.added,
      removed: c.removed + diff.removed,
      bg: c.bg + (isBackground ? 1 : 0),
      byAgent: bumpAgent(c.byAgent, e.agentId, (a) => ({
        ...a,
        tools: a.tools + 1,
        added: a.added + diff.added,
        removed: a.removed + diff.removed,
      })),
    }))
    await animate($, id, nextMeter)
    await save($, id, nextMeter)
    return res
  })

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    // A refused spawn started nothing.
    const agentId = res.agentId
    if (agentId === undefined) return res
    const id = await ensureLoaded($)
    // The agent's first step can arrive before this: keep what it already counted.
    const nextMeter = await update($, meter, (c) => ({
      ...c,
      agents: c.agents + 1,
      byAgent: bumpAgent(c.byAgent, agentId, (a) =>
        e.parentAgentId === undefined ? a : { ...a, parentId: e.parentAgentId },
      ),
    }))
    await save($, id, nextMeter)
    return res
  })

  // The engine's own ledger, as the status line shows it: a session total, so it is
  // taken as is and never summed.
  on('session.measure', async ($, e, next) => {
    const usd = e.cost?.usd
    if (usd === undefined) return next(e)
    const id = await ensureLoaded($)
    const nextMeter = await update($, meter, (c) => ({ ...c, costUsd: usd }))
    await animate($, id, nextMeter)
    await save($, id, nextMeter)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await ensureLoaded($)
    const at = await stamp($)
    await update($, meter, (c) => ({ ...c, ...startTurn(c, at) }))
    startTimer($, ttl)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's run raises turn.complete without a turn.start: it must not close
    // the main turn's interval.
    if (e.agentId !== undefined) return next(e)
    const id = await ensureLoaded($)
    const at = await stamp($)
    const nextMeter = await update($, meter, (c) => ({ ...c, ...endTurn(c, at) }))
    await save($, id, nextMeter)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const session = await currentMeter($)
    const now = (await read($, nowAtom)) || (await $.clock.now())
    const tweens = await read($, shown)
    // An agent's transcript is on screen: draw that agent's numbers, which are not animated.
    const viewed = e.props.view.agentId
    const snap = viewed === undefined ? session : agentView(session, viewed)
    return (
      <Band
        ui={$.ui.resolve(e)}
        snap={snap}
        shown={
          viewed === undefined && tweens.sessionId === session.sessionId
            ? shownAt(tweens, now)
            : undefined
        }
        isAgentView={viewed !== undefined}
        busySince={session.busySince}
        now={now}
        ttl={ttl}
        columns={e.props.bodyColumns ?? 120}
      />
    )
  })
}
