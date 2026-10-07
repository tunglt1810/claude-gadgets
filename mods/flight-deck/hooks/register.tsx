import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import { focusAction, toggled } from '../src/action'
import { agentView, bumpAgent } from '../src/agents'
import { Band } from '../src/band'
import { contextView, sampled, sampleOf, type UsageContext } from '../src/context'
import { sendFailure, stopFailure } from '../src/control'
import { ttlMs } from '../src/countdown'
import { usdTargets } from '../src/dashboard'
import { linesChanged } from '../src/diff'
import { AgentPane } from '../src/pane'
import { paneData } from '../src/paneData'
import { costOf } from '../src/price'
import {
  agentsKey,
  agentTitle,
  completed,
  ended,
  merged,
  modelLabel,
  parseRegistry,
  ran,
  restored,
  spawned,
  stopped,
  taskNotice,
  tuned,
} from '../src/registry'
import {
  emptySnapshot,
  isComplete,
  parseSnapshot,
  type Snapshot,
  storeKey,
  touchSessions,
} from '../src/snapshot'
import { SPIN_MS } from '../src/spinner'
import { transcriptItems } from '../src/transcript'
import { cacheTtls, isOn, isOverLimit, type Ttl } from '../src/ttl'
import {
  countsOf,
  isNamedSettled,
  isSettled,
  type NamedShown,
  namedAt,
  retargetNamed,
  retargetShown,
  shownAt,
  snapShown,
} from '../src/tween'
import { addUsage, advised, emptyTotals, rebased, settled } from '../src/usage'
import { contextTargets, contextTokens, contextWindow } from '../src/window'
import { endRun, endTurn, startRun, startTurn } from '../src/work'
import type {
  Agents,
  ContextState,
  Meter,
  PaneAction,
  PaneData,
  PaneView,
  Registry,
  Transcript,
} from '../types'

type Api = EngineInterface
type Ttls = { main: Ttl; agent: Ttl }

const initialMeter: Meter = {
  ...emptySnapshot(),
  sessionId: null,
  active: 0,
  busySince: null,
  working: [],
}
const meter = atom({ plugin: 'flight-deck', key: 'meter' } as const, initialMeter)
const nowAtom = atom({ plugin: 'flight-deck', key: 'now' } as const, 0)
const shown = atom(
  { plugin: 'flight-deck', key: 'shown' } as const,
  snapShown(null, countsOf(emptySnapshot())),
)

const initialAgents: Agents = { sessionId: null, entries: {} }
const agents = atom({ plugin: 'flight-deck', key: 'agents' } as const, initialAgents)

const PANE_ID = 'agents'
// The one drawn text with an emoji: the title row has no columns, so a double-width
// character moves nothing.
const PANE_TITLE = '🤖 Flight Deck'
// The store key of the last wrap choice: one for the plugin, not one per session.
const WRAP_KEY = 'wrap'
const initialPane: PaneView = {
  isOpen: false,
  isWrapped: true,
  agentId: null,
  expanded: [],
  collapsedAgents: [],
  transcript: null,
  isContext: false,
  openCategories: [],
  compose: null,
  stopAsk: null,
  controlError: null,
  sent: 0,
}
const pane = atom({ plugin: 'flight-deck', key: 'pane' } as const, initialPane)
const initialData: PaneData = {
  sessionId: null,
  entries: {},
  stats: null,
  dashboard: null,
  context: null,
}
const shownData = atom({ plugin: 'flight-deck', key: 'paneData' } as const, initialData)
// The context of the main loop: the latest breakdown that an event read, and its growth.
const initialContext: ContextState = { sessionId: null, sample: null, base: null, turns: 0 }
const contextAtom = atom({ plugin: 'flight-deck', key: 'context' } as const, initialContext)
// The dashboard's costs and the context lengths as the terminal draws them: a changed number
// runs to its new value.
const initialPaneShown: NamedShown = { sessionId: null, tweens: {} }
const paneShown = atom({ plugin: 'flight-deck', key: 'paneShown' } as const, initialPaneShown)
const spin = atom({ plugin: 'flight-deck', key: 'spin' } as const, 0)
// The engine raises `ui.scroll` before it moves a window, and gives the pane its new offset
// after. The bar of a scrolled transcript is drawn at the offset of the event, so it is at
// its new row when the window gets there, not one drawing later.
const paneScroll = atom(
  { plugin: 'flight-deck', key: 'paneScroll' } as const,
  null as { offset: number; seen: number } | null,
)
// The offset the pane was last drawn with. Kept here, not in state: a render hook does not
// write state.
let drawnOffset = 0
// Whether the pane was last drawn on the terminal. A desktop scrolls by the pixel and the
// engine gives an offset in rows, so a bar there moves with the text between two rows: only
// the terminal has the bar, and only its scroll waits.
let isPaneOnTerminal = false
// Ends the wait of a scroll for the pane's next drawing.
let onPaneDrawn: (() => void) | null = null
// The longest that a scroll waits for that drawing.
const SCROLL_WAIT_MS = 40
// Null until an event read the settings: the mod option stands in for them.
const ttlsAtom = atom({ plugin: 'flight-deck', key: 'ttls' } as const, null as Ttls | null)

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
    working: c.working ?? [],
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
  for (const old of drop) {
    await $.store.delete(storeKey(old))
    await $.store.delete(agentsKey(old))
  }
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
    byModel: s.byModel,
    costByModel: s.costByModel,
    advisor: s.advisor,
    steps: s.steps,
    mcpCalls: s.mcpCalls,
    ...(s.mainModel === undefined ? {} : { mainModel: s.mainModel }),
  })
}

