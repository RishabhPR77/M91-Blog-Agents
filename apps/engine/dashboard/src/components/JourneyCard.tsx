// The post's journey card: a one-line status, the bar (Topic → … → Published) and the runs that worked on the post.
// Used on the post page and on a run's page, so every green of a post shows in one place.
import { Link } from 'react-router-dom'
import { modeLabel, type PostJourney } from '../api/journey'
import { fmtDateTime } from '../format'
import { JourneyBar, journeyLine } from './JourneyBar'
import { Card } from './Page'
import { StatusBadge } from './StatusBadge'

/** The post's journey (one bar from topic to published) and the runs that worked on it. */
export function JourneyCard({ journey, title }: { journey: PostJourney | undefined; title?: React.ReactNode }) {
  if (!journey?.stages?.length) return null
  const line = journeyLine(journey.stages)
  return (
    <Card className="mb-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {title}
        <span className={`pill pill-${line.tone === 'violet' ? 'blue' : line.tone}`} data-testid="journey-line">{line.text}</span>
        {journey.active_run_id && <Link to={`/runs/${journey.active_run_id}`} className="text-xs text-sky-700 underline dark:text-sky-300">Watch the run</Link>}
      </div>
      <JourneyBar stages={journey.stages} />
      {journey.runs.length > 0 && (
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer">{journey.runs.length} run{journey.runs.length === 1 ? '' : 's'} worked on this post</summary>
          <ul className="mt-2 space-y-1" data-testid="post-runs">
            {journey.runs.map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-center gap-2">
                <Link to={`/runs/${r.run_id}`} className="font-medium text-slate-700 underline dark:text-slate-200">{modeLabel(r.mode)}</Link>
                <StatusBadge status={r.status} />
                <span>{fmtDateTime(r.started_at)}</span>
                <span className="truncate">{r.result_summary}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
