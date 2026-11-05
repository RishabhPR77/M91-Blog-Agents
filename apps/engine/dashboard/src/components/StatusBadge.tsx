// A status as a dot and a word, for runs, steps, drafts and briefs. "now" (lime) is what is happening or waiting
// on you; green is done; red stopped; amber needs a look; gray is past or not started.
const TONE: Record<string, string> = {
  green: 'pill-green',
  red: 'pill-red',
  amber: 'pill-amber',
  blue: 'pill-blue',
  violet: 'pill-blue font-semibold',
  gray: 'pill-gray'
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
  return <span className={`pill ${TONE[toneOf(status)]}`}>{text}</span>
}
