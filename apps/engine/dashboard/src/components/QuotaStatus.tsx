// The Mem0 quota guard (Phase 9 A5): this month's estimate in the header, and a banner at the warn and stop
// levels. At the stop level the engine refuses new runs and refreshes; approving or publishing still works.
import type { Mem0Usage } from '../api/types'

const resetDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Mem0 412/1000" with the reset date in the tooltip. */
export function QuotaPill({ usage }: { usage?: Mem0Usage }) {
  if (!usage) return null
  const tone = usage.level === 'stop' ? 'pill-red' : usage.level === 'warn' ? 'pill-amber' : 'pill-gray'
  return (
    <span className={`pill ${tone}`} data-testid="mem0-usage" title={`Mem0 requests this month (estimate; the Mem0 console has the exact figure). Resets on ${resetDate(usage.resets_on)}.`}>
      Mem0 {usage.used}/{usage.limit}
    </span>
  )
}

export function QuotaBanner({ usage }: { usage?: Mem0Usage }) {
  if (!usage || usage.level === 'ok') return null
  const stop = usage.level === 'stop'
  return (
    <div role="alert" data-testid="mem0-quota-banner" className={`border-b px-4 py-2 text-sm ${stop ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100' : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'}`}>
      {stop
        ? <>Mem0 quota almost used: {usage.used}/{usage.limit} ({usage.pct}%). New runs are paused until {resetDate(usage.resets_on)} or a higher limit (MEM0_MONTHLY_LIMIT). Approving and publishing a waiting draft still work.</>
        : <>Mem0 quota: {usage.used}/{usage.limit} requests used this month ({usage.pct}%). Runs pause at {usage.stop_pct}%. Resets on {resetDate(usage.resets_on)}.</>}
    </div>
  )
}
