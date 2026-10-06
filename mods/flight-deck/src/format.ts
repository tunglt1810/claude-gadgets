export const formatTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

export const formatCountdown = (ms: number | null): string => {
  if (ms === null) return '--'
  if (ms <= 0) return 'expired'
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// US dollars to the cent, without the sign (the band's `$` is the metric's icon).
export const formatUsd = (usd: number): string =>
  (Number.isFinite(usd) && usd > 0 ? usd : 0).toFixed(2)

export const formatDuration = (ms: number): string => {
  const s = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}