// The registry of the session `id`: the live atom, or the stored copy on a session change.
// The pane goes back to the tree then: a transcript of the other session is never drawn.
// A stored agent that is running but that this process does not list ran in a dead process.
async function loadAgents($: Api, id: string): Promise<void> {
  const cur = await read($, agents)
  if (cur.sessionId === id) return
  const entries = restored(
    parseRegistry(await $.store.get(agentsKey(id))),
    await $.agent.list(),
    await $.clock.now(),
  )
  await update($, agents, (c) => (c.sessionId === id ? c : { sessionId: id, entries }))
  await update($, pane, (c) => ({
    ...c,
    agentId: null,
    expanded: [],
    collapsedAgents: [],
    transcript: null,
    isContext: false,
    openCategories: [],
    compose: null,
    stopAsk: null,
    controlError: null,
  }))
  await syncPane($)
}

// Copies what the pane draws into its own atom, only when it changed: every write redraws
// the pane, and a desktop drops a click on a native button that a redraw replaced.
async function syncPane($: Api): Promise<void> {
  const id = await $.session.id()
  const reg = await read($, agents)
  const view = await read($, pane)
  const snap = await currentMeter($)
  const ctx = await read($, contextAtom)
  const next = paneData(
    id,
    reg.sessionId === id ? reg.entries : {},
    view.agentId,
    snap,
    await $.clock.now(),
    ctx.sessionId === id ? contextView(ctx, snap) : null,
  )
  const cur = await read($, shownData)
  if (JSON.stringify(cur) !== JSON.stringify(next)) await update($, shownData, () => next)
  // The numbers that run to a new value: the costs of the dashboard and the tokens of each
  // context on the screen.
  const target = {
    ...(next.dashboard === null ? {} : usdTargets(next.dashboard)),
    ...contextTargets(next.entries),
  }
  const at = await $.clock.now()
  const tweens = await read($, paneShown)
  if (JSON.stringify(tweens) === JSON.stringify(retargetNamed(tweens, id, target, at))) return
  await update($, paneShown, (c) => retargetNamed(c, id, target, at))
  startFrames($)
}

// Keeps the breakdown of a usage reply as the context sample of the session `id`. A reply
// with no breakdown changes nothing. `isTurnEnd` counts a turn of the growth.
async function recordContext(
  $: Api,
  id: string,
  context: UsageContext,
  detail: 'summary' | 'full',
  isTurnEnd: boolean,
): Promise<void> {
  const sample = sampleOf(context, detail)
  if (sample === null) return
  await update($, contextAtom, (c) => sampled(c, id, sample, isTurnEnd))
}

// Reads a breakdown and draws it. A `full` one sends a token-count request for each tool and
// each memory file: only a press asks for it.
async function measureContext($: Api, detail: 'summary' | 'full'): Promise<void> {
  const id = await $.session.id()
  const usage = await $.session.usage({ breakdown: detail })
  await recordContext($, id, usage.context, detail, false)
  await syncPane($)
}

// The engine's list merged in (it has the agents that raised no spawn), then one registry
// change, then stored. The change comes last: an event outranks a stale status in the list.
async function trackAgent(
  $: Api,
  id: string,
  change: (r: Registry, at: number) => Registry,
): Promise<void> {
  await loadAgents($, id)
  const at = await $.clock.now()
  const list = await $.agent.list()
  const next = await update($, agents, (c) =>
    c.sessionId === id ? { ...c, entries: change(merged(c.entries, list, at), at) } : c,
  )
  if (next.sessionId === id) await $.store.set(agentsKey(id), next.entries)
  await syncPane($)
  startSpinner($)
}

// Reads one agent's transcript into the pane. A result for an agent that is no longer on
// the transcript screen is discarded.
async function loadTranscript($: Api, agentId: string): Promise<void> {
  const rows = await $.session.messages({ agentId })
  const transcript: Transcript = Array.isArray(rows)
    ? { agentId, items: transcriptItems(rows) }
    : { agentId, deny: rows.deny }
  // An unchanged transcript is not written again: a write redraws the pane.
  const cur = (await read($, pane)).transcript
  if (JSON.stringify(cur) === JSON.stringify(transcript)) return
  await update($, pane, (c) => (c.agentId === agentId ? { ...c, transcript } : c))
}

