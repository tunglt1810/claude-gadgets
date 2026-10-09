// The first release whose Button holds strings and Text. An earlier engine refuses the
// tree of a pane that has such a Button, and draws nothing in the pane.
const TEXT_IN_BUTTON = [2, 1, 295] as const

// True when the engine of that release draws a Button that holds a Text. `base` is the
// release of `$.session.version()`; a version that is not a release has none.
export const holdsText = (base: string | undefined): boolean => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(base ?? '')
  if (m === null) return false
  for (const [i, min] of TEXT_IN_BUTTON.entries()) {
    const n = Number(m[i + 1])
    if (n !== min) return n > min
  }
  return true
}
