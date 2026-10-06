export type Ttl = '5m' | '1h'

const isTtl = (v: unknown): v is Ttl => v === '5m' || v === '1h'

// The environment variables that change a cache lifetime, as the engine reads them.
export const TTL_ENV = [
  'FORCE_PROMPT_CACHING_5M',
  'CLAUDE_CODE_PROMPT_CACHE_TTL',
  'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL',
  'ENABLE_PROMPT_CACHING_1H',
] as const
export type TtlEnv = Partial<Record<(typeof TTL_ENV)[number], string | undefined>>

const isOn = (v: string | undefined): boolean =>
  v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())

// The engine's resolver, read from the Claude Code 2.1.291 binary (minified, names restored):
//
//   function resolveTtl(source, agentCacheTtl, isOverage) {
//     if (FORCE_PROMPT_CACHING_5M) return { ttl: '5m', reason: 'force_5m_env' }
//     const isMain = isMainSource(source)
//     const fromEnv = isMain ? CLAUDE_CODE_PROMPT_CACHE_TTL : CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL
//     if (fromEnv !== undefined) return { ttl: fromEnv, reason: 'env' }
//     const setting = isMain ? settings.promptCacheTtl : settings.subagentPromptCacheTtl
//     if (setting !== undefined) return { ttl: setting, reason: 'setting' }
//     if (agentCacheTtl !== undefined && !(agentCacheTtl === '1h' && isOverage))
//       return { ttl: agentCacheTtl, reason: 'agent_frontmatter' }
//     if (ENABLE_PROMPT_CACHING_1H || (bedrock && ENABLE_PROMPT_CACHING_1H_BEDROCK))
//       return { ttl: '1h', reason: 'enable_1h_env' }
//   }
//   function cacheTtl(source, { agentCacheTtlOverride, ignoreOverage }) {
//     const isSubscriber = isClaudeAiSubscriber()
//     const isOverage = isSubscriber && !ignoreOverage && usage().isUsingOverage === true
//     const named = resolveTtl(source, agentCacheTtlOverride, isOverage)
//     if (named) return named
//     if (!isSubscriber || isOverage) return { ttl: '5m', reason: 'default' }
//     // Server gate; its default allowlist below.
//     const { allowlist } = gate('tengu_prompt_cache_1h_config', {
//       allowlist: ['repl_main_thread*', 'sdk', 'auto_mode', 'memdir_relevance'],
//     })
//     return matches(source, allowlist)
//       ? { ttl: '1h', reason: 'subscriber' }
//       : { ttl: '5m', reason: 'default' }
//   }
//
// The main-loop sources are those of the allowlist. Subagents, background agents, workflows,
// compaction and title generation are not in it, so they cache for 5m by default. A plugin
// sees neither the subscriber check nor the gate, nor an agent's `experimental.cacheTtl`.
//
// The prompt cache lifetimes the engine picks, as far as a plugin can see them, in the
// engine's order: FORCE_PROMPT_CACHING_5M, then the loop's environment variable, then the
// setting (`promptCacheTtl`, `subagentPromptCacheTtl`), then ENABLE_PROMPT_CACHING_1H. With
// none of them, the main loop of a subscriber caches for 1h (the mod option stands in for that
// guess) and every other loop for 5m. Over a plan limit the main loop caches for 5m too.
export const cacheTtls = (
  settings: Record<string, unknown>,
  option: unknown,
  env: TtlEnv = {},
  isOver = false,
): { main: Ttl; agent: Ttl } => {
  if (isOn(env.FORCE_PROMPT_CACHING_5M)) return { main: '5m', agent: '5m' }
  const named = (fromEnv: string | undefined, setting: unknown): Ttl | undefined =>
    isTtl(fromEnv)
      ? fromEnv
      : isTtl(setting)
        ? setting
        : isOn(env.ENABLE_PROMPT_CACHING_1H)
          ? '1h'
          : undefined
  return {
    main:
      named(env.CLAUDE_CODE_PROMPT_CACHE_TTL, settings.promptCacheTtl) ??
      (isOver || option === '5m' ? '5m' : '1h'),
    agent:
      named(env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL, settings.subagentPromptCacheTtl) ?? '5m',
  }
}

// True when a plan window is used up: the session then draws on usage credits, and the engine
// caches for 5m. A gateway's `spend_limit` is not a plan window.
export const isOverLimit = (limits: readonly { kind: string; percentUsed: number }[]): boolean =>
  limits.some((l) => (l.kind === 'five_hour' || l.kind === 'seven_day') && l.percentUsed >= 100)
