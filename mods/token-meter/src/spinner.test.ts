import { expect, test } from 'claude-code/testing'
import { SPINNER, spinnerFrame } from './spinner'

test('every frame is one single-width character', () => {
  for (const f of SPINNER) expect(f).toHaveLength(1)
})

test('the frame index wraps around and never goes out of range', () => {
  expect(spinnerFrame(0)).toBe(SPINNER[0])
  expect(spinnerFrame(SPINNER.length)).toBe(SPINNER[0])
  expect(spinnerFrame(SPINNER.length + 3)).toBe(SPINNER[3])
  expect(spinnerFrame(-1)).toBe(SPINNER[0])
  expect(spinnerFrame(Number.NaN)).toBe(SPINNER[0])
})