// A screen change takes the pressed button off the screen, and the engine then drops the
// pane's focus: the next click would only focus. So the focus moves to `key`, a button of the
// new screen. The move starts before the change: it waits for the drawing that brings `key`,
// and the pane still holds the keys then. A refusal (no keys, no such site) changes nothing.
async function focusAfter($: Api, key: string, change: () => Promise<void>): Promise<void> {
  const moved = $.ui.focus({ requestId: PANE_ID, key }).catch(() => ({}))
  await change()
  await moved
}

async function openAgent($: Api, agentId: string): Promise<void> {
  await focusAfter($, 'back', async () => {
    await update($, pane, (c) => ({
      ...c,
      agentId,
      expanded: [],
      transcript: null,
      compose: null,
      controlError: null,
    }))
    await syncPane($)
  })
  await loadTranscript($, agentId)
}

// The agent on the transcript screen had an event: read its transcript again.
async function refreshViewed($: Api, agentId: string): Promise<void> {
  const cur = await read($, pane)
  if (cur.isOpen && cur.agentId === agentId) await loadTranscript($, agentId)
}

// Back to the tree, with the focus on the row of the agent that was open.
async function backToTree($: Api): Promise<void> {
  const from = (await read($, pane)).agentId
  await focusAfter($, `agent:${from}`, async () => {
    await update($, pane, (c) => ({
      ...c,
      agentId: null,
      expanded: [],
      transcript: null,
      controlError: null,
    }))
    await syncPane($)
  })
}

// The context screen, with the focus on its back button. The press asks for the full
// breakdown: the summary of the last turn is on the screen until it comes.
async function openContext($: Api): Promise<void> {
  await focusAfter($, 'back', async () => {
    await update($, pane, (c) => ({ ...c, isContext: true }))
  })
  // A count that fails leaves the summary on the screen.
  await measureContext($, 'full').catch(() => undefined)
}

// Back to the tree, with the focus on the button that opened the context screen.
async function closeContext($: Api): Promise<void> {
  await focusAfter($, 'context', async () => {
    await update($, pane, (c) => ({ ...c, isContext: false }))
  })
}

// The text of each message field as the person typed it, by agent. Kept here, not in state:
// a write to state on each key would draw the pane again.
const drafts: Record<string, string> = {}
// The agents that have a message on its way.
const sending = new Set<string>()
// The agents that a stop of the pane is on its way to: the `tool.call` hook of the mod sees
// each stop, and it is not a tool call of the session.
const ownStops = new Set<string>()
// The task that a TaskStop call names.
const taskOf = (e: object): string =>
  'task_id' in e && typeof e.task_id === 'string' ? e.task_id : ''

// Sends the text of a message field to an agent, as the SendMessage tool does. The engine
// starts an ended agent again. A message that is not sent stays in its field, with the reason.
async function sendMessage($: Api, agentId: string, text: string): Promise<void> {
  // A second Enter while the message is on its way sends nothing.
  if (text.trim() === '' || sending.has(agentId)) return
  sending.add(agentId)
  const res = await $.session
    .send({ to: { agentId }, text })
    .catch((err: unknown) => ({ isDelivered: false as const, reason: String(err) }))
  sending.delete(agentId)
  if (res.isDelivered) {
    // Text that the person typed while the message was on its way stays in the field.
    if (drafts[agentId] === text) delete drafts[agentId]
    await update($, pane, (c) => ({
      ...c,
      compose: null,
      controlError: null,
      sent: (c.sent ?? 0) + 1,
    }))
    return refreshViewed($, agentId)
  }
  if (drafts[agentId] === undefined) drafts[agentId] = text
  await update($, pane, (c) => ({
    ...c,
    controlError: { agentId, reason: sendFailure(res.reason) },
  }))
}

// The first press of a stop button asks, the second stops the agent as the TaskStop tool
// does. The notification of the engine then draws the agent stopped.
async function stopAgent($: Api, agentId: string): Promise<void> {
  if ((await read($, pane)).stopAsk !== agentId) {
    await update($, pane, (c) => ({ ...c, stopAsk: agentId }))
    return
  }
  await update($, pane, (c) => ({ ...c, stopAsk: null }))
  ownStops.add(agentId)
  let reason: string | null
  try {
    const res = await $.tool.call({ tool: 'TaskStop', task_id: agentId })
    reason = res.deny !== undefined ? res.deny : res.isError ? (res.text ?? '') : null
  } catch (err) {
    reason = String(err)
  } finally {
    ownStops.delete(agentId)
  }
  // A stop that worked takes back the reason of this agent only.
  await update($, pane, (c) => ({
    ...c,
    controlError:
      reason !== null
        ? { agentId, reason: stopFailure(reason) }
        : c.controlError?.agentId === agentId
          ? null
          : c.controlError,
  }))
}

