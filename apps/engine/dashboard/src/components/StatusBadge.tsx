// A small coloured badge for run, step, draft and brief statuses.
const TONE: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

const STATUS_TONE: Record<string, keyof typeof TONE> = {
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
