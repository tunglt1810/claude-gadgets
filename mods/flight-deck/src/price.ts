import type { Totals } from '../types'
import { formatUsd } from './format'
import type { Ttl } from './ttl'

// First-party API prices in US dollars per million tokens, as Anthropic lists them
// (2026-09-25). `read` is the cache read price where it is not 0.1 x `input`. A cache write
// costs 1.25 x `input` for 5 minutes, 2 x for 1 hour. Update this table when the prices change.
//
// `long` is the rate of a request whose prompt has more than `above` tokens. Only Haiku 5.5
// has one. The sources, as collected on 2026-10-08:
//
// 1. Anthropic's price page (https://platform.claude.com/docs/en/about-claude/pricing), the
//    "Model pricing" table and the "Long context pricing" section:
//
//      | Model                                               | Base input | 5m cache writes | 1h cache writes | Cache hits  | Output     |
//      | Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10/MTok | $0.125/MTok     | $0.20/MTok      | $0.01/MTok  | $0.50/MTok |
//      | Claude Haiku 5.5 (for prompts over 100,000 tokens)  | $0.50/MTok | $0.625/MTok     | $1/MTok         | $0.05/MTok  | $2.50/MTok |
//
//      "Claude 4.6 and later models (except Claude Haiku 5.5) and Claude Mythos Preview include
//      the full 1M token context window at standard pricing. [...] Claude Haiku 5.5 is priced
//      by prompt length: a prompt of over 100,000 tokens pays higher prices."
//
// 2. The price table of the Claude Code 2.1.293 binary (minified, as written):
//
//      haiku_55:{input:0.1,output:0.5,cache_write_5m:0.125,cache_write_1h:0.2,cache_read:0.01,
//        web_search:0.01,long_prompt:{above_prompt_tokens:1e5,input:0.5,output:2.5,
//        cache_write_5m:0.625,cache_write_1h:1,cache_read:0.05}}
//
// 3. The engine's selector of the rate, from the same binary (minified, names restored). The
//    prompt is the input, the cache reads and the cache writes of one response, and the long
//    rate then prices each token of that request, the output too:
//
//      function rateOf(costs, usage) {
//        const long = costs.longPrompt
//        if (long === undefined) return costs
//        return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) +
//          (usage.cache_creation_input_tokens ?? 0) > long.abovePromptTokens ? long : costs
//      }
//
// The cache prices of the long rate keep the multipliers of the base rate (1.25 x, 2 x and
// 0.1 x its input), so a long rate names only its input and its output.
//
// `engineRead` is the cache read price that the engine counts where it is not the listed one:
// the session total of the engine then differs from the costs of this table. Sonnet 5.5, as
// collected on 2026-10-08:
//
// 1. Anthropic's price page, the "Model pricing" table and its second note:
//
//      | Claude Sonnet 5.5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok (2) | $10 / MTok |
//
//      "2 Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at
//      0.05x the base input price."
//
// 2. The Claude Code 2.1.293 binary: the catalog row of `claude-sonnet-5-5` has
//    `pricing:"tier_2_10"`, the row of Sonnet 5, and the price table has (minified, as written):
//
//      tier_2_10:{input:2,output:10,cache_write_5m:2.5,cache_write_1h:4,cache_read:0.2,
//        web_search:0.01}
type Rate = { input: number; output: number; read?: number }
const PRICES: Record<string, Rate & { long?: Rate & { above: number }; engineRead?: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.1, engineRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    long: { above: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

// The price row of a model, or undefined for a model with no price. The longest matching id
// wins: `claude-opus-5-5` is not priced as `claude-opus-5`.
const priceOf = (name: string) => {
  // A `[1m]` suffix selects a window, not a price.
  const model = name.replace(/\[1m\]$/i, '')
  const id = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0]
  return id === undefined ? undefined : PRICES[id]
}

// The cache read price of a price row: its own, or a tenth of the input price.
const readOf = (p: { input: number; read?: number }): number => p.read ?? p.input * 0.1

// The cache write price of a price row, by the lifetime of the cache entry.
const writeOf = (p: { input: number }, ttl: Ttl): number => p.input * (ttl === '1h' ? 2 : 1.25)

// The rate of a model for one request with a prompt of `prompt` tokens: the long rate above
// its limit, else the base rate.
const rateOf = (p: Rate & { long?: Rate & { above: number } }, prompt: number): Rate =>
  p.long !== undefined && prompt > p.long.above ? p.long : p

// The cache read price of a model in US dollars per million tokens, or null with no price.
// `prompt` is the tokens of the prompt that is read: it selects the long rate of the model.
export const readPrice = (model: string, prompt = 0): number | null => {
  const p = priceOf(model)
  return p === undefined ? null : readOf(rateOf(p, prompt))
}

// The cost that the engine counts over the listed price for a model's tokens: the session
// total of the engine holds it, and no model row does.
export const engineGap = (model: string, t: Totals): number => {
  const p = priceOf(model)
  return p?.engineRead === undefined ? 0 : (t.cacheRead * (p.engineRead - readOf(p))) / 1e6
}

// What a cache break costs for `tokens` tokens of one request: their cost as cache writes
// less their cost as cache reads, or null for a model with no price. `prompt` is the tokens
// of the prompt of the request: it selects the long rate of the model.
export const rewriteCost = (
  model: string,
  tokens: number,
  ttl: Ttl,
  prompt: number,
): number | null => {
  const base = priceOf(model)
  if (base === undefined) return null
  const p = rateOf(base, prompt)
  return (tokens * (writeOf(p, ttl) - readOf(p))) / 1e6
}

// What the dashboard says below the row of a model whose cache read price the engine counts
// at another rate, or null where the two prices agree.
export const priceNote = (model: string): string | null => {
  const p = priceOf(model)
  if (p?.engineRead === undefined || p.engineRead === readOf(p)) return null
  return `cache read $${formatUsd(readOf(p))}/MTok, engine $${formatUsd(p.engineRead)}`
}

// The estimated cost of a model's tokens, or null for a model with no price. `isOneRequest`
// says that the tokens are of one request: its prompt (the input, the cache reads and the
// cache writes) then selects the long rate of the model. Summed tokens get the base rate.
export const costOf = (
  model: string,
  t: Totals,
  ttl: Ttl = '5m',
  isOneRequest = false,
): number | null => {
  const base = priceOf(model)
  if (base === undefined) return null
  const p = rateOf(base, isOneRequest ? t.input + t.cacheRead + t.cacheWrite : 0)
  const read = readOf(p)
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * read +
      t.cacheWrite * writeOf(p, ttl)) /
    1e6
  )
}