// The wait before the second focus move to a message field.
const REFOCUS_MS = 80

// Puts the focus in the message field of an agent, so the person can type at once. The
// pressed button stays on the screen, and the engine can give it the ring back when the
// press ends: a second move comes a short time after the press.
async function focusField($: Api, agentId: string): Promise<void> {
  const move = () => $.ui.focus({ requestId: PANE_ID, key: `say:${agentId}` }).catch(() => ({}))
  await move()
  setTimeout(() => void move(), REFOCUS_MS)
}

// A stop button that waits for its second press forgets the question when its agent ends.
async function forgetStop($: Api, agentId: string): Promise<void> {
  if ((await read($, pane)).stopAsk !== agentId) return
  await update($, pane, (c) => (c.stopAsk === agentId ? { ...c, stopAsk: null } : c))
}

// Opens the message field of an agent's row with the focus in it, or closes it. The transcript
// screen always has its field: the focus goes there.
async function toggleCompose($: Api, agentId: string): Promise<void> {
  const cur = await read($, pane)
  if (cur.agentId === agentId) {
    await focusField($, agentId)
    return
  }
  if (cur.compose === agentId) {
    await update($, pane, (c) => ({ ...c, compose: null, controlError: null }))
    return
  }
  await focusAfter($, `say:${agentId}`, async () => {
    await update($, pane, (c) => ({ ...c, compose: agentId, controlError: null }))
  })
  await focusField($, agentId)
}

// What a pane button does, from its press or from the click that gave the pane the focus.
async function act($: Api, action: PaneAction): Promise<void> {
  if (action.kind === 'stop') return stopAgent($, action.agentId)
  // Any other press takes back the question of a stop button.
  if ((await read($, pane)).stopAsk != null) await update($, pane, (c) => ({ ...c, stopAsk: null }))
  if (action.kind === 'compose') return toggleCompose($, action.agentId)
  if (action.kind === 'send') return sendMessage($, action.agentId, action.text)
  if (action.kind === 'open') return openAgent($, action.agentId)
  if (action.kind === 'back')
    // State of an older shape (a hot reload) has no flag.
    return (await read($, pane)).isContext === true ? closeContext($) : backToTree($)
  if (action.kind === 'context') return openContext($)
  if (action.kind === 'recount') return measureContext($, 'full').catch(() => undefined)
  if (action.kind === 'category') {
    // A category with no items has no rows to open: a click that only gave the pane the
    // focus gets here too.
    const rows = (await read($, shownData)).context?.categories ?? []
    if ((rows.find((r) => r.name === action.name)?.items.length ?? 0) === 0) return
    await update($, pane, (c) => ({
      ...c,
      openCategories: toggled(c.openCategories, action.name),
    }))
    return
  }
  if (action.kind === 'wrap') {
    const next = await update($, pane, (c) => ({ ...c, isWrapped: !c.isWrapped }))
    return $.store.set(WRAP_KEY, next.isWrapped)
  }
  if (action.kind === 'expand') {
    await update($, pane, (c) => ({
      ...c,
      collapsedAgents: toggled(c.collapsedAgents, action.agentId),
    }))
    return
  }
  await update($, pane, (c) => {
    const id = action.toolUseId
    const expanded = c.expanded.includes(id)
      ? c.expanded.filter((x) => x !== id)
      : [...c.expanded, id]
    return { ...c, expanded }
  })
}

// Whether the pane held the keys when it was last drawn (its `isFocused` prop). Kept here, not
// in state: a render hook does not write state.
let isPaneFocused = true

async function togglePane($: Api): Promise<boolean> {
  const cur = await read($, pane)
  if (cur.isOpen) {
    await update($, pane, (c) => ({ ...c, isOpen: false }))
    await $.ui.close({ id: PANE_ID })
    return false
  }
  await loadAgents($, await $.session.id())
  const isWrapped = (await $.store.get(WRAP_KEY)) !== false
  await update($, pane, (c) => ({ ...c, isOpen: true, isWrapped }))
  // The pane takes the keyboard: a click on a pane without it only focuses.
  await $.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true })
  startSpinner($)
  // After the pane is open: a usage call that fails leaves the pane and its state as one.
  // A summary breakdown estimates locally: it sends no request.
  await measureContext($, 'summary').catch(() => undefined)
  return true
}

