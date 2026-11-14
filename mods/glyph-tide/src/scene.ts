const W = 1600
const H = 1000
const FONT = 13
// The advance of a monospaced face is about 0.6 em.
const ADVANCE = FONT * 0.6
const LINE = 18
const COLS = Math.ceil(W / ADVANCE)
const ROWS = Math.ceil(H / LINE)
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const WAVES = 6
// How long a wave spreads, in seconds, at any pace: a pace only sets the rest between two spawns.
const SPREAD = 6.5
// The places that a wave moves through, one per spawn, before they repeat.
const HOPS = 8
// Points that a wave's outline curves through, each a little off the circle.
const POINTS = 10
// The rings of one ripple, from the inside out: where each crest is in the wave's radius, its
// half width and its light. The outer ring leads and is the brightest, as on water.
const CRESTS: [number, number, number][] = [
  [0.5, 0.08, 0.3],
  [0.7, 0.08, 0.6],
  [0.9, 0.1, 1],
]

// mulberry32: a seed gives the same field and waves on each redraw of one session.
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fixed = (n: number) => n.toFixed(1)

type Point = [number, number]

// A closed Catmull-Rom curve through the points, as cubic Bézier segments.
function smoothClosed(pts: Point[]): string {
  const at = (i: number) => pts[(i + pts.length) % pts.length] as Point
  let d = `M${fixed(at(0)[0])} ${fixed(at(0)[1])}`
  for (let i = 0; i < pts.length; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1.map(fixed).join(' ')} ${c2.map(fixed).join(' ')} ${fixed(p2[0])} ${fixed(p2[1])}`
  }
  return `${d}Z`
}

// The outline of a ripple around (0, 0): nearly round, as water is never quite even.
function ripplePath(rnd: () => number): string {
  const pts: Point[] = []
  for (let k = 0; k < POINTS; k++) {
    const a = ((k + rnd() * 0.3) / POINTS) * Math.PI * 2
    const r = 500 * (0.93 + rnd() * 0.07)
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return smoothClosed(pts)
}

// White for the mask, its opacity the light: dark between the crests, so each ring fades in and out softly.
function rippleGradient(): string {
  const stops: [number, number][] = [[0, 0]]
  for (const [at, half, light] of CRESTS) stops.push([at - half, 0], [at, light], [at + half, 0])
  stops.push([1, 0])
  const marks = stops.map(
    ([at, v]) => `<stop offset="${Number(at.toFixed(3))}" stop-color="#fff" stop-opacity="${v}"/>`,
  )
  return `<radialGradient id="ripple">${marks.join('')}</radialGradient>`
}

const percent = (n: number) => Number((n * 100).toFixed(1))

export function sceneSvg({
  seed,
  motion,
  wavesPerMinute,
}: {
  seed: number
  motion: boolean
  wavesPerMinute: number
}): string {
  const rnd = random(seed)
  const rows: string[] = []
  for (let r = 0; r < ROWS; r++) {
    let line = ''
    for (let c = 0; c < COLS; c++) line += GLYPHS[Math.floor(rnd() * GLYPHS.length)]
    rows.push(`<text y="${(r + 1) * LINE}">${line}</text>`)
  }
  // Each of the waves spawns once a cycle.
  const cycle = (WAVES * 60) / wavesPerMinute
  const waves: string[] = []
  const hops: string[] = []
  for (let i = 0; i < WAVES; i++) {
    const dur = fixed(cycle * (0.85 + rnd() * 0.3))
    const delay = fixed(-rnd() * Number(dur))
    const path = `<path class="w" d="${ripplePath(rnd)}" fill="url(#ripple)" style="animation-duration:${dur}s;animation-delay:${delay}s"/>`
    if (!motion) {
      waves.push(`<g transform="translate(${fixed(rnd() * W)} ${fixed(rnd() * H)})">${path}</g>`)
      continue
    }
    // The hop shares the wave's delay and lasts HOPS of its cycles, so it jumps as the wave spawns.
    const marks = Array.from(
      { length: HOPS },
      (_, k) =>
        `${(k * 100) / HOPS}%{transform:translate(${Math.round(rnd() * W)}px,${Math.round(rnd() * H)}px)}`,
    )
    hops.push(`@keyframes hop${i}{${marks.join('')}}`)
    waves.push(
      `<g class="hop" style="animation-name:hop${i};animation-duration:${fixed(Number(dur) * HOPS)}s;animation-delay:${delay}s">${path}</g>`,
    )
  }
  const spreads = Math.min(1, SPREAD / cycle)
  const css = [
    '.lo{fill:#7d8aa3;fill-opacity:.12}.hi{fill:#7d8aa3;fill-opacity:1}',
    `text{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:${FONT}px;white-space:pre}`,
    // A wave's path is drawn around its own (0, 0), so it scales from its centre.
    '.w{transform-box:view-box;transform-origin:0 0;transform:scale(0);opacity:0}',
  ]
  if (motion) {
    css.push(
      // A ripple spreads fast, then slows; it stays bright for half its spread, then fades and rests.
      `@keyframes wave{0%{transform:scale(.05);opacity:1}${percent(spreads / 2)}%{opacity:1}${percent(spreads)}%{transform:scale(1.2);opacity:0}100%{transform:scale(1.2);opacity:0}}`,
      '.w{animation:wave cubic-bezier(.2,.6,.4,1) infinite}.lo{display:none}',
      `.hop{animation-timing-function:step-end;animation-iteration-count:infinite}${hops.join('')}`,
      '@media (prefers-reduced-motion: reduce){.w,.hop{animation:none}.lo{display:inline}}',
    )
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">`,
    `<style>${css.join('')}</style>`,
    '<defs>',
    rippleGradient(),
    `<g id="glyphs">${rows.join('')}</g>`,
    `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000"/>${waves.join('')}</mask>`,
    '</defs>',
    '<use href="#glyphs" class="lo"/>',
    '<use href="#glyphs" class="hi" mask="url(#m)"/>',
    '</svg>',
  ].join('')
}
