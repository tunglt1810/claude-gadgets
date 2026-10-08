// Finds the gaps between three price tables: the table of the flight-deck mod
// (`mods/flight-deck/src/price.ts`), the table in the installed Claude Code binary, and
// Anthropic's price page. It also compares the 1M context windows of the binary's model
// catalog with `contextWindow` of the mod.
//
// Run it after a Claude Code update or a price change:
//
//   bun _scripts/pricing-gap.ts [path of the claude binary]
//
// It reads only. It ends with code 1 when it finds a gap that the mod does not account for.
// First written against Claude Code 2.1.293 (2026-10-08): the binary is minified, so a later
// version can change the shapes that the patterns below read. The script then says that it
// found no rows, and the patterns need an update.

import { realpathSync } from 'node:fs'
import { costOf, priceNote, readPrice } from '../mods/flight-deck/src/price'
import { contextWindow } from '../mods/flight-deck/src/window'

const PAGE = 'https://platform.claude.com/docs/en/about-claude/pricing.md'

// The prices of one rate, in US dollars per million tokens.
type Rate = { input: number; output: number; write5m: number; write1h: number; read: number }
type Row = Rate & { long?: Rate & { above: number } }
const FIELDS = ['input', 'output', 'write5m', 'write1h', 'read'] as const

const NUM = '([\\d.e]+)'
const RATE = `input:${NUM},output:${NUM},cache_write_5m:${NUM},cache_write_1h:${NUM},cache_read:${NUM}`

const rate = (v: (string | undefined)[]): Rate => ({
  input: Number(v[0]),
  output: Number(v[1]),
  write5m: Number(v[2]),
  write1h: Number(v[3]),
  read: Number(v[4]),
})

// The price table of the binary, by the name of each row (`tier_2_10`, `haiku_55`).
const enginePrices = (text: string): Map<string, Row> => {
  const rows = new Map<string, Row>()
  const pattern = new RegExp(
    `([a-z_0-9]+):\\{${RATE},web_search:[\\d.e]+(?:,long_prompt:\\{above_prompt_tokens:${NUM},${RATE}\\})?\\}`,
    'g',
  )
  for (const m of text.matchAll(pattern)) {
    const v = m.slice(2)
    rows.set(m[1] ?? '', {
      ...rate(v),
      ...(v[5] === undefined ? {} : { long: { above: Number(v[5]), ...rate(v.slice(6)) } }),
    })
  }
  return rows
}

// The model catalog of the binary: the price row and the window of each model id.
const engineModels = (text: string): Map<string, { pricing: string; isNative1m: boolean }> => {
  const models = new Map<string, { pricing: string; isNative1m: boolean }>()
  for (const part of text.split('{id:"claude-').slice(1)) {
    const id = `claude-${part.slice(0, part.indexOf('"'))}`
    // A catalog row names its family next: another `{id:"claude-` is not a model.
    if (!part.startsWith(`${id.slice('claude-'.length)}",family:"`)) continue
    const row = part.slice(0, 3000)
    const pricing = row.match(/pricing:"([a-z_0-9]+)"/)?.[1]
    const context = row.match(/context:\{([^}]*)\}/)?.[1] ?? ''
    if (pricing !== undefined)
      models.set(id, { pricing, isNative1m: context.includes('native_1m:!0') })
  }
  return models
}