// The spinner of the running agents: a short tick of its own, alive only while the pane is
// open and an agent of this session runs. It stops itself, so an idle session draws nothing.
let spinner: { cancel: () => void } | null = null
function startSpinner($: Api): void {
  if (spinner !== null) return
  spinner = $.clock.every(SPIN_MS, async () => {
    const isOpen = (await read($, pane)).isOpen
    const reg = await read($, agents)
    const isBusy = isOpen && Object.values(reg.entries).some((a) => a.status === 'running')
    if (!isBusy) {
      spinner?.cancel()
      spinner = null
      return
    }
    await update($, spin, (n) => (Number.isInteger(n) ? n + 1 : 0) % 1000)
  })
}

async function stamp($: Api): Promise<number> {
  const at = await $.clock.now()
  await update($, nowAtom, () => at)
  return at
}

// The cache lifetimes of the main loop and of the others, from the environment, the settings,
// the plan limits and the mod option. `$.env.get` takes a literal name.
async function loadTtls($: Api, settings: Record<string, unknown>, option: unknown): Promise<Ttls> {
  const next = cacheTtls(
    settings,
    option,
    {
      FORCE_PROMPT_CACHING_5M: await $.env.get('FORCE_PROMPT_CACHING_5M'),
      CLAUDE_CODE_PROMPT_CACHE_TTL: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: await $.env.get(
        'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL',
      ),
      ENABLE_PROMPT_CACHING_1H: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
    },
    isOverLimit((await $.session.usage()).rateLimits),
  )
  const cur = await read($, ttlsAtom)
  if (cur?.main !== next.main || cur.agent !== next.agent) await update($, ttlsAtom, () => next)
  return next
}

// The open turns of the main loop: the open intervals that are not a run of an agent.
const mainTurns = (m: Meter): number => m.active - (m.working ?? []).length

// The steps whose request is out and whose usage is not counted yet. The engine's ledger can
// hold such a step already, so the cost of the advisor is not settled while one is in flight.
let stepsInFlight = 0

// One 1s tick drives both the countdown and the live work clock; it stops itself
// once the cache has lapsed and no turn is running.
let timer: { cancel: () => void } | null = null
function startTimer($: Api, ttls: Ttls): void {
  if (timer !== null) return
  timer = $.clock.every(1000, async () => {
    const at = await stamp($)
    const s = await read($, meter)
    // A subagent's countdown is drawn in its own view: it keeps the tick running too.
    const agentStepAt = Math.max(0, ...Object.values(s.byAgent).map((a) => a.lastStepAt ?? 0))
    const isCacheDone =
      (s.lastStepAt ?? 0) + ttlMs(ttls.main) <= at && agentStepAt + ttlMs(ttls.agent) <= at
    if (isCacheDone && s.busySince === null) {
      timer?.cancel()
      timer = null
    }
  })
}

// Changed counts run to their new values. A short frame tick redraws the band (through
// `now`) and stops itself when every count, and every cost of the dashboard, has arrived.
const FRAME_MS = 60
let frames: { cancel: () => void } | null = null
async function animate($: Api, id: string, s: Snapshot): Promise<void> {
  const at = await $.clock.now()
  await update($, shown, (c) => retargetShown(c, id, countsOf(s), at))
  startFrames($)
}

