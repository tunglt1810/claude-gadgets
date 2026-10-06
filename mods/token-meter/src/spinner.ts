// The frames of the mark a running agent is drawn with. Braille dots: each is one
// single-width character, so the row does not move while the mark turns.
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

// The frame for a tick count; a count of a wrong shape (state of an older version) is 0.
export const spinnerFrame = (n: number): string => {
  const i = Number.isInteger(n) && n >= 0 ? n % SPINNER.length : 0
  return SPINNER[i] ?? SPINNER[0]
}
