export type Tone = 'ok' | 'warn' | 'danger' | 'expired'

export const ttlMs = (cfg: '5m' | '1h'): number => (cfg === '1h' ? 3_600_000 : 300_000)

// Milliseconds until the prompt cache lapses; null before the first step.
export const remainingMs = (lastStepAt: number | null, now: number, ttl: number): number | null =>
  lastStepAt === null ? null : lastStepAt + ttl - now

export const countdownTone = (r: number | null): Tone =>
  r === null || r <= 0 ? 'expired' : r < 15_000 ? 'danger' : r <= 60_000 ? 'warn' : 'ok'

export const cacheHitTone = (pct: number): 'ok' | 'warn' | 'danger' =>
  pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'danger'