function startFrames($: Api): void {
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
    if (isSettled(cur, now) && isNamedSettled(await read($, paneShown), now)) {
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
  return {
    ...snap,
    sessionId: id,
    active: cur.active,
    busySince: cur.busySince,
    working: cur.working ?? [],
  }
}

export const register: Register = (on, options) => {
  // Start the tick for a session that already has a live cache (--resume, hot reload).
  on('session.start', async ($, e, next) => {
    await ensureLoaded($)
    const cur = await read($, meter)
    const at = await stamp($)
    const settings = await $.settings.read()
    const ttls = await loadTtls($, settings, options.cacheTtl)
    if (cur.lastStepAt !== null && cur.lastStepAt + ttlMs(ttls.main) > at) startTimer($, ttls)
    // A pane that stayed open across a hot reload keeps its spinner.
    startSpinner($)
    await $.command.register({
      name: 'agent-log',
      description: 'Show or hide the agents of this session',
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The cache is refreshed when the request is processed, not when the response ends.
    const sentAt = await $.clock.now()
    stepsInFlight++
    // A run of an agent has no start event: its first step opens its working time.
    const runner = e.agentId
    if (runner !== undefined) {
      const session = await ensureLoaded($)
      await update($, meter, (c) => ({ ...c, ...startRun(c, runner, sentAt) }))
      // The agent runs from the start of its step. The end of a step does not say so: the end
      // of a stopped step can come after the end of the run.
      await trackAgent($, session, (r, t) => ran(r, runner, t))
      startTimer($, (await read($, ttlsAtom)) ?? cacheTtls({}, options.cacheTtl))
    }
    try {
      const res = yield* next(e)
      const id = await ensureLoaded($)
      await stamp($)
      // Subagents (agentId set) have their own caches: count their tokens but do not
      // touch the main countdown. Each keeps its own share and its own countdown.
      const isMain = e.agentId === undefined
      const settings = await $.settings.read()
      const ttls = await loadTtls($, settings, options.cacheTtl)
      // Priced now: the step's cache writes cost by its loop's lifetime.
      const stepCost = costOf(
        e.model,
        addUsage(emptyTotals(), res.usage),
        isMain ? ttls.main : ttls.agent,
      )
      const advisorModel = settings.advisorModel
      // Compute inside the updater: concurrent events must not overwrite each other.
      const nextMeter = await update($, meter, (c) => ({
        ...c,
        costByModel:
          stepCost === null
            ? c.costByModel
            : {
                ...c.costByModel,
                // A model counted before this field existed starts from its tokens' estimate.
                [e.model]:
                  (c.costByModel[e.model] ??
                    costOf(e.model, c.byModel[e.model] ?? emptyTotals(), ttls.main) ??
                    0) + stepCost,
              },
        advisor: advised(c.advisor, res.serverToolUses ?? [], advisorModel),
        steps: c.steps + (isMain && res.usage !== null ? 1 : 0),
        // An agent with no `agent.spawn` (a skill that runs in a subagent) is counted here.
        agents: c.agents + (e.agentId === undefined || e.agentId in c.byAgent ? 0 : 1),
        totals: addUsage(c.totals, res.usage),
        byModel: {
          ...c.byModel,
          [e.model]: addUsage(c.byModel[e.model] ?? emptyTotals(), res.usage),
        },
        ...(isMain ? { mainModel: e.model } : {}),
        lastStepAt: isMain && res.usage !== null ? sentAt : c.lastStepAt,
        byAgent: bumpAgent(c.byAgent, e.agentId, (a) => ({
          ...a,
          totals: addUsage(a.totals, res.usage),
          lastStepAt: res.usage !== null ? sentAt : a.lastStepAt,
        })),
      }))
      await animate($, id, nextMeter)
      await save($, id, nextMeter)
      const agentId = e.agentId
      const effort = e.effort === undefined ? undefined : String(e.effort)
      if (agentId !== undefined) {
        // A step with no usage tells nothing of the window: the entry keeps its context.
        const context =
          res.usage === null
            ? undefined
            : {
                tokens: contextTokens(res.usage),
                window: contextWindow(
                  e.model,
                  isOn(await $.env.get('CLAUDE_CODE_DISABLE_1M_CONTEXT')),
                ),
              }
        await trackAgent($, id, (r) => tuned(r, agentId, e.model, effort, context))
      } else {
        // The dashboard's numbers changed.
        await syncPane($)
      }
      startTimer($, ttls)
      return res
    } finally {
      stepsInFlight--
    }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'TaskStop' && e.agentId === undefined && ownStops.has(taskOf(e))) return next(e)
    const loop = e.agentId
    // The agent runs from the start of its call. The end of a call does not say so: the end
    // of a stopped call can come after the end of the run.
    if (loop !== undefined) {
      const session = await ensureLoaded($)
      await trackAgent($, session, (r, t) => ran(r, loop, t))
    }
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
      mcpCalls:
        e.tool.startsWith('mcp__') && !c.mcpCalls.includes(e.tool)
          ? [...c.mcpCalls, e.tool]
          : c.mcpCalls,
      byAgent: bumpAgent(c.byAgent, e.agentId, (a) => ({
        ...a,
        tools: a.tools + 1,
        added: a.added + diff.added,
        removed: a.removed + diff.removed,
      })),
    }))
    await animate($, id, nextMeter)
    await save($, id, nextMeter)
    if (loop !== undefined) await refreshViewed($, loop)
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
      // Its first step can count it before this.
      agents: c.agents + (agentId in c.byAgent ? 0 : 1),
      byAgent: bumpAgent(c.byAgent, agentId, (a) =>
        e.parentAgentId === undefined ? a : { ...a, parentId: e.parentAgentId },
      ),
    }))
    await save($, id, nextMeter)
    await trackAgent($, id, (r, t) =>
      spawned(r, agentId, t, {
        ...(e.parentAgentId === undefined ? {} : { parentId: e.parentAgentId }),
        ...(e.subagentType === undefined ? {} : { type: e.subagentType }),
        ...(e.description === undefined ? {} : { description: e.description }),
        ...(e.name === undefined ? {} : { name: e.name }),
      }),
    )
    return res
  })

  // The engine's own ledger, as the status line shows it: a session total, so it is
  // taken as is and never summed.
  on('session.measure', async ($, e, next) => {
    const usd = e.cost?.usd
    if (usd === undefined) return next(e)
    const id = await ensureLoaded($)
    // Between turns the ledger may now hold a turn that called the advisor: settle its cost.
    const nextMeter = await update($, meter, (c) => {
      const measured = { ...c, costUsd: usd }
      return mainTurns(c) > 0 || stepsInFlight > 0
        ? measured
        : { ...measured, advisor: settled(measured) }
    })
    await animate($, id, nextMeter)
    await save($, id, nextMeter)
    await syncPane($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await ensureLoaded($)
    const at = await stamp($)
    await update($, meter, (c) => ({
      ...c,
      ...startTurn(c, at),
      ...(stepsInFlight > 0 ? {} : { advisor: rebased(c) }),
    }))
    startTimer($, (await read($, ttlsAtom)) ?? cacheTtls({}, options.cacheTtl))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's run raises turn.complete without a turn.start: it must not close
    // the main turn's interval. It ends one run of that agent: an answer, or a stop (a kill
    // gives `aborted`).
    const agentId = e.agentId
    if (agentId !== undefined) {
      const session = await ensureLoaded($)
      const at = await stamp($)
      const nextMeter = await update($, meter, (c) => ({ ...c, ...endRun(c, agentId, at) }))
      await save($, session, nextMeter)
      const end = e.reason === 'answer' ? completed : stopped
      await trackAgent($, session, (r, t) => end(r, agentId, t))
      await forgetStop($, agentId)
      await refreshViewed($, agentId)
      return next(e)
    }
    const id = await ensureLoaded($)
    const at = await stamp($)
    // The steps of the turn are counted, and the ledger holds them: read it now and settle the
    // cost of the advisor, before a side request of the idle time (a prompt suggestion) grows it.
    // The same reply gives the context as it is at the end of the turn.
    const usage = await $.session.usage({ breakdown: 'summary' })
    const usd = usage.cost?.usd
    await recordContext($, id, usage.context, 'summary', true)
    const nextMeter = await update($, meter, (c) => {
      const ended = { ...c, ...endTurn(c, at), ...(usd === undefined ? {} : { costUsd: usd }) }
      return mainTurns(ended) > 0 || stepsInFlight > 0
        ? ended
        : { ...ended, advisor: settled(ended) }
    })
    // The band draws the cost through its tween: give it the new figure.
    await animate($, id, nextMeter)
    await save($, id, nextMeter)
    await syncPane($)
    return next(e)
  })

  // A background task's notification names how an agent ended: killed, failed or completed.
  on('prompt.submit', async ($, e, next) => {
    const res = await next(e)
    const notice = e.origin.kind === 'task-notification' ? taskNotice(e.text) : null
    if (notice !== null) {
      const session = await ensureLoaded($)
      // A killed agent raises no turn.complete: its working time ends here.
      const at = await stamp($)
      await update($, meter, (c) => ({ ...c, ...endRun(c, notice.id, at) }))
      await trackAgent($, session, (r, t) => ended(r, notice.id, notice.status, t))
      await forgetStop($, notice.id)
    }
    return res
  })

  // A click on a pane that does not hold the keys only moves the focus: the engine raises
  // `ui.focus`, not a press, and the click is lost. The button's action runs here then. With the
  // keys, a person's focus move is Tab or an arrow, and it presses nothing.
  on('ui.focus', async ($, e, next) => {
    // Read before `next`: landing the ring draws the pane focused.
    const wasFocused = isPaneFocused
    const res = await next(e)
    const element = e.element
    const isClick =
      e.component === 'Pane' && e.requestId === PANE_ID && e.origin.kind === 'person' && !wasFocused
    if (isClick && element !== undefined && res.deny === undefined) {
      const action = focusAction(element, (await read($, pane)).transcript)
      if (action !== null) await act($, action)
    }
    return res
  })

  on('ui.scroll', async ($, e, next) => {
    const isTranscript =
      isPaneOnTerminal &&
      e.component === 'Pane' &&
      e.requestId === PANE_ID &&
      (await read($, pane)).agentId !== null
    if (isTranscript && e.offset !== drawnOffset) {
      // The engine moves the window when this hook returns, and draws the pane again later.
      // So the pane is drawn first, with the bar at its new row: the window then gets there
      // with the bar in place. The wait ends by itself when no drawing comes.
      const drawn = new Promise<void>((resolve) => {
        onPaneDrawn = resolve
      })
      await update($, paneScroll, () => ({ offset: e.offset, seen: drawnOffset }))
      await Promise.race([drawn, new Promise<void>((r) => setTimeout(r, SCROLL_WAIT_MS))])
      onPaneDrawn = null
    }
    return next(e)
  })

  on('command.run', { command: 'agent-log' }, async ($) => ({
    text: (await togglePane($)) ? 'Agents pane opened.' : 'Agents pane closed.',
  }))

  // The person can close the pane with the engine's mark: the button follows.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID) await update($, pane, (c) => ({ ...c, isOpen: false }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    // Only `paneData`, the view and (on the terminal) the spinner are read here: each read
    // value redraws the pane when it changes.
    isPaneFocused = e.props.isFocused
    const id = await $.session.id()
    const data = await read($, shownData)
    const isCurrent = data.sessionId === id
    // Only the terminal draws the costs on each frame. `now` is read while a cost runs, so the
    // frame tick draws the pane again; a pane at rest does not read it.
    const now = await $.clock.now()
    const costs = e.surface === 'terminal' ? await read($, paneShown) : null
    if (costs !== null && !isNamedSettled(costs, now)) await read($, nowAtom)
    // The terminal's pane has no margin and no title of its own: a cell of padding at each
    // side, and the title as the first row.
    const ui = $.ui.resolve(e)
    const pad = e.surface === 'terminal' ? 1 : 0
    // The rows above the pane body on the terminal: the title and the empty row below it.
    const above = e.surface === 'terminal' ? 2 : 0
    // The offset of a scroll event is newer than the pane's own until the engine gives the
    // pane another offset: that one is then the newest (the window can move with no event).
    const asked = await read($, paneScroll)
    const offset =
      asked !== null && asked.seen === e.props.scroll.offset ? asked.offset : e.props.scroll.offset
    drawnOffset = e.props.scroll.offset
    isPaneOnTerminal = e.surface === 'terminal'
    // After this hook returns its drawing: a scroll that waits for it goes on.
    const drawn = onPaneDrawn
    if (drawn !== null) setTimeout(drawn, 0)
    const body = (
      <AgentPane
        ui={ui}
        entries={isCurrent ? data.entries : {}}
        view={await read($, pane)}
        stats={isCurrent ? data.stats : null}
        dashboard={isCurrent ? data.dashboard : null}
        // State of an older shape (a hot reload) has no context.
        context={isCurrent ? (data.context ?? null) : null}
        {...(costs !== null && costs.sessionId === id ? { shownUsd: namedAt(costs, now) } : {})}
        // Only the terminal reads the spinner: a read value redraws the pane when it changes, and
        // a desktop drops a click on a button that a redraw replaced. Its cells are `Client`s.
        spin={e.surface === 'terminal' ? await read($, spin) : null}
        now={now}
        columns={e.props.bodyColumns - pad * 2}
        scrollTop={e.surface === 'terminal' ? Math.max(0, offset - above) : 0}
        {...(offset === e.props.scroll.offset || e.surface !== 'terminal'
          ? {}
          : { scrollFrom: Math.max(0, e.props.scroll.offset - above) })}
        onOpen={(agentId) => act($, { kind: 'open', agentId })}
        onExpand={(agentId) => act($, { kind: 'expand', agentId })}
        onBack={() => act($, { kind: 'back' })}
        onWrap={() => act($, { kind: 'wrap' })}
        onTool={(toolUseId) => act($, { kind: 'tool', toolUseId })}
        onContext={() => act($, { kind: 'context' })}
        onRecount={() => act($, { kind: 'recount' })}
        onCategory={(name) => act($, { kind: 'category', name })}
        drafts={drafts}
        onCompose={(agentId) => act($, { kind: 'compose', agentId })}
        onStop={(agentId) => act($, { kind: 'stop', agentId })}
        onDraft={(agentId, text) => {
          drafts[agentId] = text
        }}
        onSend={(agentId, text) => act($, { kind: 'send', agentId, text })}
      />
    )
    if (pad === 0) return body
    return (
      <ui.Box flexDirection="column" paddingX={pad}>
        <ui.Text bold>{PANE_TITLE}</ui.Text>
        {/* An empty row parts the title from the body. */}
        <ui.Text> </ui.Text>
        {body}
      </ui.Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const session = await currentMeter($)
    const now = (await read($, nowAtom)) || (await $.clock.now())
    const tweens = await read($, shown)
    // An agent's transcript is on screen: draw that agent's numbers, which are not animated.
    const isPaneOpen = (await read($, pane)).isOpen
    const viewed = e.props.view.agentId
    const snap = viewed === undefined ? session : agentView(session, viewed)
    const reg = viewed === undefined ? null : await read($, agents)
    const agent = viewed === undefined ? undefined : reg?.entries[viewed]
    const model = modelLabel(agent)
    const ttls = (await read($, ttlsAtom)) ?? cacheTtls({}, options.cacheTtl)
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
        {...(model === undefined ? {} : { model })}
        // The band stays in view when the header of the transcript scrolls away: it names the
        // agent and shows its context length.
        {...(agent === undefined ? {} : { name: agentTitle(agent) })}
        {...(agent?.context === undefined ? {} : { context: agent.context })}
        busySince={session.busySince}
        now={now}
        ttl={viewed === undefined ? ttls.main : ttls.agent}
        columns={e.props.bodyColumns ?? 120}
        isPaneOpen={isPaneOpen}
        onToggle={() => togglePane($)}
      />
    )
  })
}
