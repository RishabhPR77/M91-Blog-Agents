// A small coloured badge for run, step, draft and brief statuses.
const TONE: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-1 dark:ring-inset dark:ring-emerald-400/25',
  red: 'bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300 dark:ring-1 dark:ring-inset dark:ring-red-400/25',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-1 dark:ring-inset dark:ring-amber-400/25',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-1 dark:ring-inset dark:ring-sky-400/25',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-1 dark:ring-inset dark:ring-violet-400/25',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  published: 'green', publish_failed: 'red', publishing: 'blue', unpublished: 'gray',
  succeeded: 'green', done: 'green', approved: 'green', pass: 'green', ok: 'green', current: 'green',
  failed: 'red', fail: 'red', failed_review: 'red', rejected: 'red', error: 'red',
  running: 'blue', drafted: 'blue', new: 'blue', active: 'blue', open: 'blue',
  awaiting_human: 'violet', changes_requested: 'amber', drafted_with_issues: 'amber', with_issues: 'amber', cancelled: 'amber',
  superseded: 'gray', skipped: 'gray', waiting: 'gray', discarded: 'gray', used: 'gray', old: 'gray', expired: 'gray'
}

export function toneOf(status: string | null | undefined): keyof typeof TONE {
  return STATUS_TONE[String(status ?? '')] ?? 'gray'
}

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  const text = label ?? String(status ?? 'unknown').replace(/_/g, ' ')
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[toneOf(status)]}`}>{text}</span>
}
