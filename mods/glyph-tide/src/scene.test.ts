import { expect, test } from 'claude-code/testing'
import { sceneSvg } from './scene'

test('the scene fits the Svg limit and fills any screen', async () => {
  const svg = sceneSvg({ wavesPerMinute: 20, seed: 1, motion: true })
  expect(svg.length).toBeLessThan(131072)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('viewBox=')
  expect(svg).toContain('preserveAspectRatio="xMidYMid slice"')
})

test('the scene has no script and no event handler', async () => {
  const svg = sceneSvg({ wavesPerMinute: 20, seed: 2, motion: true })
  expect(/<script/i.test(svg)).toBe(false)
  expect(/\son[a-z]+=/i.test(svg)).toBe(false)
})

test('the waves move unless motion is off or the system reduces motion', async () => {
  const moving = sceneSvg({ wavesPerMinute: 20, seed: 3, motion: true })
  expect(moving).toContain('@keyframes')
  expect(moving).toContain('prefers-reduced-motion: reduce')
  const still = sceneSvg({ wavesPerMinute: 20, seed: 3, motion: false })
  expect(still).not.toContain('@keyframes')
})

test('a seed gives one field and one set of waves', async () => {
  expect(sceneSvg({ wavesPerMinute: 20, seed: 4, motion: true })).toBe(
    sceneSvg({ wavesPerMinute: 20, seed: 4, motion: true }),
  )
  expect(sceneSvg({ wavesPerMinute: 20, seed: 4, motion: true })).not.toBe(
    sceneSvg({ wavesPerMinute: 20, seed: 5, motion: true }),
  )
})

test('the scene has no ground and no colour-scheme rule, so one ink reads in both modes', async () => {
  const svg = sceneSvg({ wavesPerMinute: 20, seed: 6, motion: true })
  // A desktop's backdrop frame reports a light scheme when the app is dark too.
  expect(svg).not.toContain('prefers-color-scheme')
  expect(svg).not.toContain('class="bg"')
  expect(svg).toContain('.hi{fill:#7d8aa3;fill-opacity:1}')
})

test('the glyphs show only inside a wave while the waves move', async () => {
  const moving = sceneSvg({ wavesPerMinute: 20, seed: 7, motion: true })
  expect(moving).toContain('.lo{display:none}')
  expect(moving).toMatch(/prefers-reduced-motion: reduce\)\{[^}]*\}?\.lo\{display:inline\}/)
  expect(sceneSvg({ wavesPerMinute: 20, seed: 7, motion: false })).not.toContain(
    '.lo{display:none}',
  )
})

test('a wave is a water ripple: a smooth outline with soft trailing rings', async () => {
  const svg = sceneSvg({ wavesPerMinute: 20, seed: 8, motion: true })
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
  expect(sceneSvg({ wavesPerMinute: 20, seed: 9, motion: true }).match(/class="w"/g)?.length).toBe(
    6,
  )
})

const durations = (svg: string) =>
  [...svg.matchAll(/<path class="w"[^>]*animation-duration:([\d.]+)s/g)].map((m) => Number(m[1]))

test('waves per minute sets how often a wave spawns, not how fast it spreads', async () => {
  for (const wavesPerMinute of [10, 20, 40]) {
    const svg = sceneSvg({ seed: 10, motion: true, wavesPerMinute })
    const ds = durations(svg)
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length
    // Six waves, each spawning once a cycle.
    expect(Math.abs(mean - 360 / wavesPerMinute) / (360 / wavesPerMinute)).toBeLessThan(0.2)
    const spreadEnd = Number(
      svg.match(/@keyframes wave\{.*?([\d.]+)%\{transform:scale\(1\.2\)/)?.[1],
    )
    // The spread lasts about 6.5 s at any pace.
    expect(Math.abs((spreadEnd / 100) * (360 / wavesPerMinute) - 6.5)).toBeLessThan(0.2)
  }
})

test('a pace too fast for a whole spread spreads with no rest', async () => {
  const svg = sceneSvg({ seed: 11, motion: true, wavesPerMinute: 80 })
  expect(svg).toContain('100%{transform:scale(1.2);opacity:0}')
  expect(svg).not.toMatch(/@keyframes wave\{[^@]*1\d\d\.\d+%/)
})

test('each wave moves to a new place as it spawns', async () => {
  const svg = sceneSvg({ seed: 12, motion: true, wavesPerMinute: 20 })
  expect(svg).toContain(
    '.hop{animation-timing-function:step-end;animation-iteration-count:infinite}',
  )
  const pairs = [
    ...svg.matchAll(
      /<g class="hop" style="animation-name:hop\d;animation-duration:([\d.]+)s;animation-delay:(-?[\d.]+)s"><path class="w"[^>]*animation-duration:([\d.]+)s;animation-delay:(-?[\d.]+)s/g,
    ),
  ]
  expect(pairs.length).toBe(6)
  for (const [, hop, hopDelay, wave, waveDelay] of pairs) {
    expect(Number(hop)).toBe(Number((Number(wave) * 8).toFixed(1)))
    expect(hopDelay).toBe(waveDelay)
  }
  expect([...svg.matchAll(/@keyframes hop\d\{([^}]*\}){8}\}/g)].length).toBe(6)
})

test('still waves have no hop', async () => {
  expect(sceneSvg({ seed: 13, motion: false, wavesPerMinute: 20 })).not.toContain('hop')
})

// Points along a path's cubic segments, so a dip between two anchors counts too.
function outline(d: string): [number, number][] {
  const n = (d.match(/-?[\d.]+/g) ?? []).map(Number)
  const pts: [number, number][] = []
  let [x, y] = [n[0] as number, n[1] as number]
  for (let i = 2; i + 5 < n.length; i += 6) {
    const [a, b, c, e, f, g] = n.slice(i, i + 6) as number[]
    for (let t = 0; t < 1; t += 0.02) {
      const u = 1 - t
      pts.push([
        u ** 3 * x +
          3 * u * u * t * (a as number) +
          3 * u * t * t * (c as number) +
          t ** 3 * (f as number),
        u ** 3 * y +
          3 * u * u * t * (b as number) +
          3 * u * t * t * (e as number) +
          t ** 3 * (g as number),
      ])
    }
    ;[x, y] = [f as number, g as number]
  }
  return pts
}

test('the outline of a wave never cuts its light, so the outer ring fades out softly', async () => {
  for (const seed of [14, 15, 16, 17, 18]) {
    const svg = sceneSvg({ seed, motion: true, wavesPerMinute: 20 })
    const stops = [...svg.matchAll(/offset="([\d.]+)"[^>]*stop-opacity="([\d.]+)"/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ])
    const lit = Math.max(...stops.filter((s) => (s[1] as number) > 0).map((s) => s[0] as number))
    // The last lit stop falls back to dark before the outline.
    const end = stops.find((s) => (s[0] as number) > lit)?.[0] as number
    for (const [, d] of svg.matchAll(/<path class="w" d="([^"]+)"/g)) {
      const pts = outline(d as string)
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      const [cx, cy, rx, ry] = [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2]
      const reach = Math.min(...pts.map(([px, py]) => Math.hypot((px - cx) / rx, (py - cy) / ry)))
      expect(end).toBeLessThanOrEqual(reach)
    }
  }
})
