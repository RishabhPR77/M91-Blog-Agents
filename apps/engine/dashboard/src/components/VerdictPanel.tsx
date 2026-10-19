// The Reviewer's verdict: score and areas, summary, gates, feedback, sources checked. Shared by the
// approval screen and the review record view.
import { useSettings } from '../api/queries'
import { FeedbackList, type FeedbackItem } from './FeedbackList'
import { GatesList, type Gate } from './GatesList'
import { ScoreCard, type Area } from './ScoreCard'

export type Review = {
  total: number | null
  pass: boolean | null
  gates?: Gate[]
  areas?: Area[]
  feedback?: FeedbackItem[]
  summary?: string
  sources_checked?: { url: string; claim?: string; verdict?: string }[]
  lessons?: string[]
  fixed_previous?: { previous_quote?: string; fixed?: boolean; note?: string }[]
}

const H = ({ children }: { children: string }) => <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase">{children}</h3>

export function VerdictPanel({ review }: { review: Review }) {
  const settings = useSettings()
  return (
    <div className="space-y-4">
      <ScoreCard total={review.total} pass={review.pass} passMin={settings.data?.gates.pass_score_min} areaMin={settings.data?.gates.pass_area_min} areas={review.areas ?? []} />
      {review.summary && <p className="text-sm">{review.summary}</p>}
      <div><H>Gates</H><GatesList gates={review.gates ?? []} /></div>
      <div><H>Feedback</H><FeedbackList items={review.feedback ?? []} /></div>
      {review.sources_checked?.length ? (
        <div>
          <H>Sources the Reviewer checked</H>
          <ul className="space-y-1 text-sm">
            {review.sources_checked.map((s, i) => (
              <li key={i}>
                <span className={`pill ${s.verdict === 'supports' ? 'pill-green' : s.verdict === 'contradicts' ? 'pill-red' : 'pill-gray'}`}>{s.verdict ?? '?'}</span>{' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline dark:text-sky-300">{s.url}</a>
                {s.claim && <div className="text-xs text-slate-500">{s.claim}</div>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.fixed_previous?.length ? (
        <div>
          <H>Earlier feedback: fixed?</H>
          <ul className="space-y-1 text-sm">
            {review.fixed_previous.map((f, i) => (
              <li key={i}><span className={`pill ${f.fixed ? 'pill-green' : 'pill-amber'}`}>{f.fixed ? 'fixed' : 'not fixed'}</span> <span className="italic text-slate-600 dark:text-slate-400">“{f.previous_quote}”</span>{f.note && <div className="text-xs text-slate-500">{f.note}</div>}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.lessons?.length ? (
        <div><H>Lessons it saved</H><ul className="list-disc space-y-0.5 pl-5 text-sm">{review.lessons.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
      ) : null}
    </div>
  )
}
