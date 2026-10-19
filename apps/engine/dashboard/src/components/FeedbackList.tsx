// The Reviewer's feedback items: severity, area, the quoted sentence (and whether it was found in the post),
// the problem and the fix.
export type FeedbackItem = { area?: string; quote?: string; problem?: string; fix?: string; severity?: string; send_to?: string; quote_found?: boolean; source?: string }

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  if (!items.length) return <p className="text-sm text-slate-500">No feedback items.</p>
  return (
    <ol className="space-y-3" aria-label="Feedback">
      {items.map((f, i) => (
        <li key={i} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className={`pill ${f.severity === 'must' ? 'pill-red' : 'pill-amber'}`}>{f.severity ?? '—'}</span>
            {f.area && <span className="pill pill-gray">{f.area}</span>}
            {f.send_to && <span className="text-xs text-slate-500">→ {f.send_to}</span>}
          </div>
          {f.quote && (
            <blockquote className="my-1 border-l-2 border-slate-300 pl-2 text-slate-600 italic dark:border-slate-600 dark:text-slate-400">
              “{f.quote}”{' '}
              {f.quote_found === false ? <span className="pill pill-red not-italic">quote not found in the post</span> : f.quote_found ? <span className="pill pill-green not-italic">found</span> : null}
            </blockquote>
          )}
          {f.problem && <p><span className="font-medium">Problem: </span>{f.problem}</p>}
          {f.fix && <p className="mt-0.5"><span className="font-medium">Fix: </span>{f.fix}</p>}
        </li>
      ))}
    </ol>
  )
}
