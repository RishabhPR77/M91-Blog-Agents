// /approvals — drafts waiting for the human's decision.
import { Link } from 'react-router-dom'
import { useApprovals } from '../api/queries'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { fmtAgo, fmtDateTime } from '../format'

export default function Approvals() {
  const approvals = useApprovals()
  const items = approvals.data ?? []
  return (
    <>
      <PageHeader title="Approvals" subtitle="Drafts the Reviewer passed (or you revised) wait here for your decision." />
      {approvals.isPending ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState>No drafts waiting. Run the pipeline from <Link to="/" className="underline">Control</Link>.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={`${a.brief_id}-${a.version}`}>
              <Link to={`/approvals/${a.brief_id}`} className="block">
                <Card className="transition-colors hover:border-slate-400 dark:hover:border-slate-600">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{a.title || '(untitled)'}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        brief <span className="font-mono">{a.brief_id}</span> · v{a.version} · waiting since {fmtDateTime(a.waiting_since)} ({fmtAgo(a.waiting_since)})
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold tabular-nums">{a.total ?? '—'}</div>
                      <div className="text-xs text-slate-500">{a.total == null ? 'not reviewed' : 'score'}</div>
                    </div>
                    <StatusBadge status="awaiting_human" />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