// The "Model pricing" table of the price page, by model id. A model with two rows has a base
// rate ("for prompts up to N tokens") and a long rate ("for prompts over N tokens").
const pagePrices = (markdown: string): Map<string, Row> => {
  const rows = new Map<string, Row>()
  const table = markdown.split(/^## Model pricing$/m)[1]?.split(/^## /m)[0] ?? ''
  for (const line of table.split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    const name = cells[1]?.match(/^Claude (Fable|Mythos|Opus|Sonnet|Haiku) (\d+(?:\.\d+)?)/)
    if (name === null || name === undefined) continue
    const usd = (i: number) => Number(cells[i]?.match(/\$([\d.]+)/)?.[1])
    // The columns: base input, 5m cache writes, 1h cache writes, cache hits, output.
    const r: Rate = {
      input: usd(2),
      write5m: usd(3),
      write1h: usd(4),
      read: usd(5),
      output: usd(6),
    }
    const id = `claude-${name[1]?.toLowerCase()}-${name[2]?.replace('.', '-')}`
    const over = cells[1]?.match(/prompts over ([\d,]+) tokens/)?.[1]
    if (over === undefined) rows.set(id, { ...rows.get(id), ...r })
    else {
      const base = rows.get(id)
      if (base !== undefined)
        rows.set(id, { ...base, long: { above: Number(over.replaceAll(',', '')), ...r } })
    }
  }
  return rows
}

// The price of a model in the mod, read through its exported functions, or null with no price.
// A long rate is the rate of one request of a million tokens, when it is not the base rate.
const modPrice = (id: string): Row | null => {
  const read = readPrice(id)
  if (read === null) return null
  const MTOK = 1e6
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const of = (isOneRequest: boolean): Rate => ({
    input: costOf(id, { ...zero, input: MTOK }, '5m', isOneRequest) ?? Number.NaN,
    output:
      (costOf(id, { ...zero, input: MTOK, output: MTOK }, '5m', isOneRequest) ?? Number.NaN) -
      (costOf(id, { ...zero, input: MTOK }, '5m', isOneRequest) ?? Number.NaN),
    write5m: costOf(id, { ...zero, cacheWrite: MTOK }, '5m', isOneRequest) ?? Number.NaN,
    write1h: costOf(id, { ...zero, cacheWrite: MTOK }, '1h', isOneRequest) ?? Number.NaN,
    read: costOf(id, { ...zero, cacheRead: MTOK }, '5m', isOneRequest) ?? Number.NaN,
  })
  const base = of(false)
  const long = of(true)
  // The mod does not export the limit of a long rate: the price page and the engine give it.
  return FIELDS.some((f) => !same(base[f], long[f]))
    ? { ...base, long: { above: Number.NaN, ...long } }
    : base
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9
const usd = (n: number | undefined): string => (n === undefined ? '—' : `$${n}`)

const path = realpathSync(process.argv[2] ?? Bun.which('claude') ?? '')
const version = Bun.spawnSync([path, '--version']).stdout.toString().trim()
// One byte for each character: the catalog is ASCII, and the binary is not UTF-8.
const text = Buffer.from(await Bun.file(path).arrayBuffer()).toString('latin1')
const prices = enginePrices(text)
const models = engineModels(text)
const response = await fetch(PAGE)
const page = response.ok ? pagePrices(await response.text()) : new Map<string, Row>()

console.log(`binary      ${path} (${version})`)
console.log(`price page  ${PAGE} (${new Date().toLocaleDateString('sv')})`)
console.log(
  `found       ${models.size} catalog models, ${prices.size} engine price rows, ${page.size} page models\n`,
)

const gaps: string[] = []
const notes: string[] = []
if (models.size === 0 || prices.size === 0)
  gaps.push('the binary gave no catalog or no price rows: update the patterns of this script')
if (page.size === 0) gaps.push(`the price page gave no rows (HTTP ${response.status})`)

for (const id of [...new Set([...models.keys(), ...page.keys()])].sort()) {
  const model = models.get(id)
  const engine = model === undefined ? undefined : prices.get(model.pricing)
  const listed = page.get(id)
  const mod = modPrice(id)
  if (mod === null) {
    notes.push(`${id}: no price in the mod`)
    continue
  }
  const note = priceNote(id)
  let hasKnownGap = false
  const compare = (label: string, m?: Rate, e?: Rate, p?: Rate) => {
    for (const f of FIELDS) {
      const line = `${id} ${label}${f}: mod ${usd(m?.[f])}, engine ${usd(e?.[f])}, page ${usd(p?.[f])}`
      if (m !== undefined && p !== undefined && !same(m[f], p[f]))
        gaps.push(`${line} -> the mod is not the listed price`)
      else if (e !== undefined && p !== undefined && !same(e[f], p[f])) {
        // The mod accounts for a gap that its dashboard note names.
        const isKnown = f === 'read' && note?.includes(`$${e[f].toFixed(2)}`) === true
        if (isKnown) {
          hasKnownGap = true
          notes.push(`${line} -> known: "${note}"`)
        } else gaps.push(`${line} -> the engine counts another price, and the mod has no note`)
      } else if (m !== undefined && e !== undefined && p === undefined && !same(m[f], e[f]))
        gaps.push(`${line} -> the mod is not the price of the engine (not on the page)`)
    }
  }
  compare('', mod, engine, listed)
  const longs = [mod.long, engine?.long, listed?.long]
  if (longs.some((l) => l !== undefined)) {
    if (longs.some((l, i) => l === undefined && [mod, engine, listed][i] !== undefined))
      gaps.push(
        `${id}: a long rate in ${longs.filter((l) => l !== undefined).length} of the tables only`,
      )
    compare('long ', mod.long, engine?.long, listed?.long)
    if (
      engine?.long !== undefined &&
      listed?.long !== undefined &&
      engine.long.above !== listed.long.above
    )
      gaps.push(`${id}: long rate above ${engine.long.above} (engine), ${listed.long.above} (page)`)
  }
  // The limit of a long rate in the mod: one request at the listed limit has the base rate,
  // and one token more has the long rate.
  const above = listed?.long?.above ?? engine?.long?.above
  if (above !== undefined && mod.long !== undefined) {
    const read = (prompt: number) => readPrice(id, prompt) ?? Number.NaN
    if (!same(read(above), mod.read) || !same(read(above + 1), mod.long.read))
      gaps.push(`${id}: the long rate of the mod does not start above ${above} tokens`)
  }
  if (note !== null && !hasKnownGap)
    gaps.push(`${id}: the mod has a note, and the engine and the page agree -> "${note}"`)
  if (model !== undefined) {
    const isLarge = contextWindow(id, false) === 1_000_000
    if (isLarge !== model.isNative1m)
      gaps.push(`${id}: native 1M is ${model.isNative1m} in the catalog, ${isLarge} in the mod`)
  }
}

console.log(`notes (${notes.length})`)
for (const n of notes) console.log(`  ${n}`)
console.log(`\ngaps (${gaps.length})`)
for (const g of gaps) console.log(`  ${g}`)
process.exit(gaps.length === 0 ? 0 : 1)
