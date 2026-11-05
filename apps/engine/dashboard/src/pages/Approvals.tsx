// /approvals — drafts waiting for the human's decision.
import { Link } from 'react-router-dom'
import { useApprovals } from '../api/queries'
import { EmptyState, PageHeader, LoadingRows } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { fmtAgo, fmtDateTime } from '../format'

export default function Approvals() {
  const approvals = useApprovals()
  const items = approvals.data ?? []
  return (
    <>
      <PageHeader eyebrow="Review" title="Waiting for you" subtitle="Posts the AI review passed, or you revised, wait here for your yes." />
      {approvals.isPending ? (
        <LoadingRows />
      ) : items.length === 0 ? (
        <EmptyState>No drafts waiting. Run the pipeline from <Link to="/" className="underline">Control</Link>.</EmptyState>
      ) : (
        <ul className="stagger divide-y divide-line border-y border-line">
          {items.map((a) => (
            <li key={`${a.brief_id}-${a.version}`}>
              <Link to={`/approvals/${a.brief_id}`} className="group block py-7 transition-colors">
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="min-w-0 flex-1">
                      <div className="font-serif text-[24px] leading-snug font-semibold tracking-[-0.015em] transition-transform duration-300 group-hover:translate-x-1">{a.title || '(untitled)'}</div>
                      <div className="mt-2 text-[13px] text-ink-3">
                        brief <span className="font-mono">{a.brief_id}</span> · v{a.version} · waiting since {fmtDateTime(a.waiting_since)} ({fmtAgo(a.waiting_since)})
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-serif text-[34px] leading-none font-semibold tabular-nums">{a.total ?? '—'}</div>
                      <div className="mt-1 text-xs text-ink-3">{a.total == null ? 'not reviewed' : 'AI score'}</div>
                    </div>
                    <StatusBadge status="awaiting_human" />
                    <span aria-hidden className="text-xl text-ink-3 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-ink">→</span>
                  </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
