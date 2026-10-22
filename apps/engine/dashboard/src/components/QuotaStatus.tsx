// The Mem0 quota guard (Phase 9 A5): this month's estimate in the header, and a banner at the warn and stop
// levels. At the stop level the engine refuses new runs and refreshes; approving or publishing still works.
// Phase 12: Mem0 counts two quotas: retrievals (reads + searches, MEM0_MONTHLY_LIMIT) and adds (writes,
// MEM0_MONTHLY_ADD_LIMIT). Both are shown; the banner names the one that is close.
import type { Mem0Usage } from '../api/types'

const resetDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Mem0 619/1000 · adds 146/10000" with the reset date in the tooltip. */
export function QuotaPill({ usage }: { usage?: Mem0Usage }) {
  if (!usage) return null
  const tone = usage.level === 'stop' ? 'pill-red' : usage.level === 'warn' ? 'pill-amber' : 'pill-gray'
  return (
    <span className={`pill ${tone}`} data-testid="mem0-usage" title={`Mem0 this month (estimate; the Mem0 console has the exact figures): retrievals (reads and searches) ${usage.used}/${usage.limit}${usage.adds ? `, adds (writes) ${usage.adds.used}/${usage.adds.limit}` : ''}. Resets on ${resetDate(usage.resets_on)}.`}>
      Mem0 {usage.used}/{usage.limit}{usage.adds ? ` · adds ${usage.adds.used}/${usage.adds.limit}` : ''}
    </span>
  )
}

export function QuotaBanner({ usage }: { usage?: Mem0Usage }) {
  if (!usage || usage.level === 'ok') return null
  const stop = usage.level === 'stop'
  const addsLimited = usage.limited === 'adds' && usage.adds
  const what = addsLimited ? 'add quota' : usage.adds ? 'retrieval quota' : 'quota'
  const used = addsLimited ? usage.adds!.used : usage.used
  const limit = addsLimited ? usage.adds!.limit : usage.limit
  const pct = addsLimited ? usage.adds!.pct : usage.pct
  const key = addsLimited ? 'MEM0_MONTHLY_ADD_LIMIT' : 'MEM0_MONTHLY_LIMIT'
  const unit = addsLimited ? 'adds' : usage.adds ? 'retrievals' : 'requests'
  return (
    <div role="alert" data-testid="mem0-quota-banner" className={`border-b px-4 py-2 text-sm ${stop ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100' : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'}`}>
      {stop
        ? <>Mem0 {what} almost used: {used}/{limit} ({pct}%). New runs are paused until {resetDate(usage.resets_on)} or a higher limit ({key}). Approving and publishing a waiting draft still work.</>
        : <>Mem0 {what}: {used}/{limit} {unit} used this month ({pct}%). Runs pause at {usage.stop_pct}%. Resets on {resetDate(usage.resets_on)}.</>}
    </div>
  )
}
