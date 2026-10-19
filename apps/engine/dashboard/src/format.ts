// Small display helpers (times are shown in the browser's local time zone).

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const valid = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso) : null)

export function fmtTime(iso: string | null | undefined): string {
  const d = valid(iso)
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
}

export function fmtDateTime(iso: string | null | undefined): string {
  const d = valid(iso)
  return d ? d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  const d = valid(iso)
  if (!d) return '—'
  return `${fmtDuration(Math.max(0, now - d.getTime()))} ago`
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
