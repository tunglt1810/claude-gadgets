import type { Cell, Shell } from '../types'
import { PALETTE } from './palette'

// The newest shells that the pane keeps.
export const MAX_SHELLS = 20
// The most characters of one line of output: the pane cuts a line to its columns, and a
// long line must not take the tree near the engine's limit of 100,000 characters.
const MAX_LINE = 500

// The engine's five sentences for a command in the background each name the task's id and
// the file that its output goes to.
const STARTED = /(?:with ID: |\(ID: )([^\s).]+)[\s\S]*?Output is being written to: (\S+?)\.(?=\s|$)/

// The engine stops a shell of a subagent that runs in the foreground at the subagent's final
// response, and no notice of that end follows.
const ENDS_WITH_RUN = 'terminated when you give your final response'

export const shellStarted = (
  text: string | undefined,
): { id: string; path: string; endsWithRun?: true } | null => {
  const m = STARTED.exec(text ?? '')
  if (m === null) return null
  const started = { id: m[1] as string, path: m[2] as string }
  return text?.includes(ENDS_WITH_RUN) === true ? { ...started, endsWithRun: true } : started
}

// The last `max` lines that are not empty, as they show in a terminal: a carriage return
// rewrites its line, escape codes and control characters draw nothing.
export const outputTail = (raw: string, max: number): string[] =>
  raw
    .split('\n')
    .map((line) =>
      (line.replace(/\r+$/, '').split('\r').pop() ?? '')
        // biome-ignore lint/suspicious/noControlCharactersInRegex: escape codes are what it removes
        .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\u001b./g, '')
        .replace(/\t/g, '  ')
        // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trimEnd()
        .slice(0, MAX_LINE),
    )
    .filter((line) => line !== '')
    .slice(-max)

export const added = (list: readonly Shell[], shell: Shell): Shell[] =>
  [shell, ...list.filter((s) => s.id !== shell.id)].slice(0, MAX_SHELLS)

export const ended = (
  list: Shell[],
  id: string,
  status: Exclude<Shell['status'], 'running'>,
  at: number,
): Shell[] =>
  list.some((s) => s.id === id && s.status === 'running')
    ? list.map((s) => (s.id === id ? { ...s, status, endedAt: at } : s))
    : list

export const endedWithAgent = (list: Shell[], agentId: string, at: number): Shell[] =>
  list.some((s) => s.owner === agentId && s.status === 'running')
    ? list.map((s) =>
        s.owner === agentId && s.status === 'running'
          ? { ...s, status: 'killed' as const, endedAt: at }
          : s,
      )
    : list

export const withTail = (list: Shell[], id: string, tail: string[]): Shell[] =>
  list.some((s) => s.id === id && JSON.stringify(s.tail) !== JSON.stringify(tail))
    ? list.map((s) => (s.id === id ? { ...s, tail } : s))
    : list

export const shownOrder = (list: readonly Shell[]): Shell[] =>
  [...list].sort(
    (a, b) =>
      Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt,
  )

export const shellsHead = (list: readonly Shell[]): Cell => {
  const running = list.filter((s) => s.status === 'running').length
  const parts = [
    ...(running > 0 ? [`${running} running`] : []),
    ...(list.length > running ? [`${list.length - running} ended`] : []),
  ]
  return { text: parts.join(' · '), color: running > 0 ? PALETTE.green : PALETTE.dim }
}
