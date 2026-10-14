// The first release whose Button holds strings and Text. An earlier engine refuses the
// tree of a pane that has such a Button, and draws nothing in the pane.
const TEXT_IN_BUTTON = [2, 1, 295] as const
// The first release whose Text takes `mono`. An earlier engine refuses the tree of a
// `Client` that has it, and unmounts the `Client`.
const MONO_TEXT = [2, 1, 299] as const

// True when `base` is the release `min` or a later one. `base` is the release of
// `$.session.version()`; a version that is not a release has none.
const isAtLeast = (base: string | undefined, min: readonly number[]): boolean => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(base ?? '')
  if (m === null) return false
  for (const [i, n0] of min.entries()) {
    const n = Number(m[i + 1])
    if (n !== n0) return n > n0
  }
  return true
}

// True when the engine of that release draws a Button that holds a Text.
export const holdsText = (base: string | undefined): boolean => isAtLeast(base, TEXT_IN_BUTTON)

// True when the engine of that release draws a Text in the monospaced face of the cells.
export const holdsMono = (base: string | undefined): boolean => isAtLeast(base, MONO_TEXT)
