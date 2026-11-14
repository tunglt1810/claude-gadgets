import { expect, test } from 'claude-code/testing'
import { sceneSvg } from './scene'

test('the scene fits the Svg limit and fills any screen', async () => {
  const svg = sceneSvg({ seed: 1, motion: true })
  expect(svg.length).toBeLessThan(131072)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('viewBox=')
  expect(svg).toContain('preserveAspectRatio="xMidYMid slice"')
})

test('the scene has no script and no event handler', async () => {
  const svg = sceneSvg({ seed: 2, motion: true })
  expect(/<script/i.test(svg)).toBe(false)
  expect(/\son[a-z]+=/i.test(svg)).toBe(false)
})

test('the waves move unless motion is off or the system reduces motion', async () => {
  const moving = sceneSvg({ seed: 3, motion: true })
  expect(moving).toContain('@keyframes')
  expect(moving).toContain('prefers-reduced-motion: reduce')
  const still = sceneSvg({ seed: 3, motion: false })
  expect(still).not.toContain('@keyframes')
})

test('a seed gives one field and one set of waves', async () => {
  expect(sceneSvg({ seed: 4, motion: true })).toBe(sceneSvg({ seed: 4, motion: true }))
  expect(sceneSvg({ seed: 4, motion: true })).not.toBe(sceneSvg({ seed: 5, motion: true }))
})

test('the scene has a light and a dark version', async () => {
  expect(sceneSvg({ seed: 6, motion: true })).toContain('prefers-color-scheme: dark')
})

test('the glyphs show only inside a wave while the waves move', async () => {
  const moving = sceneSvg({ seed: 7, motion: true })
  expect(moving).toContain('.lo{display:none}')
  expect(moving).toMatch(/prefers-reduced-motion: reduce\)\{[^}]*\}?\.lo\{display:inline\}/)
  expect(sceneSvg({ seed: 7, motion: false })).not.toContain('.lo{display:none}')
})

test('a wave is a water ripple: a smooth outline with soft trailing rings', async () => {
  const svg = sceneSvg({ seed: 8, motion: true })
  expect(svg).not.toContain('<circle')
  const d = svg.match(/<path class="w" d="([^"]+)"/)?.[1] ?? ''
  expect(d).toContain('C')
  expect(d).not.toContain('L')
  expect(svg).toContain('fill="url(#ripple)"')
  const ripple = svg.match(/<radialGradient id="ripple">(.*?)<\/radialGradient>/)?.[1] ?? ''
  // Each ring rises from dark and falls back: three rings need at least seven stops.
  expect(ripple.match(/<stop/g)?.length ?? 0).toBeGreaterThanOrEqual(7)
})

test('a few waves cross the field at one time', async () => {
  expect(sceneSvg({ seed: 9, motion: true }).match(/class="w"/g)?.length).toBe(3)
})
